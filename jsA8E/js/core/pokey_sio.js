(function () {
  "use strict";

  function createApi(cfg) {
    const IO_SEROUT_SERIN = cfg.IO_SEROUT_SERIN;
    const SERIAL_OUTPUT_DATA_NEEDED_CYCLES =
      cfg.SERIAL_OUTPUT_DATA_NEEDED_CYCLES;
    const SERIAL_OUTPUT_TRANSMISSION_DONE_CYCLES =
      cfg.SERIAL_OUTPUT_TRANSMISSION_DONE_CYCLES;
    const SERIAL_INPUT_FIRST_DATA_READY_CYCLES =
      cfg.SERIAL_INPUT_FIRST_DATA_READY_CYCLES;
    const SIO_DISK_RESPONSE_TURNAROUND_CYCLES =
      cfg.SIO_DISK_RESPONSE_TURNAROUND_CYCLES | 0;
    const SERIAL_INPUT_DATA_READY_CYCLES = cfg.SERIAL_INPUT_DATA_READY_CYCLES;
    const IO_IRQEN_IRQST = cfg.IO_IRQEN_IRQST;
    const CYCLE_NEVER =
      cfg.CYCLE_NEVER !== undefined ? cfg.CYCLE_NEVER : Number.POSITIVE_INFINITY;
    const serialOutputClockAvailable = cfg.serialOutputClockAvailable;
    const serialOutputClockPeriod = cfg.serialOutputClockPeriod;
    const serialOutputClockNextCycle = cfg.serialOutputClockNextCycle;
    const serialInputClockPeriod = cfg.serialInputClockPeriod;
    const serialCommandSpeedSupported = cfg.serialCommandSpeedSupported;
    const traceSerialEvent = cfg.traceSerialEvent;

    const cycleTimedEventUpdate = cfg.cycleTimedEventUpdate;

    const SIO_DATA_OFFSET = 32;
    const DISK_DEVICE_ID_BASE = 0x31;
    const DISK_DEVICE_COUNT = 8;

    const DISK_HEADER_SIZE = 16;
    const DISK_SECTOR_SIZE_SINGLE = 128;
    const DISK_SECTOR_SIZE_DOUBLE = 256;
    const DISK_SECTOR_SIZE_LARGE = 512;
    const DISK_BOOT_SECTORS = 3;

    const CHAR_ACK = "A".charCodeAt(0);
    const CHAR_COMPLETE = "C".charCodeAt(0);
    const CHAR_ERROR = "E".charCodeAt(0);
    const CHAR_NACK = "N".charCodeAt(0);

    const CMD_FORMAT = 0x21;
    const CMD_READ_SECTOR = 0x52;
    const CMD_STATUS = 0x53;
    const CMD_MOTOR_ON = 0x55;
    const CMD_VERIFY_SECTOR = 0x56;
    const CMD_WRITE_SECTOR = 0x57;
    const CMD_PUT_SECTOR = 0x50;
    const CMD_HIGH_SPEED_INDEX = 0x3f;
    const CMD_POLL = 0x40;

    function sioChecksum(buf, size) {
      let checksum = 0;
      for (let i = 0; i < size; i++) {
        const b = buf[i] & 0xff;
        checksum = (checksum + (((checksum + b) >> 8) & 0xff) + b) & 0xff;
      }
      return checksum & 0xff;
    }

    function effectiveEventCycle(ctx) {
      return ctx.cycleCounter;
    }

    function serialOutputDelay(ctx, fallback) {
      if (typeof serialOutputClockPeriod === "function") {
        const period = serialOutputClockPeriod(ctx) | 0;
        if (period > 0) return period;
      }
      return fallback;
    }

    function serialOutputIsAvailable(ctx) {
      if (typeof serialOutputClockAvailable === "function")
        return !!serialOutputClockAvailable(ctx);
      return true;
    }

    function serialInputByteDelay(ctx) {
      if (typeof serialInputClockPeriod === "function") {
        const period = serialInputClockPeriod(ctx) | 0;
        // AHRM 10.5: drive-side transmit timing is independent from the
        // computer's POKEY receive clock. Model the generic US Doubler byte
        // interval explicitly while retaining the standard timing fallback.
        if (period > 0 && period <= 20) return 220;
      }
      return SERIAL_INPUT_DATA_READY_CYCLES;
    }

    function scheduleSerialOutput(ctx, now, scheduleNeed, scheduleDone) {
      const io = ctx.ioData;
      if (!serialOutputIsAvailable(ctx)) {
        io.serialOutputNeedDataCycle = CYCLE_NEVER;
        io.serialOutputTransmissionDoneCycle = CYCLE_NEVER;
        if (ctx.ram && IO_IRQEN_IRQST !== undefined)
          ctx.ram[IO_IRQEN_IRQST] &= ~0x08;
        cycleTimedEventUpdate(ctx);
        return false;
      }

      const period = serialOutputDelay(ctx, SERIAL_OUTPUT_DATA_NEEDED_CYCLES);
      const normalNeedCycle =
        typeof serialOutputClockNextCycle === "function"
          ? serialOutputClockNextCycle(ctx, now)
          : now + period;
      const needCycle = scheduleNeed ? normalNeedCycle : 0;
      if (scheduleNeed) io.serialOutputNeedDataCycle = needCycle;
      if (scheduleDone) {
        const doneDelay = scheduleNeed
          // AHRM 5.6: the first byte is loaded into the shift register on
          // the next output-clock edge, then ten bit cells are transmitted.
          ? period * 21
          : serialOutputDelay(ctx, SERIAL_OUTPUT_TRANSMISSION_DONE_CYCLES) * 20;
        io.serialOutputTransmissionDoneCycle = scheduleNeed
          ? needCycle + period * 20
          : now + doneDelay;
      }
      if (typeof traceSerialEvent === "function") {
        traceSerialEvent(
          ctx,
          scheduleNeed ? "SEROUT_SCHEDULE" : "SEROUT_DONE_SCHEDULE",
          { now: now, period: period, scheduleNeed: !!scheduleNeed },
        );
      }
      cycleTimedEventUpdate(ctx);
      return true;
    }

    function queueSerialOutput(ctx, now) {
      const io = ctx.ioData;
      if (!serialOutputIsAvailable(ctx)) {
        io.serialOutputBytePending = false;
        io.serialOutputNeedDataCycle = CYCLE_NEVER;
        io.serialOutputTransmissionDoneCycle = CYCLE_NEVER;
        if (ctx.ram && IO_IRQEN_IRQST !== undefined)
          ctx.ram[IO_IRQEN_IRQST] &= ~0x08;
        cycleTimedEventUpdate(ctx);
        return false;
      }

      io.serialOutputBytePending = true;
      // The first byte waits for the next output-clock load edge.  Once the
      // shift register is active, a write only replaces the one-byte holding
      // register; it cannot create an earlier DATA NEEDED event.
      if (!io.serialOutputShiftActive &&
          (io.serialOutputNeedDataCycle === CYCLE_NEVER ||
           io.serialOutputNeedDataCycle <= now)) {
        scheduleSerialOutput(ctx, now, true, true);
      }
      return true;
    }

    function serialOutputDataNeeded(ctx) {
      const io = ctx.ioData;
      if (!io.serialOutputBytePending) return false;
      io.serialOutputShiftValue = io.serialOutputRegisterValue & 0xff;
      io.serialOutputBytePending = false;
      io.serialOutputShiftActive = true;
      return true;
    }

    function serialOutputTransmissionDone(ctx, eventCycle) {
      const io = ctx.ioData;
      if (!io.serialOutputShiftActive) return false;

      // Keep the serial cadence anchored to the already scheduled frame.
      // Timed events are observed at CPU instruction boundaries, so the
      // dispatcher can arrive a few cycles after the hardware deadline.  If
      // the next frame is based on that late observation, the error is added
      // to every byte in a burst and makes the transfer audibly bunch up.
      const scheduledDoneCycle = io.serialOutputTransmissionDoneCycle;

      transmitSioByte(ctx, io.serialOutputShiftValue & 0xff);
      if (!io.serialOutputBytePending) {
        io.serialOutputShiftActive = false;
        return false;
      }

      io.serialOutputShiftValue = io.serialOutputRegisterValue & 0xff;
      io.serialOutputBytePending = false;
      io.serialOutputShiftActive = true;
      const period = serialOutputDelay(ctx, SERIAL_OUTPUT_TRANSMISSION_DONE_CYCLES);
      const frameCycles = period * 20;
      const scheduledNext = Number.isFinite(scheduledDoneCycle)
        ? scheduledDoneCycle + frameCycles
        : (eventCycle | 0) + frameCycles;
      io.serialOutputTransmissionDoneCycle = scheduledNext > (eventCycle | 0)
        ? scheduledNext
        : (eventCycle | 0) + frameCycles;
      cycleTimedEventUpdate(ctx);
      return true;
    }

    function serialOutputTransmitNow(ctx) {
      const io = ctx.ioData;
      if (!io.serialOutputShiftActive) serialOutputDataNeeded(ctx);
      io.serialOutputNeedDataCycle = CYCLE_NEVER;
      io.serialOutputTransmissionDoneCycle = CYCLE_NEVER;
      return serialOutputTransmissionDone(ctx, effectiveEventCycle(ctx));
    }

    function commandLineIsControlled(io) {
      return !!(io && io.sioCommandLineControlled);
    }

    function sioCommandLineChanged(ctx, level) {
      const io = ctx.ioData;
      if (!commandLineIsControlled(io)) return;

      const asserted = !level;
      const wasAsserted = !!io.sioCommandLineAsserted;
      io.sioCommandLineAsserted = asserted;
      if (asserted) {
        // A new low CB2 interval begins a command frame. A half-received
        // frame cannot produce a response.
        if ((io.sioOutPhase | 0) === 0) {
          io.sioOutIndex = 0;
          io.sioCommandFrameReady = false;
        }
        return;
      }

      // AHRM 9.1: the disk validates the five bytes and starts ACK/NAK only
      // after the host releases COMMAND. No extra serial byte is consumed.
      if (wasAsserted && io.sioCommandFrameReady)
        transmitSioByte(ctx, 0);
    }

    function handleAbsentDevice(ctx) {
      const io = ctx.ioData;
      // An absent Type 1/2 device is electrically silent. The OS owns the
      // timeout and completion state (AHRM 9.1, 9.2).
      io.sioInIndex = 0;
      io.sioInSize = 0;
      io.sioPendingReadSize = 0;
      io.sioPendingWriteResult = 0;
      io.sioInReady = false;
    }

    function traceSio(ctx, event, fields) {
      const io = ctx && ctx.ioData;
      if (io) {
        const sp = ctx.cpu && Number.isFinite(ctx.cpu.sp)
          ? ctx.cpu.sp & 0xff
          : null;
        const stack = sp === null || !ctx.ram
          ? null
          : Array.from({ length: 8 }, function (_, index) {
              return ctx.ram[0x100 + ((sp + 1 + index) & 0xff)] & 0xff;
            });
        const trace = Array.isArray(io.sioTrace) ? io.sioTrace : (io.sioTrace = []);
        const record = Object.assign({
          event: event,
          cycle: ctx.cycleCounter,
          pc: Number.isFinite(ctx.currentInstructionPc)
            ? (ctx.currentInstructionPc & 0xffff)
            : null,
          sp: sp,
          stack: stack,
        }, fields || {});
        trace.push(record);
        if (trace.length > 128) trace.splice(0, trace.length - 128);
      }
      if (typeof traceSerialEvent === "function")
        traceSerialEvent(ctx, event, fields);
    }

    function queueSerinResponse(ctx, now, size) {
      const io = ctx.ioData;
      io.sioInSize = size | 0;
      io.sioInIndex = 0;
      io.sioInReady = false;
      // This simplified receive path exposes complete bytes directly. Its
      // 1530-cycle value is therefore the guest-visible serial delay, rather
      // than a start-bit delay to which another byte time is added. A separate
      // virtual-drive turn-around precedes it, matching the finite command
      // processing interval allowed by AHRM 9.1.
      // Adding that second interval shifts the serial-input IRQ phase and
      // makes the older OS CHKSUM race much more likely (AHRM 5.10).
      io.serialInputDataReadyCycle =
        now + SIO_DISK_RESPONSE_TURNAROUND_CYCLES +
        SERIAL_INPUT_FIRST_DATA_READY_CYCLES;
      traceSio(ctx, "SIO_RESPONSE_QUEUED", {
        size: io.sioInSize,
        firstByte: io.sioBuffer[0] & 0xff,
        pendingReadSize: io.sioPendingReadSize | 0,
        pendingWriteResult: io.sioPendingWriteResult | 0,
      });
      cycleTimedEventUpdate(ctx);
    }

    function serialInputReady(ctx) {
      const io = ctx.ioData;
      if ((io.sioInSize | 0) <= 0 || io.sioInReady) return false;

      // A completed serial byte is copied into SERIN before POKEY asserts
      // the serial-input IRQ. The CPU reads this holding register afterward.
      ctx.ram[IO_SEROUT_SERIN] =
        io.sioBuffer[io.sioInIndex & 0xffff] & 0xff;
      io.sioInIndex = (io.sioInIndex + 1) & 0xffff;
      io.sioInSize = (io.sioInSize - 1) | 0;
      io.sioInReady = true;
      return true;
    }

    function diskSectorSize(disk) {
      let s = DISK_SECTOR_SIZE_SINGLE;
      if (disk && disk.length >= 6) {
        s = (disk[4] & 0xff) | ((disk[5] & 0xff) << 8);
        if (
          s !== DISK_SECTOR_SIZE_SINGLE &&
          s !== DISK_SECTOR_SIZE_DOUBLE &&
          s !== DISK_SECTOR_SIZE_LARGE
        ) {
          s = DISK_SECTOR_SIZE_SINGLE;
        }
      }
      return s;
    }

    function sectorBytesAndOffset(sectorIndex, sectorSize) {
      if (sectorIndex <= 0) return null;
      // AHRM 10.1/10.3: only 256-byte DD media exposes the first three
      // logical sectors as 128-byte boot transfers. Larger-sector devices
      // transfer their native size for every sector.
      const shortBootSectors = sectorSize === DISK_SECTOR_SIZE_DOUBLE;
      const bootBytes = shortBootSectors
        ? DISK_SECTOR_SIZE_SINGLE
        : sectorSize;
      const bytes =
        shortBootSectors && sectorIndex <= DISK_BOOT_SECTORS
          ? bootBytes
          : sectorSize;
      const index =
        shortBootSectors && sectorIndex <= DISK_BOOT_SECTORS
          ? (sectorIndex - 1) * bootBytes
          : shortBootSectors
            ? (sectorIndex - (DISK_BOOT_SECTORS + 1)) * sectorSize +
              DISK_BOOT_SECTORS * bootBytes
            : (sectorIndex - 1) * sectorSize;
      const offset = DISK_HEADER_SIZE + index;
      return { bytes: bytes | 0, offset: offset | 0 };
    }

    function queueSingleByteResponse(ctx, now, value) {
      const io = ctx.ioData;
      io.sioBuffer[0] = value & 0xff;
      queueSerinResponse(ctx, now, 1);
    }

    function queueDeviceNack(ctx, now) {
      queueSingleByteResponse(ctx, now, CHAR_NACK);
    }

    function writeAckStatus(buf, statusChar) {
      buf[0] = CHAR_ACK;
      buf[1] = statusChar & 0xff;
    }

    function writeAckComplete(buf) {
      writeAckStatus(buf, CHAR_COMPLETE);
    }

    function queueAckComplete(ctx, now) {
      const io = ctx.ioData;
      const buf = io.sioBuffer;
      writeAckComplete(buf);
      queueSerinResponse(ctx, now, 2);
    }

    function queueAckData(ctx, now, dataStartIndex, dataSize) {
      const io = ctx.ioData;
      const buf = io.sioBuffer;
      writeAckComplete(buf);
      buf[dataSize + 2] = sioChecksum(
        buf.subarray(dataStartIndex, dataStartIndex + dataSize),
        dataSize,
      );
      // A disk drive acknowledges the command before sending the data frame.
      // Keep the two phases separate so software polling SERIN/IRQST sees the
      // same byte boundaries as the real SIO bus (AHRM 9.1, 5.6).
      io.sioPendingReadSize = dataSize | 0;
      io.sioBuffer[0] = CHAR_ACK;
      queueSerinResponse(ctx, now, 1);
    }

    function queuePendingReadData(ctx, now) {
      const io = ctx.ioData;
      const dataSize = io.sioPendingReadSize | 0;
      if (dataSize <= 0) return false;

      const buf = io.sioBuffer;
      // The response already contains C, data, and checksum at offsets
      // 1..dataSize+1. Move the sector down one byte for the data phase.
      buf[0] = CHAR_COMPLETE;
      for (let i = 0; i < dataSize; i++)
        buf[i + 1] = buf[i + 2] & 0xff;
      buf[dataSize + 1] = sioChecksum(buf.subarray(1, dataSize + 1), dataSize);
      io.sioPendingReadSize = 0;
      queueSerinResponse(ctx, now, dataSize + 2);
      return true;
    }

    function queuePendingWriteResult(ctx, now) {
      const io = ctx.ioData;
      const result = io.sioPendingWriteResult | 0;
      if (result === 0) return false;
      io.sioPendingWriteResult = 0;
      queueSingleByteResponse(ctx, now, result);
      return true;
    }

    function canAccessSector(disk, diskSize, sectorInfo) {
      return (
        !!disk &&
        !!sectorInfo &&
        sectorInfo.offset >= DISK_HEADER_SIZE &&
        sectorInfo.offset + sectorInfo.bytes <= diskSize
      );
    }

    function deviceSlotIndexFromDeviceId(devId) {
      const slot = (devId & 0xff) - DISK_DEVICE_ID_BASE;
      if (slot < 0 || slot >= DISK_DEVICE_COUNT) return -1;
      return slot;
    }

    function getMountedDiskForDevice(io, devId) {
      const slot = deviceSlotIndexFromDeviceId(devId);
      if (slot < 0) return null;

      const slots = io.deviceSlots;
      const images = io.diskImages;
      if (!slots || typeof slots.length !== "number" || slot >= slots.length)
        {return null;}
      const imageIndex = slots[slot] | 0;

      if (
        imageIndex >= 0 &&
        images &&
        typeof images.length === "number" &&
        imageIndex < images.length
      ) {
        const img = images[imageIndex];
        if (img && img.bytes) {
          return {
            deviceSlot: slot,
            imageIndex: imageIndex,
            bytes: img.bytes,
            size: img.size | 0 || img.bytes.length | 0,
          };
        }
      }

      return null;
    }

    // AHRM 10.2: STATUS byte +1 normally reports the (inverted) FDC status
    // from the last sector operation.  It is controller state, not a property
    // of the ATR header or a constant "media ready" flag.  Keep it per drive
    // so that a STATUS issued before the first sector command observes the
    // reset latch, while a completed read can update the value independently.
    function diskFdcStatus(io, deviceSlot) {
      if (!io.sioDiskFdcStatus) io.sioDiskFdcStatus = new Uint8Array(DISK_DEVICE_COUNT);
      return io.sioDiskFdcStatus[deviceSlot & 7] & 0xff;
    }

    function setDiskFdcStatus(io, deviceSlot, value) {
      if (!io.sioDiskFdcStatus) io.sioDiskFdcStatus = new Uint8Array(DISK_DEVICE_COUNT);
      io.sioDiskFdcStatus[deviceSlot & 7] = value & 0xff;
    }

    // Application-layer observers may persist a disk image after a successful
    // mutation. This callback is deliberately outside the SIO response path:
    // it does not alter protocol bytes or timing.
    function notifyDiskMediaChanged(io, mounted) {
      if (!mounted || typeof io.diskMediaChangeObserver !== "function") return;
      try {
        io.diskMediaChangeObserver(
          mounted.imageIndex | 0,
          mounted.deviceSlot | 0,
        );
      } catch {
        // Persistence observers must never affect emulated SIO behavior.
      }
    }

    // Application-layer UI observers may display disk activity after a valid
    // operation has been accepted. This callback is outside the SIO response
    // path and must not affect protocol bytes or timing (AHRM 9.1, 10.2).
    function notifyDiskActivity(io, mounted, operation) {
      if (!mounted || typeof io.diskActivityObserver !== "function") return;
      try {
        io.diskActivityObserver({
          imageIndex: mounted.imageIndex | 0,
          deviceSlot: mounted.deviceSlot | 0,
          operation: String(operation || "access"),
        });
      } catch {
        // UI observers must never affect emulated SIO behavior.
      }
    }

    function diskDevice(devId) {
      function onCommandFrame(ctx, now, cmd, aux1, aux2) {
        const io = ctx.ioData;
        const buf = io.sioBuffer;
        const mounted = getMountedDiskForDevice(io, devId);
        const disk = mounted ? mounted.bytes : null;
        const diskSize = mounted ? mounted.size | 0 : 0;
        const sectorSize = diskSectorSize(disk);

        if (cmd === CMD_READ_SECTOR) {
          // READ SECTOR
          const sectorIndex = (aux1 | (aux2 << 8)) & 0xffff;
          const si = sectorBytesAndOffset(sectorIndex, sectorSize);
          if (!canAccessSector(disk, diskSize, si)) {
            queueDeviceNack(ctx, now);
            return;
          }
          buf.set(disk.subarray(si.offset, si.offset + si.bytes), 2);
          // The virtual drive completed a data read without an FDC error.
          // Report that result on a later STATUS request (AHRM 10.2).
          setDiskFdcStatus(io, mounted.deviceSlot, 0xff);
          queueAckData(ctx, now, 2, si.bytes);
          notifyDiskActivity(io, mounted, "read");
          return;
        }

        if (cmd === CMD_HIGH_SPEED_INDEX) {
          // AHRM 10.3: generic US Doubler divisor.
          buf[2] = 0x0a;
          queueAckData(ctx, now, 2, 1);
          return;
        }

        if (cmd === CMD_POLL) {
          // Type 3 poll/reset is a bus-wide protocol. This disk device does
          // not provide a downloadable handler, so it must stay silent.
          return;
        }

        if (cmd === CMD_STATUS) {
          // STATUS
          // AHRM 10.3: 1050 Turbo marks high-speed commands with bit 7 of
          // DAUX2. This generic drive does not implement Turbo mode. Reject
          // its STATUS probe instead of treating the marker as a normal
          // status request; otherwise MyPicoDOS can select Turbo mode and
          // later reinterpret the marker as the high sector-number bit.
          if (aux2 & 0x80) {
            queueDeviceNack(ctx, now);
            return;
          }
          if (!disk || !disk.length || disk[0] === 0) {
            queueDeviceNack(ctx, now);
            return;
          }
          writeAckComplete(buf);
          if (sectorSize === DISK_SECTOR_SIZE_SINGLE) {
            buf[2] = 0x10;
            buf[3] = diskFdcStatus(io, mounted.deviceSlot);
            // AHRM 10.2: this is the format timeout, not the normal
            // command timeout. Keep it in the range used by real drives so
            // DOS does not reuse an unrealistically short value for another
            // drive's FORMAT command.
            buf[4] = 0xe0;
            buf[5] = 0x00;
          } else if (sectorSize === DISK_SECTOR_SIZE_LARGE) {
            // AHRM 10.1: 512-byte media does not use the DD boot-sector
            // exception. Use the TOMS-compatible 512-byte status marker.
            buf[2] = 0x50;
            buf[3] = diskFdcStatus(io, mounted.deviceSlot);
            buf[4] = 0xe0;
            buf[5] = 0x00;
          } else {
            buf[2] = 0x30;
            buf[3] = diskFdcStatus(io, mounted.deviceSlot);
            buf[4] = 0xe0;
            buf[5] = 0x00;
          }
          // This checksum belongs to the status payload, not to a density
          // template.  The latched FDC status is allowed to vary by command.
          buf[6] = sioChecksum(buf.subarray(2, 6), 4);
          queueSerinResponse(ctx, now, 7);
          notifyDiskActivity(io, mounted, "status");
          return;
        }

        if (
          cmd === CMD_WRITE_SECTOR ||
          cmd === CMD_PUT_SECTOR ||
          cmd === CMD_VERIFY_SECTOR
        ) {
          // WRITE / PUT / VERIFY SECTOR (expects a data frame).
          const sectorIndex2 = (aux1 | (aux2 << 8)) & 0xffff;
          const si2 = sectorBytesAndOffset(sectorIndex2, sectorSize);
          if (!canAccessSector(disk, diskSize, si2)) {
            queueDeviceNack(ctx, now);
            return;
          }

          io.sioOutPhase = 1;
          io.sioDataIndex = 0;
          io.sioPendingDevice = devId & 0xff;
          io.sioPendingCmd = cmd & 0xff;
          io.sioPendingSector = sectorIndex2 & 0xffff;
          io.sioPendingBytes = si2.bytes | 0;
          io.sioPendingWriteResult = 0;
          // ACK command frame; host will then send the data frame.
          queueSingleByteResponse(ctx, now, CHAR_ACK);
          return;
        }

        if (cmd === CMD_FORMAT) {
          // FORMAT: clear the data area and return the sector-sized bad-sector
          // list required by the disk protocol. An empty list is terminated
          // by $FFFF (AHRM 10.4, Format).
          if (!disk || !diskSize || diskSize <= DISK_HEADER_SIZE) {
            queueDeviceNack(ctx, now);
            return;
          }
          disk.fill(0, DISK_HEADER_SIZE);
          buf.fill(0, 2, 2 + sectorSize);
          buf[2] = 0xff;
          buf[3] = 0xff;
          buf[sectorSize + 2] = sioChecksum(
            buf.subarray(2, sectorSize + 2),
            sectorSize,
          );
          setDiskFdcStatus(io, mounted.deviceSlot, 0xff);
          notifyDiskMediaChanged(io, mounted);
          notifyDiskActivity(io, mounted, "format");
          queueAckData(ctx, now, 2, sectorSize);
          return;
        }

        if (cmd === CMD_MOTOR_ON) {
          // MOTOR ON: no-op, but ACK.
          queueAckComplete(ctx, now);
          return;
        }

        // Unsupported command.
        queueDeviceNack(ctx, now);
      }

      function onDataFrame(ctx, now, payloadOffset, payloadBytes, providedCrc) {
        const io = ctx.ioData;
        const buf = io.sioBuffer;
        const cmd = io.sioPendingCmd & 0xff;
        const mounted = getMountedDiskForDevice(io, devId);
        const disk = mounted ? mounted.bytes : null;
        const diskSize = mounted ? mounted.size | 0 : 0;
        const sectorSize = diskSectorSize(disk);
        const si = sectorBytesAndOffset(io.sioPendingSector | 0, sectorSize);
        const calculated = sioChecksum(
          buf.subarray(payloadOffset, payloadOffset + payloadBytes),
          payloadBytes,
        );

        if (
          calculated !== providedCrc ||
          !canAccessSector(disk, diskSize, si) ||
          si.bytes !== payloadBytes
        ) {
          queueDeviceNack(ctx, now);
          return;
        }

        if (cmd === CMD_VERIFY_SECTOR) {
          // VERIFY SECTOR: compare payload to current disk content.
          let ok = true;
          for (let vi = 0; vi < si.bytes; vi++) {
            if (
              (disk[si.offset + vi] & 0xff) !==
              (buf[payloadOffset + vi] & 0xff)
            ) {
              ok = false;
              break;
            }
          }
          setDiskFdcStatus(io, mounted.deviceSlot, ok ? 0xff : 0x00);
          io.sioPendingWriteResult = ok ? CHAR_COMPLETE : CHAR_ERROR;
          queueSingleByteResponse(ctx, now, CHAR_ACK);
          if (ok) notifyDiskActivity(io, mounted, "verify");
          return;
        }

        // WRITE / PUT: write sector payload.
        disk.set(buf.subarray(payloadOffset, payloadOffset + si.bytes), si.offset);
        notifyDiskMediaChanged(io, mounted);
        notifyDiskActivity(io, mounted, "write");
        if (cmd === CMD_WRITE_SECTOR) {
          // AHRM 10.4: WRITE includes a drive-side readback verification.
          // The emulated media is memory-backed, so no wall-clock delay is
          // needed; the data is nevertheless re-read before reporting the
          // final result.
          let verified = true;
          for (let vi = 0; vi < si.bytes; vi++) {
            if (
              (disk[si.offset + vi] & 0xff) !==
              (buf[payloadOffset + vi] & 0xff)
            ) {
              verified = false;
              break;
            }
          }
          setDiskFdcStatus(io, mounted.deviceSlot, verified ? 0xff : 0x00);
          io.sioPendingWriteResult = verified ? CHAR_COMPLETE : CHAR_ERROR;
          queueSingleByteResponse(ctx, now, CHAR_ACK);
        } else {
          setDiskFdcStatus(io, mounted.deviceSlot, 0xff);
          io.sioPendingWriteResult = CHAR_COMPLETE;
          queueSingleByteResponse(ctx, now, CHAR_ACK);
        }
      }

      return {
        onCommandFrame: onCommandFrame,
        onDataFrame: onDataFrame,
      };
    }

    const sioDeviceHandlers = Object.create(null);
    for (
      let devId = DISK_DEVICE_ID_BASE;
      devId < DISK_DEVICE_ID_BASE + DISK_DEVICE_COUNT;
      devId++
    ) {
      sioDeviceHandlers[devId] = diskDevice(devId);
    }
    function seroutWrite(ctx, value, writeCycle) {
      const io = ctx.ioData;
      // I/O writes occur on the final bus cycle of a CPU instruction.  The
      // optional timestamp lets the CPU-facing I/O layer preserve that fact
      // while direct callers retain the current-cycle behaviour.
      const now = Number.isFinite(writeCycle)
        ? writeCycle
        : effectiveEventCycle(ctx);
      // SEROUT writes fill POKEY's one-byte holding register. The COMMAND
      // line is PIA CB2 and is deliberately not changed by a data write.
      // The SIO bus sees the byte only when the output shift register
      // completes it.
      io.serialOutputRegisterValue = value & 0xff;
      queueSerialOutput(ctx, now);
    }

    function transmitSioByte(ctx, value) {
      const io = ctx.ioData;
      const now = effectiveEventCycle(ctx);

      const buf = io.sioBuffer;

      // --- Data phase (write/put/verify) ---
      if ((io.sioOutPhase | 0) === 1) {
        let dataIndex = io.sioDataIndex | 0;
        buf[SIO_DATA_OFFSET + dataIndex] = value & 0xff;
        dataIndex = (dataIndex + 1) | 0;
        io.sioDataIndex = dataIndex;

        const expected = (io.sioPendingBytes | 0) + 1; // data + checksum
        if (dataIndex !== expected) return;

        const dataBytes = io.sioPendingBytes | 0;
        const provided = buf[SIO_DATA_OFFSET + dataBytes] & 0xff;
        const pendingDev = io.sioPendingDevice & 0xff;
        const handler = sioDeviceHandlers[pendingDev];
        if (handler && handler.onDataFrame) {
          handler.onDataFrame(ctx, now, SIO_DATA_OFFSET, dataBytes, provided);
        } else {
          queueDeviceNack(ctx, now);
        }

        // Reset state.
        io.sioOutPhase = 0;
        io.sioDataIndex = 0;
        io.sioPendingDevice = 0;
        io.sioPendingCmd = 0;
        io.sioPendingSector = 0;
        io.sioPendingBytes = 0;
        io.sioOutIndex = 0;
        return;
      }

      // --- Command phase ---
      const commandFrameReady =
        commandLineIsControlled(io) && !!io.sioCommandFrameReady;
      let outIdx = io.sioOutIndex | 0;
      if (!commandFrameReady && outIdx === 0) {
        if (commandLineIsControlled(io) && !io.sioCommandLineAsserted)
          return;
        if (value > 0 && value < 255) {
          buf[0] = value & 0xff;
          io.sioOutIndex = 1;
        }
        return;
      }

      if (!commandFrameReady) {
        buf[outIdx] = value & 0xff;
        outIdx = (outIdx + 1) | 0;
        io.sioOutIndex = outIdx;

        if (outIdx !== 5) return;
        if (commandLineIsControlled(io)) {
          io.sioCommandFrameReady = true;
          return;
        }
      }

      // A controlled command frame is held until PIA CB2 returns high. The
      // direct-core harnesses intentionally retain immediate processing.
      io.sioOutIndex = 0;
      io.sioCommandFrameReady = false;

      if (sioChecksum(buf, 4) !== (buf[4] & 0xff)) {
        // AHRM 9.1 normally keeps checksum errors silent so devices cannot
        // interfere with one another. AHRM 5.10 also documents the XL/XE OS
        // first-byte race, where real disk drives answer an addressed,
        // mounted disk with NAK so the OS can retry the command. Apply that
        // compatibility rule only to an addressed virtual disk; absent IDs
        // remain electrically silent.
        const invalidDevice = buf[0] & 0xff;
        const invalidCommand = buf[1] & 0xff;
        const invalidAux1 = buf[2] & 0xff;
        const invalidAux2 = buf[3] & 0xff;
        const calculatedChecksum = sioChecksum(buf, 4);
        const providedChecksum = buf[4] & 0xff;
        if (
          invalidDevice >= DISK_DEVICE_ID_BASE &&
          invalidDevice < DISK_DEVICE_ID_BASE + DISK_DEVICE_COUNT &&
          getMountedDiskForDevice(io, invalidDevice)
        ) {
          queueDeviceNack(ctx, now);
        }
        traceSio(ctx, "SIO_COMMAND_DROPPED", {
          device: invalidDevice,
          command: invalidCommand,
          aux1: invalidAux1,
          aux2: invalidAux2,
          calculatedChecksum: calculatedChecksum,
          providedChecksum: providedChecksum,
          reason: "invalid-command-checksum",
        });
        return;
      }

      const dev = buf[0] & 0xff;
      const cmd2 = buf[1] & 0xff;
      const aux1 = buf[2] & 0xff;
      const aux2 = buf[3] & 0xff;

      if (
        typeof serialCommandSpeedSupported === "function" &&
        !serialCommandSpeedSupported(ctx, dev)
      ) {
        traceSio(ctx, "SIO_COMMAND_DROPPED", {
          device: dev,
          command: cmd2,
          aux1: aux1,
          aux2: aux2,
          reason: "unsupported-device-speed",
        });
        return;
      }

      traceSio(ctx, "SIO_COMMAND_RECEIVED", {
        device: dev,
        command: cmd2,
        aux1: aux1,
        aux2: aux2,
        checksum: buf[4] & 0xff,
      });
      const handler2 = sioDeviceHandlers[dev];
      if (handler2 && handler2.onCommandFrame) {
        handler2.onCommandFrame(ctx, now, cmd2, aux1, aux2);
      } else {
        // $3F/$40 are SIO poll commands. An absent peripheral must not be
        // turned into a disk NACK; the OS uses the resulting timeout.
        if (cmd2 === CMD_HIGH_SPEED_INDEX || cmd2 === CMD_POLL) {
          // A missing peripheral must remain electrically silent. The OS
          // owns the timeout and completion state; SIO only records that the
          // response phase is pending.
          handleAbsentDevice(ctx);
          return;
        }
        queueDeviceNack(ctx, now);
      }
    }

    function serinRead(ctx) {
      const io = ctx.ioData;
      if (io.sioInReady) {
        io.sioInReady = false;
        const b = ctx.ram[IO_SEROUT_SERIN] & 0xff;
        traceSio(ctx, "SIO_RESPONSE_READ", {
          value: b,
          remaining: io.sioInSize | 0,
          pendingReadSize: io.sioPendingReadSize | 0,
          pendingWriteResult: io.sioPendingWriteResult | 0,
        });
        if ((io.sioInSize | 0) > 0) {
          io.serialInputDataReadyCycle =
            effectiveEventCycle(ctx) + serialInputByteDelay(ctx);
          cycleTimedEventUpdate(ctx);
        } else {
          io.sioInIndex = 0;
          const now = effectiveEventCycle(ctx);
          if (!queuePendingReadData(ctx, now))
            queuePendingWriteResult(ctx, now);
          traceSio(ctx, "SIO_RESPONSE_PHASE_COMPLETE", {
            pendingReadSize: io.sioPendingReadSize | 0,
            pendingWriteResult: io.sioPendingWriteResult | 0,
            nextSize: io.sioInSize | 0,
            nextFirstByte: io.sioInSize > 0 ? io.sioBuffer[0] & 0xff : null,
          });
        }
      }
      return ctx.ram[IO_SEROUT_SERIN] & 0xff;
    }

    return {
      seroutWrite: seroutWrite,
      sioCommandLineChanged: sioCommandLineChanged,
      serialOutputTransmitNow: serialOutputTransmitNow,
      serialOutputDataNeeded: serialOutputDataNeeded,
      serialOutputTransmissionDone: serialOutputTransmissionDone,
      serialInputReady: serialInputReady,
      serinRead: serinRead,
    };
  }

  window.A8EPokeySio = {
    createApi: createApi,
  };
})();
