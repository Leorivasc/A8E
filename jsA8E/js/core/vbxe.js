(function () {
  "use strict";

  const VRAM_SIZE = 512 * 1024;
  const PALETTE_COUNT = 4;
  const PALETTE_ENTRIES = 256;
  const PALETTE_COMPONENTS = 3;
  const REGISTER_COUNT = 0x20;
  const DEFAULT_PAGE = 0xd640;
  const XDL_UPDATE_CYCLES = 22;
  const LOCAL_BUS_MACHINE_CYCLES = 114;
  const LOCAL_BUS_SLOTS = LOCAL_BUS_MACHINE_CYCLES * 8;
  // Altirra indexes this table by OvWidth: Narrow=0, Normal=1, Wide=2.
  const OVERLAY_DMA_START = [10, 18, 26];
  const OVERLAY_MACHINE_CYCLES = [64, 80, 84];
  const OVERLAY_TEXT_SLOTS = [195, 243, 255];
  const OVERLAY_NATIVE_WIDTH = [512, 640, 672];
  const OVERLAY_LEGACY_START = [128, 96, 88];
  const VBXE_CONTRIBUTOR_VALID = 0x8000;
  // These match the shared GTIA layer bits in hw.js. VBXE deliberately reads
  // per-pixel layer metadata rather than the final RGB value: different GTIA
  // layers can have the same visible color but have distinct collision
  // meanings in COLDETECT.
  const PRIO_PF0 = 0x0001;
  const PRIO_PF1 = 0x0002;
  const PRIO_PF2 = 0x0004;
  const PRIO_PF3 = 0x0008;
  const PRIO_PM0 = 0x0010;
  const PRIO_PM1 = 0x0020;
  const PRIO_PM2 = 0x0040;
  const PRIO_PM3 = 0x0080;
  const PRIO_M10_PM0 = 0x0100;
  const PRIO_M10_PM1 = 0x0200;
  const PRIO_M10_PM2 = 0x0400;
  const PRIO_M10_PM3 = 0x0800;

  function normalizeProfile(value) {
    const profile = String(value === undefined || value === null ? "" : value)
      .trim().toLowerCase();
    if (profile === "fx1.20" || profile === "fx120") return "fx1.20";
    if (profile === "fx1.24" || profile === "fx124") return "fx1.24";
    if (profile === "fx1.26" || profile === "fx126") return "fx1.26";
    if (profile === "fx1.26r" || profile === "fx126r" || profile === "r") return "fx1.26r";
    return "off";
  }

  function createXdlState() {
    return { address: 0, overlayAddress: 0, overlayStride: 0, mode: "off",
      enabled: false, repeat: 0, ended: false, overlayWidth: 1,
      playfieldPalette: 0, overlayPalette: 1, priority: 0xff,
      textScrollX: 0, textScrollY: 0, characterBase: 0, textRow: 0,
      attributeMapEnabled: false, attributeAddress: 0, attributeStride: 0,
      attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 8,
      attributeCellHeight: 8, attributeRow: 0, attributeBuffer: null };
  }

  function normalizeConfig(value) {
    const source = value && typeof value === "object" ? value : {};
    const rawProfile =
      typeof value === "string" ? value : (source.profile || "off");
    const requestedProfile = normalizeProfile(rawProfile);
    // Keep the original boolean-only configuration compatible by treating it
    // as the current FX 1.26 profile.
    const enabled = source.enabled === false ? false :
      requestedProfile !== "off" || source.enabled === true;
    const page = (source.page | 0) === 0xd740 ? 0xd740 : DEFAULT_PAGE;
    return {
      enabled: enabled,
      profile: enabled ? (requestedProfile !== "off" ? requestedProfile : "fx1.26") : "off",
      page: page,
    };
  }

  function loadPowerUpPalette(state, gtiaPalette) {
    if (!state || !gtiaPalette) return;
    const colors = new Uint8Array(gtiaPalette);
    state.palette.set(colors.subarray(0, PALETTE_ENTRIES * PALETTE_COMPONENTS), 0);
  }

  function createState(config, gtiaPalette) {
    const normalized = normalizeConfig(config);
    const state = {
      enabled: normalized.enabled,
      profile: normalized.profile,
      page: normalized.page,
      vram: new Uint8Array(VRAM_SIZE),
      palette: new Uint8Array(PALETTE_COUNT * PALETTE_ENTRIES * PALETTE_COMPONENTS),
      videoControlPending: 0,
      videoControlActive: 0,
      xdlAddressPending: 0,
      xdlAddressActive: 0,
      colorSelect: 0,
      paletteSelect: 0,
      collisionMask: 0,
      collisionDetect: 0,
      collisionLineMask: 0,
      blitAddress: 0,
      blitCollisionCode: 0,
      blitterBusy: 0,
      blitter: null,
      irqStatus: 0,
      irqControl: 0,
      blitterIrqPending: false,
      blitterIrqScheduled: false,
      blitterIrqResidual: 0,
      blitterEarlyRun: false,
      memacSlots: 0,
      memacReadSlots: 0,
      memacWriteSlots: 0,
      memacTrace: [],
      lastMemacTrace: [],
      memacSequence: 0,
      xdlSlots: 0,
      localBusSchedule: null,
      localBusCursor: 0,
      priority: new Uint8Array(4),
      memacBControl: 0,
      memacControl: 0,
      memacBankSelect: 0,
      configLatch: 0,
      xdl: createXdlState(),
    };
    // AHRM 12.4: power-up loads palette 0 from the GTIA palette; the other
    // three palettes remain clear until software writes them.
    loadPowerUpPalette(state, gtiaPalette);
    return state;
  }

  function softReset(state) {
    if (!state) return;
    const previousXdl = state.xdl || createXdlState();
    state.videoControlPending = 0;
    state.videoControlActive = 0;
    // Altirra WarmReset disables current XDL execution but retains the
    // programmed start-address latch and COLDETECT until their own strobes.
    state.xdl = createXdlState();
    // A warm reset stops the current XDL execution, but the hardware keeps
    // the address/stride/character-base latches that are used by the next
    // XDL restart. Altirra WarmReset preserves the same internal fields.
    state.xdl.overlayAddress = previousXdl.overlayAddress & 0x7ffff;
    state.xdl.overlayStride = previousXdl.overlayStride & 0xfff;
    state.xdl.attributeAddress = previousXdl.attributeAddress & 0x7ffff;
    state.xdl.attributeStride = previousXdl.attributeStride & 0xffc;
    state.xdl.characterBase = previousXdl.characterBase & 0x7ffff;
    state.blitCollisionCode = 0;
    state.collisionLineMask = 0;
    state.blitterBusy = 0;
    state.blitter = null;
    state.irqStatus = 0;
    state.irqControl = 0;
    state.blitterIrqPending = false;
    state.blitterIrqScheduled = false;
    state.blitterIrqResidual = 0;
    state.blitterEarlyRun = false;
    state.memacSlots = 0;
    state.memacReadSlots = 0;
    state.memacWriteSlots = 0;
    state.memacTrace.length = 0;
    state.lastMemacTrace.length = 0;
    state.memacSequence = 0;
    state.xdlSlots = 0;
    state.localBusSchedule = null;
    state.localBusCursor = 0;
    state.memacBControl &= 0x3f;
    state.memacControl &= 0xf3;
    state.memacBankSelect &= 0x7f;
  }

  function powerCycle(state, gtiaPalette) {
    if (!state) return;
    softReset(state);
    state.vram.fill(0);
    state.palette.fill(0);
    loadPowerUpPalette(state, gtiaPalette);
    state.colorSelect = 0;
    state.paletteSelect = 0;
    state.collisionMask = 0;
    state.collisionDetect = 0;
    state.collisionLineMask = 0;
    state.blitAddress = 0;
    state.blitCollisionCode = 0;
    state.priority.fill(0);
    state.memacBControl = 0;
    state.memacControl = 0;
    state.memacBankSelect = 0;
    state.configLatch = 0;
    state.xdlAddressPending = 0;
    state.xdlAddressActive = 0;
  }

  function verticalSync(state) {
    if (!state || !state.enabled) return;
    // AHRM 12.4: VSync restarts the XDL descriptor and resets its visual
    // parameters, but the overlay and attribute-map address/stride latches
    // are not reset automatically. An XDL entry may still overwrite either
    // address and stride when its corresponding control bit is present.
    const previousXdl = state.xdl;
    state.videoControlActive = (state.videoControlActive & 0x0e) |
      (state.videoControlPending & 0x01);
    state.xdlAddressActive = state.xdlAddressPending & 0x7ffff;
    state.xdl = createXdlState();
    state.xdl.address = state.xdlAddressActive;
    if (previousXdl) {
      state.xdl.overlayAddress = previousXdl.overlayAddress & 0x7ffff;
      state.xdl.overlayStride = previousXdl.overlayStride & 0xfff;
      state.xdl.attributeAddress = previousXdl.attributeAddress & 0x7ffff;
      state.xdl.attributeStride = previousXdl.attributeStride & 0xffc;
      state.xdl.characterBase = previousXdl.characterBase & 0x7ffff;
    }
  }

  function signed(value, bits) {
    const sign = 1 << (bits - 1);
    return (value & sign) !== 0 ? value - (sign << 1) : value;
  }

  function readBlitBlock(state, address) {
    const block = new Uint8Array(21);
    for (let i = 0; i < block.length; i++) block[i] = state.vram[(address + i) & 0x7ffff];
    return block;
  }

  function loadAttributeMapBuffer(state, xdl) {
    const buffer = new Uint8Array(43 * 4);
    const base = xdl.attributeAddress & 0x7ffff;
    if (base + buffer.length <= state.vram.length) {
      buffer.set(state.vram.subarray(base, base + buffer.length));
    } else {
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] = state.vram[(xdl.attributeAddress + i) & 0x7ffff];
      }
    }
    xdl.attributeBuffer = buffer;
  }

  function loadBlitterBlock(state) {
    const blockAddress = state.blitter && state.blitter.blockAddress !== undefined
      ? state.blitter.blockAddress & 0x7ffff : state.blitAddress & 0x7ffff;
    // BLITTER_START latches the first BCB at once (Altirra), so a program that
    // overwrites it right after starting the blitter does not change this blit.
    const block = state.blitter && state.blitter.preloadedBlock
      ? state.blitter.preloadedBlock : readBlitBlock(state, blockAddress);
    state.blitter = {
      blockAddress: blockAddress,
      source: (block[0] | (block[1] << 8) | (block[2] << 16)) & 0x7ffff,
      sourceYStep: signed(block[3] | ((block[4] & 0x1f) << 8), 13),
      sourceXStep: signed(block[5], 8),
      destination: (block[6] | (block[7] << 8) | (block[8] << 16)) & 0x7ffff,
      destinationYStep: signed(block[9] | ((block[10] & 0x1f) << 8), 13),
      destinationXStep: signed(block[11], 8),
      width: 1 + block[12] + ((block[13] & 0x01) << 8),
      height: 1 + block[14],
      dataAnd: block[15], dataXor: block[16], collisionMask: block[17],
      zoomX: 1 + (block[18] & 0x07), zoomY: 1 + ((block[18] >>> 4) & 0x07),
      patternEnabled: (block[19] & 0x80) !== 0, patternWidth: 1 + (block[19] & 0x3f),
      mode: block[20] & 0x07, next: (block[20] & 0x08) !== 0,
      constantFetchPending: block[15] === 0,
      x: 0, y: 0, repeatX: 0, repeatY: 0,
    };
    state.blitterBusy = 0x02;
  }

  // AHRM 12.4: bit n enables destination values $20n-$20n+1F, with $00
  // transparent (bit 0 therefore covers $01-1F, bit 1 covers $20-3F).
  function byteCollisionEnabled(mask, value) {
    return value !== 0 && (mask & (1 << (value >>> 5))) !== 0;
  }

  function nibbleCollisionEnabled(mask, value) {
    return value !== 0 && (mask & (1 << (value === 1 ? 0 : value >>> 1))) !== 0;
  }

  function recordByteBlitCollision(state, work, source, destination) {
    if (state.blitCollisionCode === 0 && source !== 0 &&
        byteCollisionEnabled(work.collisionMask, destination)) state.blitCollisionCode = destination & 0xff;
  }

  function recordNibbleBlitCollision(state, work, source, destination, high) {
    const sourceNibble = high ? source >>> 4 : source & 0x0f;
    const destinationNibble = high ? destination >>> 4 : destination & 0x0f;
    if (state.blitCollisionCode === 0 && sourceNibble !== 0 &&
        nibbleCollisionEnabled(work.collisionMask, destinationNibble))
      {state.blitCollisionCode = high ? destination & 0xf0 : destination & 0x0f;}
  }

  function applyBlitOperation(state, work, source, destination) {
    switch (work.mode) {
      case 0: return source;
      case 1:
        if (source === 0) return destination;
        recordByteBlitCollision(state, work, source, destination);
        return source;
      case 2:
        recordByteBlitCollision(state, work, source, destination);
        return (destination + source) & 0xff;
      case 3:
        recordByteBlitCollision(state, work, source, destination);
        return destination | source;
      case 4:
        recordByteBlitCollision(state, work, source, destination);
        return destination & source;
      case 5:
        recordByteBlitCollision(state, work, source, destination);
        return destination ^ source;
      case 6:
        recordNibbleBlitCollision(state, work, source, destination, true);
        recordNibbleBlitCollision(state, work, source, destination, false);
        return (source & 0xf0 ? source & 0xf0 : destination & 0xf0) |
          (source & 0x0f ? source & 0x0f : destination & 0x0f);
      default: return destination;
    }
  }

  function finishBlitterBlock(state, deferIrq) {
    const work = state.blitter;
    if (work.next) {
      // Altirra loads every linked BCB as a new blit.  The collision result
      // belongs to that one block and is cleared before the following block
      // begins, not merely when BLITTER_START is written.
      state.blitCollisionCode = 0;
      state.blitter = {
        blockAddress: (work.blockAddress + 21) & 0x7ffff,
        loadCyclesRemaining: 21,
      };
      state.blitterBusy = 0x01;
      return;
    }
    state.blitter = null;
    state.blitterBusy = 0;
    if (state.irqControl & 0x01) {
      if (deferIrq) state.blitterIrqPending = true;
      else state.irqStatus = 0x01;
    }
  }

  // AHRM 12.4, table 113. This is the local-VRAM cost of one completed
  // output byte when the bus is otherwise available. Source-fetch elision is
  // a separate one-cycle saving and cannot reduce an operation below its
  // destination-side/write cost.
  function blitByteCycles(work, source, sourceFetchSkipped) {
    let cycles;
    switch (work.mode) {
      case 0: cycles = 2; break;
      case 1:
        cycles = source === 0 ? 1 : (work.collisionMask ? 3 : 2);
        break;
      case 2:
      case 3:
      case 5:
      case 6: cycles = source === 0 ? 1 : 3; break;
      case 4: cycles = source === 0 ? 2 : 3; break;
      default: cycles = 3; break;
    }
    const total = cycles - (sourceFetchSkipped ? 1 : 0);
    return total < 1 ? 1 : total;
  }

  function advanceBlitter(state, budget, deferIrq, unscheduled) {
    if (!state || !state.enabled || state.blitterBusy === 0) return 0;
    let remaining = Math.max(0, budget | 0);
    const scheduled = !unscheduled && state.localBusSchedule &&
      state.localBusSchedule.length === LOCAL_BUS_SLOTS;
    // Free slots from the cursor onwards. Only consume() changes the
    // schedule while the blitter runs, so count once and keep it current
    // instead of rescanning every slot for each blitted byte.
    let freeFromCursor = -1;
    const scheduledFree = function () {
      if (!scheduled) return remaining;
      if (freeFromCursor < 0) {
        freeFromCursor = 0;
        for (let i = state.localBusCursor | 0; i < LOCAL_BUS_SLOTS; i++) {
          if (state.localBusSchedule[i] === 0) freeFromCursor++;
        }
      }
      return freeFromCursor;
    };
    const consume = function (cycles) {
      const count = cycles | 0;
      if (count <= 0) return true;
      if (!scheduled) {
        if (remaining < count) return false;
        remaining -= count;
        return true;
      }
      if (scheduledFree() < count) return false;
      let consumed = 0;
      for (let i = state.localBusCursor | 0;
        i < LOCAL_BUS_SLOTS && consumed < count; i++) {
        if (state.localBusSchedule[i] !== 0) continue;
        state.localBusSchedule[i] = 2;
        consumed++;
        state.localBusCursor = i + 1;
      }
      freeFromCursor -= consumed;
      remaining -= count;
      return true;
    };
    const consumeAvailable = function (cycles) {
      const count = Math.max(0, cycles | 0);
      if (!scheduled) {
        const taken = Math.min(remaining, count);
        remaining -= taken;
        return taken;
      }
      const taken = Math.min(scheduledFree(), count);
      if (taken > 0) consume(taken);
      return taken;
    };
    let completed = 0;
    while (remaining > 0 && state.blitterBusy !== 0) {
      if (state.blitterBusy === 0x01) {
        const loading = state.blitter;
        const loadCycles = loading.loadCyclesRemaining === undefined
          ? 21 : loading.loadCyclesRemaining | 0;
        if (remaining < loadCycles && !scheduled) {
          loading.loadCyclesRemaining = loadCycles - remaining;
          break;
        }
        if (scheduled && scheduledFree() < loadCycles) {
          const taken = consumeAvailable(loadCycles);
          loading.loadCyclesRemaining = loadCycles - taken;
          break;
        }
        if (!consume(loadCycles)) {
          loading.loadCyclesRemaining = loadCycles;
          break;
        }
        loadBlitterBlock(state);
        continue;
      }
      const work = state.blitter;
      // Altirra charges one initial source-read cycle for a constant-source
      // BCB. Subsequent output bytes can reuse that value and therefore take
      // the reduced per-byte cost from the AHRM table.
      if (work.constantFetchPending) {
        if (!consume(1)) break;
        work.constantFetchPending = false;
        continue;
      }
      // Whole-row fast path for the common unzoomed blit. Bytes are charged
      // exactly as the per-byte path below would charge them (same cost, same
      // free slots in the same order); only the bookkeeping is hoisted out of
      // the loop. The row's last byte stays with the per-byte path, which owns
      // the row/block rollover.
      if (work.zoomX === 1 && work.repeatX === 0 && work.width - work.x > 1) {
        const vram = state.vram;
        const dataAnd = work.dataAnd;
        const dataXor = work.dataXor;
        const sourceXStep = work.sourceXStep;
        const destinationXStep = work.destinationXStep;
        const patterned = work.patternEnabled;
        const patternWidth = work.patternWidth;
        const sourceRow = work.source + work.y * work.sourceYStep;
        const destinationRow = work.destination +
          (work.y * work.zoomY + work.repeatY) * work.destinationYStep;
        const fetchSkipped = dataAnd === 0;
        const mode = work.mode;
        const last = work.width - 1;
        let x = work.x;
        let rem = remaining;
        let free = scheduled ? scheduledFree() : remaining;
        let used = 0;
        while (x < last && rem > 0) {
          const sourceX = patterned ? x % patternWidth : x;
          const source = ((vram[(sourceRow + sourceX * sourceXStep) & 0x7ffff] & dataAnd) ^ dataXor) & 0xff;
          const cycles = blitByteCycles(work, source, fetchSkipped);
          if (scheduled ? free < cycles : rem < cycles) break;
          const destinationAddress = (destinationRow + x * destinationXStep) & 0x7ffff;
          if (mode === 0) vram[destinationAddress] = source;
          else {vram[destinationAddress] = applyBlitOperation(
            state, work, source, vram[destinationAddress] & 0xff);}
          rem -= cycles;
          free -= cycles;
          used += cycles;
          x++;
        }
        if (x > work.x) {
          completed += x - work.x;
          work.x = x;
          consume(used);
          continue;
        }
      }
      const sourceX = work.patternEnabled ? work.x % work.patternWidth : work.x;
      const sourceAddress = (work.source + work.y * work.sourceYStep +
        sourceX * work.sourceXStep) & 0x7ffff;
      const outputX = work.x * work.zoomX + work.repeatX;
      const outputY = work.y * work.zoomY + work.repeatY;
      const destinationAddress = (work.destination + outputY * work.destinationYStep +
        outputX * work.destinationXStep) & 0x7ffff;
      const source = ((state.vram[sourceAddress] & work.dataAnd) ^ work.dataXor) & 0xff;
      const sourceFetchSkipped = work.dataAnd === 0 || work.repeatX !== 0;
      const cycles = blitByteCycles(work, source, sourceFetchSkipped);
      if (!consume(cycles)) break;
      state.vram[destinationAddress] = applyBlitOperation(
        state, work, source, state.vram[destinationAddress] & 0xff);
      completed++;
      work.repeatX++;
      if (work.repeatX < work.zoomX) continue;
      work.repeatX = 0;
      work.x++;
      if (work.x < work.width) continue;
      work.x = 0;
      work.repeatY++;
      if (work.repeatY < work.zoomY) continue;
      work.repeatY = 0;
      work.y++;
      if (work.y < work.height) continue;
      finishBlitterBlock(state, deferIrq);
      if (state.blitterIrqPending) state.blitterIrqResidual = remaining;
    }
    return completed;
  }

  // The renderer supplies a whole-scanline local-bus budget, while the FX
  // completion signal is visible part way through that line.  Keep the
  // completed remainder in local cycles so the machine scheduler can expose
  // the IRQ at the corresponding CPU-cycle position.
  function scheduleBlitterIrq(state) {
    if (!state || !state.blitterIrqPending) return -1;
    const residual = state.blitterIrqResidual | 0;
    state.blitterIrqPending = false;
    state.blitterIrqScheduled = true;
    state.blitterIrqResidual = 0;
    return residual;
  }

  function raiseScheduledBlitterIrq(state) {
    if (!state || !state.blitterIrqScheduled) return false;
    state.blitterIrqScheduled = false;
    state.irqStatus = 0x01;
    return true;
  }

  function startBlitter(state) {
    if (!state || !state.enabled || state.blitterBusy !== 0) return;
    state.blitCollisionCode = 0;
    state.blitter = {
      blockAddress: state.blitAddress & 0x7ffff,
      loadCyclesRemaining: 21,
      preloadedBlock: Array.from(readBlitBlock(state, state.blitAddress & 0x7ffff)),
    };
    state.blitterBusy = 0x01;
  }

  // Altirra executes the rest of the current scanline's blitter budget as
  // soon as BLITTER_START is written, so a guest that polls the collision
  // code right after starting a blit already sees the rows completed in that
  // slice. The line-end budget of this line is then consumed, not repeated.
  // Returns the free slots left in the line when the blit completed (for the
  // completion-IRQ position), or -1.
  function startBlitterMidLine(state, slotsLeftInLine, line) {
    if (!state || state.blitterBusy === 0) return -1;
    state.blitterEarlyRun = true;
    // The blitter only gets what display DMA leaves free (AHRM 12.4).
    const free = LOCAL_BUS_SLOTS - lineDmaSlots(state, line);
    advanceBlitter(state, Math.min(slotsLeftInLine, free), true, true);
    return scheduleBlitterIrq(state);
  }

  function stopBlitter(state) {
    if (!state) return;
    state.blitter = null;
    state.blitterBusy = 0;
    // BLITTER_START=0 cancels Altirra's pending completion scheduler event.
    // It does not acknowledge an IRQ that already fired; IRQ_CONTROL remains
    // responsible for that level-sensitive latch.
    state.blitterIrqPending = false;
    state.blitterIrqScheduled = false;
    state.blitterIrqResidual = 0;
  }

  function nextXdlLine(state, scanline) {
    if (!state) return null;
    state.xdlSlots = 0;
    if (!(state.videoControlActive & 1) || (scanline | 0) < 8) return null;
    const x = state.xdl;
    // Altirra's XDL engine applies END after the entry's complete repeat run,
    // not when the terminating entry is first decoded.
    if (x.ended && x.repeat === 0) return null;
    const read = function () {
      return state.vram[(x.address++) & 0x7ffff];
    };
    let attributeMapReload = false;
    if (x.repeat === 0) {
      // A new entry claims exactly the bytes it contains; repeated lines
      // reuse the latched entry without another XDL fetch.
      const c0 = read(); const c1 = read();
      // Match Altirra's kOvModeTable: control bits 0-1 select text or
      // graphics, while the combined value 3 is an invalid/disabled mode.
      // Bit 2 has priority and explicitly disables the overlay.
      const modeBits = c0 & 0x03;
      if (c0 & 0x04) {
        x.mode = "off";
        x.enabled = false;
      } else if (modeBits === 1) {
        x.mode = "text";
        x.enabled = true;
      } else if (modeBits === 2) {
        x.mode = (c1 & 0x10) ? "hires" : ((c1 & 0x20) ? "lores" : "standard");
        x.enabled = true;
      } else if (modeBits === 3) {
        x.mode = "off";
        x.enabled = false;
      }
      if (c0 & 0x10) x.attributeMapEnabled = false;
      else if (c0 & 0x08) {
        x.attributeMapEnabled = true;
        // AHRM 12.4: AtMapOn restarts the buffered map row.  The line
        // buffer must be refilled even when the prior row counter had not
        // rolled over.
        attributeMapReload = true;
      }
      if (c0 & 0x10) x.attributeBuffer = null;
      if (c0 & 0x20) x.repeat = read();
      if (c0 & 0x40) { x.overlayAddress = read() | (read() << 8) | ((read() & 7) << 16); x.overlayStride = read() | ((read() & 15) << 8); }
      // XDLC_OVSCRL carries only the three pixel-offset bits used by text
      // mode.  The unused high bits read from VRAM do not survive the latch.
      if (c0 & 0x80) { x.textScrollX = read() & 7; x.textScrollY = read() & 7; }
      if (c1 & 1) x.characterBase = read() << 11;
      if (c1 & 2) {
        x.attributeAddress = read() | (read() << 8) | ((read() & 7) << 16);
        // AHRM 12.4 stores stride bits 7-2 in their native byte positions;
        // bits 1-0 are zero because attribute-map rows are four-byte aligned.
        x.attributeStride = (read() & 0xfc) | ((read() & 0x0f) << 8);
        // Readdressing also invalidates the on-chip line buffer.
        attributeMapReload = true;
      }
      if (c1 & 4) {
        // Altirra latches the two scroll counters verbatim and expands only
        // the two cell-size fields. The counters are five-bit delta counters;
        // values beyond a cell dimension deliberately overscroll through the
        // 32-position wrap, rather than being conventional pixel offsets.
        x.attributeScrollX = read() & 0x1f;
        x.attributeScrollY = read() & 0x1f;
        x.attributeCellWidth = (read() & 0x1f) + 1;
        x.attributeCellHeight = (read() & 0x1f) + 1;
      }
      if (c1 & 8) {
        const misc = read();
        // Altirra's XDLC_ATT decode: bits 7-6 select the ANTIC playfield
        // palette, bits 5-4 select the overlay palette, and width %11 is
        // the narrow-width alias.  Preserve all three latches even when the
        // current renderer does not yet consume every geometry variant.
        x.overlayWidth = (misc & 0x03) === 0x03 ? 0 : misc & 0x03;
        x.playfieldPalette = misc >>> 6;
        x.overlayPalette = (misc >>> 4) & 0x03;
        x.priority = read();
      }
      // Altirra restarts text rendering at the latched vertical scroll for
      // every newly decoded XDL entry, not at the previous entry's row.
      x.textRow = x.textScrollY & 7;
      if (c1 & 0x80) x.ended = true;
      if (attributeMapReload) x.attributeRow = x.attributeScrollY;
      // AHRM 12.4: the XDL update occupies 22 local cycles after the active
      // overlay region, independent of the descriptor byte count. Repeated
      // lines skip the update entirely and therefore leave xdlSlots at zero.
      state.xdlSlots = XDL_UPDATE_CYCLES;
    } else {
      // The repeat byte is the number of *additional* mode lines.  Keep its
      // full value for the line that loaded the entry, then consume one on
      // each following line (AHRM 12.4, XDL repeat count).
      x.repeat--;
    }
    if (x.attributeMapEnabled && (attributeMapReload || x.attributeRow === 0)) {
      // AHRM buffers exactly 43 four-byte cells during horizontal blanking.
      // Reload both after an AtMap/address update and after the row counter
      // wraps on a repeated XDL entry. Rendering must use this snapshot for
      // the complete line so a MEMAC write during active display cannot alter
      // already fetched cells.
      loadAttributeMapBuffer(state, x);
      attributeMapReload = true;
    }
    const line = (x.enabled || x.attributeMapEnabled) ? {
      mode: x.mode, overlayEnabled: !!x.enabled,
      address: x.overlayAddress & 0x7ffff,
      stride: x.overlayStride & 0xfff,
      overlayWidth: x.overlayWidth,
      playfieldPalette: x.playfieldPalette,
      overlayPalette: x.overlayPalette,
      priority: x.priority,
      characterBase: x.characterBase & 0x7ffff,
      textScrollX: x.textScrollX & 7,
      textScrollY: x.textScrollY & 7,
      textRow: x.textRow & 7,
      attributeMapEnabled: !!x.attributeMapEnabled,
      attributeAddress: x.attributeAddress & 0x7ffff,
      attributeStride: x.attributeStride & 0xffc,
      attributeScrollX: x.attributeScrollX,
      attributeScrollY: x.attributeScrollY,
      attributeCellWidth: x.attributeCellWidth,
      attributeCellHeight: x.attributeCellHeight,
      attributeRow: x.attributeRow,
      attributeMapReload: attributeMapReload,
      attributeBuffer: x.attributeBuffer,
    } : null;
    if (x.enabled) {
      if (x.mode === "text") {
        x.textRow = (x.textRow + 1) & 7;
        if (x.textRow === 0) x.overlayAddress = (x.overlayAddress + x.overlayStride) & 0x7ffff;
      } else {
        x.overlayAddress = (x.overlayAddress + x.overlayStride) & 0x7ffff;
      }
    }
    if (x.attributeMapEnabled) {
      // Match EndScanline in Altirra: mAttrRow is a five-bit counter.  The
      // local map row address advances only on its comparison with the cell
      // height, which gives the documented extended first row on overscroll.
      x.attributeRow = (x.attributeRow + 1) & 0x1f;
      if (x.attributeRow === x.attributeCellHeight) {
        x.attributeRow = 0;
        x.attributeAddress = (x.attributeAddress + x.attributeStride) & 0x7ffff;
      }
    }
    return line;
  }

  function collisionBitsForPriority(priority, gtiaMode) {
    const layers = priority & 0xffff;
    // VBXE samples the final color inputs.  In GTIA's special color modes the
    // active input expands to the complete hardware group rather than the
    // ordinary GTIA object-collision layer.  Altirra FX 1.26 mode-F probes
    // establish the GTIA-10 resulting COLDETECT mask.
    if (layers !== 0 && gtiaMode === 2) return 0x7f;
    let result = 0;
    if (layers & (PRIO_PM0 | PRIO_M10_PM0)) result |= 0x01;
    if (layers & (PRIO_PM1 | PRIO_M10_PM1)) result |= 0x02;
    if (layers & (PRIO_PM2 | PRIO_M10_PM2)) result |= 0x04;
    if (layers & (PRIO_PM3 | PRIO_M10_PM3)) result |= 0x08;
    if (layers & PRIO_PF0) result |= 0x10;
    if (layers & PRIO_PF1) result |= 0x20;
    if (layers & (PRIO_PF2 | PRIO_PF3)) result |= 0x40;
    return result;
  }

  function overlayWinsPriority(profile, visiblePriority, priorityMask) {
    const layers = visiblePriority & 0xffff;
    if (profile === "fx1.20" || profile === "fx1.24") {
      // AHRM table 109: pre-1.26 boards have no background priority bit.
      // Thus a $00 mask still displays above a plain background; only PF2 and
      // PF3/P5 can be overridden by bits 6 and 7 respectively.
      return layers === 0 ||
        ((layers & PRIO_PF2) !== 0 && (priorityMask & 0x40) !== 0) ||
        ((layers & PRIO_PF3) !== 0 && (priorityMask & 0x80) !== 0);
    }
    return layers === 0
      ? (priorityMask & 0x80) !== 0
      : ((layers & 0x01) !== 0 && (priorityMask & 0x10) !== 0) ||
        ((layers & 0x02) !== 0 && (priorityMask & 0x20) !== 0) ||
        ((layers & 0x0c) !== 0 && (priorityMask & 0x40) !== 0) ||
        ((layers & 0x10) !== 0 && (priorityMask & 0x01) !== 0) ||
        ((layers & 0x20) !== 0 && (priorityMask & 0x02) !== 0) ||
        ((layers & 0x40) !== 0 && (priorityMask & 0x04) !== 0) ||
        ((layers & 0x80) !== 0 && (priorityMask & 0x08) !== 0);
  }

  // VIDEO_CONTROL D2 selects an opaque overlay when set; with D2 clear (the
  // reset value) overlay color 0 is transparent, and D3 additionally makes
  // color $F transparent. This is Altirra's WriteControl/RenderOverlay
  // behaviour (mbOvTrans = (value & 4) == 0) and what real VBXE software such
  // as the D600 demo and Popeye relies on; the AHRM prose states the D2
  // polarity the other way round. Returns 0 opaque, 1 color 0, 3 colors 0/15.
  function overlayTransparency(state) {
    const control = state.videoControlActive;
    if ((control & 0x04) !== 0) return 0;
    return (control & 0x08) !== 0 ? 3 : 1;
  }

  function overlayCollisionEnabled(state, color) {
    return (state.collisionMask & (1 << ((color & 0xff) >>> 5))) !== 0;
  }

  function attributeMapCell(state, line, standardX) {
    if (!line || !line.attributeMapEnabled) return null;
    const width = line.attributeCellWidth | 0;
    const height = line.attributeCellHeight | 0;
    if (width < 1 || width > 32 || height < 1 || height > 32) return null;
    const rawScroll = line.attributeScrollX & 0x1f;
    const effectiveScroll = rawScroll >= width ? rawScroll - 32 : rawScroll;
    const x = (standardX | 0) + effectiveScroll;
    // For a negative overscroll offset, Altirra keeps fetching the first
    // buffered cell until the counter reaches zero. Do not turn that into a
    // fictitious preceding map column.
    const column = x < 0 ? 0 : (x / width) | 0;
    // AHRM 12.4 limits the buffered line to 43 four-byte cells.
    if (column < 0 || column >= 43) return null;
    // `attributeAddress` already names the currently buffered map row. Its
    // five-bit vertical counter is advanced by nextXdlLine after each line.
    const buffer = line.attributeBuffer;
    const address = (column << 2) | 0;
    // Every pixel of a cell shares the same four bytes, and a buffered row is
    // never modified (a reload installs a new buffer). Keep the decoded cells
    // on the buffer so they survive across the scanlines of a map row; only
    // the priority register is re-read because it can change between spans.
    let cache;
    if (buffer) {
      cache = buffer.cellCache;
      if (cache === undefined) cache = buffer.cellCache = new Array(43);
    }
    const cached = buffer ? cache[column] : undefined;
    if (cached !== undefined) {
      cached.priority = state.priority[cached.control & 0x03] & 0xff;
      return cached;
    }
    // Called for every rendered pixel, so read the four cell bytes directly
    // instead of allocating a reader closure per call.
    let playfield0, playfield1, playfield2, control;
    if (buffer) {
      playfield0 = buffer[address] & 0xff;
      playfield1 = buffer[address + 1] & 0xff;
      playfield2 = buffer[address + 2] & 0xff;
      control = buffer[address + 3] & 0xff;
    } else {
      const base = line.attributeAddress + address;
      playfield0 = state.vram[base & 0x7ffff] & 0xff;
      playfield1 = state.vram[(base + 1) & 0x7ffff] & 0xff;
      playfield2 = state.vram[(base + 2) & 0x7ffff] & 0xff;
      control = state.vram[(base + 3) & 0x7ffff] & 0xff;
    }
    const cell = { control: control, playfield0: playfield0, playfield1: playfield1,
      playfield2: playfield2, reverse: (control & 0x04) !== 0,
      playfieldPalette: (control >>> 6) & 0x03,
      overlayPalette: (control >>> 4) & 0x03,
      priority: state.priority[control & 0x03] & 0xff };
    // An unbuffered row reads live VRAM, which the CPU may change mid-line.
    if (buffer) cache[column] = cell;
    return cell;
  }

  // AHRM 12.4 calls out the PF3 bitmap separately from the map cell itself:
  // the mask begins at the left edge of each scrolled cell and is sampled at
  // 1, 2, or 4 standard-resolution pixels per bit according to cell width.
  function attributeMapPf3MaskBit(line, standardX, mask) {
    // Called for every pixel; most cells carry an empty mask.
    if ((mask & 0xff) === 0) return false;
    const width = line.attributeCellWidth | 0;
    if (width < 1 || width > 32) return false;
    const rawScroll = line.attributeScrollX & 0x1f;
    const x = (standardX | 0) + (rawScroll >= width ? rawScroll - 32 : rawScroll);
    const remainder = x % width;
    const cellX = remainder < 0 ? remainder + width : remainder;
    const bitPixelWidth = width <= 8 ? 1 : (width <= 16 ? 2 : 4);
    const bit = 7 - ((cellX / bitPixelWidth) | 0);
    return (mask & (1 << bit)) !== 0;
  }

  function isAnticHiresSource(line) {
    // AHRM 4.2 identifies modes 2, 3, and F as ANTIC hires modes. Reverse
    // groups their decoded bit stream into PF0-PF3 pairs.
    const mode = line.anticMode & 0x0f;
    return mode === 0x02 || mode === 0x03 || mode === 0x0f;
  }

  function hasGtiaSpecialMode(line) {
    return !!line && (line.anticGtiaMode & 0x03) !== 0;
  }

  function isGtiaReverseBlackMode(line) {
    const mode = line ? line.anticGtiaMode & 0x03 : 0;
    // FX 1.26 makes the validated reversed-hires combinations in every GTIA
    // special mode opaque palette color 0. The rule is intentionally limited
    // to valid raw hires pairs; other source-mode combinations remain open.
    return mode !== 0;
  }

  function isGtiaMode10(line) {
    return !!line && (line.anticGtiaMode & 0x03) === 2;
  }

  function isGtiaMode9Or11(line) {
    const mode = line ? line.anticGtiaMode & 0x03 : 0;
    return mode === 1 || mode === 3;
  }

  function reverseHiresColor(line, map, sourceBits, pixel) {
    if (!sourceBits) return -1;
    const pair = pixel & ~1;
    const left = sourceBits[pair];
    const right = sourceBits[pair + 1];
    // $ff marks a position outside mode-F's fetched ANTIC data. Do not let
    // border/special-mode pixels acquire a fabricated playfield color.
    if (left > 1 || right > 1) return -1;
    switch ((left << 1) | right) {
      case 0: return map.playfield0;
      case 1: return map.playfield1;
      case 2: return map.playfield2;
      default: return line.anticPf3 & 0xff;
    }
  }

  function isAnticLoresMode(line) {
    const mode = line.anticMode & 0x0f;
    // AHRM defines modes 4-E as lores. Two-bit sources retain their value;
    // modes 6/7 derive that value from the glyph bit and its PF0-PF3 character
    // color selector. ANTIC holds a lower-resolution source value across its
    // emitted pixels; each emitted copy is reinterpreted as the hires pair.
    return mode >= 0x04 && mode <= 0x0e;
  }

  function isAnticLoresCharacterMode(line) {
    const mode = line.anticMode & 0x0f;
    return mode === 0x04 || mode === 0x05;
  }

  function isAnticLoresSelectorCharacterMode(line) {
    const mode = line.anticMode & 0x0f;
    return mode === 0x06 || mode === 0x07;
  }

  function isAnticLoresGraphicsMode(line) {
    const mode = line.anticMode & 0x0f;
    // These graphics sources use the ordinary raw two-bit lores capture, but
    // their FX 1.26 GTIA-10 Reverse composition is independently tested.
    return mode >= 0x08 && mode <= 0x0e;
  }

  function isValidatedGtia9Or11GraphicsMode(line) {
    const anticMode = line.anticMode & 0x0f;
    // Altirra has established the opaque-palette-0 result for every graphics
    // mode 8-E in both GTIA 9 and 11. The caller has already excluded
    // ordinary and GTIA-10 composition.
    return anticMode >= 0x08 && anticMode <= 0x0e;
  }

  function reverseLoresColor(map, sourceValues, pixel) {
    if (!sourceValues) return -1;
    const source = sourceValues[pixel];
    if (source > 3) return -1;
    // Rev changes a two-bit lores value into two hires samples. Its high and
    // low bits select the PF1 luminance over a PF2 base respectively; they
    // are not remapped to PF1/PF2 colors. This follows AHRM's lores-to-hires
    // rule and preserves the original two-pixel phase.
    const highBit = (source >>> 1) & 1;
    const lowBit = source & 1;
    const bit = (pixel & 1) === 0 ? highBit : lowBit;
    return bit
      ? ((map.playfield2 & 0xf0) | (map.playfield1 & 0x0f))
      : map.playfield2;
  }

  function reverseLoresMode10Color(map, sourceValues, pixel) {
    if (!sourceValues) return -1;
    // In the externally validated FX 1.26 mode-4 case, GTIA mode 10 consumes
    // two adjacent two-bit lores values as one raw nibble. Of the measured
    // values, only nibble 1 selects the attribute cell's PF0; 2, 3, and $B
    // produce palette color 0. Keep this deliberately narrow until the other
    // lores modes and raw-nibble values have their own evidence.
    const group = pixel & ~3;
    const high = sourceValues[group];
    const low = sourceValues[group + 2];
    if (high > 3 || low > 3) return -1;
    return ((high << 2) | low) === 1 ? map.playfield0 : 0;
  }

  function hasReverseLoresSource(sourceValues, pixel) {
    return !!sourceValues && sourceValues[pixel] <= 3;
  }

  // Altirra RenderMode8: ANTIC hires (modes 2, 3, F, PRIOR top bits clear)
  // feeds the priority logic PF2 for every pixel. Only FX 1.26 with extended
  // color (VIDEO_CONTROL bit 1) lets set pixels carry PF1. A reverse
  // attribute cell reinterprets the data as lores, which has no such
  // substitution.
  function hiresPriorityForOverlay(state, anticMode, gtiaMode, attribute, visible) {
    const mode = anticMode & 0x0f;
    if ((mode !== 0x02 && mode !== 0x03 && mode !== 0x0f) || (gtiaMode & 0x03) !== 0 ||
        (attribute && attribute.reverse) || (visible & PRIO_PF1) === 0) return visible;
    const fx126 = state.profile === "fx1.26" || state.profile === "fx1.26r";
    if (fx126 && (state.videoControlActive & 0x02) !== 0) return visible;
    return (visible & ~PRIO_PF1) | PRIO_PF2;
  }

  function compositeOverlayPixel(state, video, target, targetPixel, priorityPixel, color, sourceByte, overlayPalette, priorityMask, attribute, gtiaMode, suppressCollisionReplay, anticMode) {
    const replayCollisions = suppressCollisionReplay !== true;
    if (replayCollisions && attribute && (attribute.control & 0x08)) {
      state.collisionDetect |= 0x80;
      state.collisionLineMask |= 0x80;
    }
    if (attribute) {
      overlayPalette = attribute.overlayPalette;
      priorityMask = attribute.priority;
    }
    const p = ((((overlayPalette === undefined ? 1 : overlayPalette) * 256) + color) * 3) | 0;
    const rgb = ((255 << 24) | (state.palette[p + 2] << 16) |
      (state.palette[p + 1] << 8) | state.palette[p]) >>> 0;
    const atariPriority = video.priority ? video.priority[priorityPixel] : 0;
    const storedContributors = video.vbxeCollisionPriority
      ? video.vbxeCollisionPriority[priorityPixel] & 0xffff
      : 0;
    const visiblePriority = hiresPriorityForOverlay(state, anticMode, gtiaMode, attribute,
      (storedContributors & VBXE_CONTRIBUTOR_VALID) !== 0
        ? storedContributors & ~VBXE_CONTRIBUTOR_VALID
        : atariPriority);
    if (replayCollisions && sourceByte !== null && overlayCollisionEnabled(state, sourceByte)) {
      // AHRM 12.4: COLMASK selects source-byte ranges and collision
      // detection is independent of whether the overlay wins its priority
      // comparison. The caller supplies the hardware-visible source byte for
      // its overlay mode.
      const collisionPriority = suppressCollisionReplay === "atari"
        ? atariPriority & (PRIO_PF0 | PRIO_PF1 | PRIO_PF2 | PRIO_PF3)
        : visiblePriority;
      const collisionBits = collisionBitsForPriority(collisionPriority, gtiaMode);
      state.collisionDetect |= collisionBits;
      state.collisionLineMask |= collisionBits;
    }
    // AHRM 12.4 defines both collision and overlay priority against the
    // color inputs that survive GTIA PRIOR processing. The raw priority plane
    // retains hidden P/M layers for normal GTIA collision handling, while this
    // optional plane removes them for VBXE.
    const wins = overlayWinsPriority(state.profile, visiblePriority, priorityMask);
    if (wins) target[targetPixel] = rgb;
  }

  function overlayWidthCode(line) {
    const width = line && line.overlayWidth !== undefined ? line.overlayWidth | 0 : 1;
    return width === 0 || width === 3 ? 0 : (width === 2 ? 2 : 1);
  }

  function overlayNativeWidth(line) {
    return OVERLAY_NATIVE_WIDTH[overlayWidthCode(line)];
  }

  function overlayLegacyStart(line) {
    // Altirra RenderOverlay bounds, converted from color clocks to jsA8E's
    // ANTIC line buffer: narrow $40-BF, normal $30-CF, wide $2C-D3.
    return OVERLAY_LEGACY_START[overlayWidthCode(line)];
  }

  function hiresTarget(video, scanline, signalWidth) {
    const width = video.vbxeHiresWidth | 0;
    const line = (scanline | 0) - 8;
    if (!video.vbxeHiresRgb || width < 640 || line < 0) return null;
    const activeWidth = signalWidth === undefined ? 640 : signalWidth | 0;
    if (activeWidth < 1 || activeWidth > width) return null;
    const base = line * width;
    return base + width <= video.vbxeHiresRgb.length
      ? { pixels: video.vbxeHiresRgb, width: width,
        base: base + ((width - activeWidth) >> 1), rowBase: base,
        signalWidth: activeWidth }
      : null;
  }

  function renderTextXdlLine(state, video, scanline, line, span) {
    const atariBase = (scanline | 0) * 456 + 128;
    const signalWidth = overlayNativeWidth(line);
    const target = hiresTarget(video, scanline, signalWidth);
    const pixels = target ? target.pixels : video.vbxeRgb;
    const base = target ? target.base : atariBase;
    const outputPixels = target ? signalWidth : 256;
    if (!span) {
      if (target) pixels.fill(0, target.rowBase, target.rowBase + target.width);
      else pixels.fill(0, base, base + 256);
    }
    const priorityMask = line.priority === undefined ? 0xff : line.priority;
    const transparency = overlayTransparency(state);
    const standardWidth = signalWidth >> 1;
    const outputStart = span
      ? (target ? (span[0] * 2) : Math.floor(span[0] * outputPixels / standardWidth))
      : 0;
    const outputEnd = span
      ? (target ? (span[1] * 2) : Math.ceil(span[1] * outputPixels / standardWidth))
      : outputPixels;
    for (let x = outputStart; x < outputEnd; x++) {
      const sourceX = (target ? x : Math.floor(x * 640 / 256)) + (line.textScrollX || 0);
      // textRow already starts at the latched vertical scroll (nextXdlLine),
      // so the scroll must not be added a second time.
      const sourceRow = line.textRow & 7;
      const cell = sourceX >> 3;
      const rowAddress = (line.address + Math.floor(sourceRow / 8) * (line.stride || 0)) & 0x7ffff;
      const cellAddress = (rowAddress + (cell << 1)) & 0x7ffff;
      const character = state.vram[cellAddress] & 0xff;
      const attribute = state.vram[(cellAddress + 1) & 0x7ffff] & 0xff;
      const glyph = state.vram[((line.characterBase || 0) + (character << 3) + (sourceRow & 7)) & 0x7ffff];
      const foreground = attribute & 0x7f;
      const glyphSet = (glyph & (0x80 >>> (sourceX & 7))) !== 0;
      if (!glyphSet && !(attribute & 0x80) && transparency >= 1) continue;
      const color = glyphSet ? foreground : ((attribute & 0x80) ? foreground | 0x80 : 0x80);
      if (color === 0 && transparency >= 1) continue;
      const priorityPixel = target
        ? (scanline | 0) * 456 + overlayLegacyStart(line) + (x >> 1)
        : atariBase + x;
      const map = attributeMapCell(state, line,
        target ? (x >> 1) : Math.floor(x * 320 / 256));
      // Altirra FX 1.26 text-collision probe: COLMASK selects the cell's
      // attribute byte, rather than its character name or fetched glyph byte.
      compositeOverlayPixel(state, video, pixels, base + x, priorityPixel, color, attribute, line.overlayPalette, priorityMask, map, line.anticGtiaMode, line.suppressCollisionReplay, line.anticMode);
    }
  }

  function clearXdlOutputLine(video, scanline) {
    if (!video || !video.vbxeRgb) return;
    const atariBase = (scanline | 0) * 456 + 88;
    if (atariBase >= 0 && atariBase + 336 <= video.vbxeRgb.length)
      {video.vbxeRgb.fill(0, atariBase, atariBase + 336);}
    const target = hiresTarget(video, scanline);
    if (target) target.pixels.fill(0, target.rowBase, target.rowBase + target.width);
  }

  function renderXdlLine(state, video, scanline, line, span) {
    if (!video || !video.vbxeRgb) return;
    if (!span && state) state.collisionLineMask = 0;
    // The presentation planes are an overlay, not a framebuffer. Clear this
    // scanline when XDL has been disabled at VSync so a prior attribute-map
    // result cannot survive after hardware has returned to pure ANTIC/GTIA.
    if (!line) {
      clearXdlOutputLine(video, scanline);
      return;
    }
    // The legacy and native presentation planes are mutually exclusive for a
    // given overlay mode. Clear both before drawing so a prior standard line
    // cannot leak through when this line switches to hires/text (or back).
    if (!span) clearXdlOutputLine(video, scanline);
    if (line.mode === "text") {
      renderTextXdlLine(state, video, scanline, line, span);
      return;
    }
    if (line.mode !== "standard" && line.mode !== "lores" && line.mode !== "hires") {
      // Attribute-map-only XDL entries have no overlay renderer to clear the
      // RGB plane.  Leaving its prior line contents in place both hides the
      // current map output and makes stale pixels survive across frames.
      if (!span) clearXdlOutputLine(video, scanline);
      return;
    }
    const hires = line.mode === "hires";
    const nativeWidth = overlayNativeWidth(line);
    const target = hires ? hiresTarget(video, scanline, nativeWidth) : null;
    const pixels = target ? target.pixels : video.vbxeRgb;
    const atariBase = target ? 0 : (scanline | 0) * 456 + overlayLegacyStart(line);
    const base = target ? target.base : atariBase;
    const outputPixels = target ? nativeWidth : (nativeWidth >> 1);
    const outputStart = span
      ? (target ? span[0] * 2 : span[0]) : 0;
    const outputEnd = span
      ? (target ? span[1] * 2 : span[1]) : outputPixels;
    const priorityMask = line.priority === undefined ? 0xff : line.priority;
    for (let x = outputStart; x < outputEnd; x++) {
      const sourceX = hires ? x : (line.mode === "lores" ? x >> 1 : x);
      // AHRM 12.4: hires graphics store two 4-bit pixels per byte, most
      // significant nibble first. COLMASK still selects the complete source
      // byte range rather than the unpacked nibble.
      const sourceByte = state.vram[(line.address + (hires ? (sourceX >> 1) : sourceX)) & 0x7ffff] & 0xff;
      const color = hires
        ? ((sourceX & 1) !== 0 ? sourceByte & 0x0f : sourceByte >>> 4)
        : sourceByte;
      const transparency = overlayTransparency(state);
      const transparent = (color === 0 && transparency >= 1) ||
        (transparency === 3 && (hires ? color === 0x0f : (color & 0x0f) === 0x0f));
      if (transparent) continue;
      const priorityPixel = target
        ? (scanline | 0) * 456 + overlayLegacyStart(line) + (x >> 1)
        : atariBase + x;
      const map = attributeMapCell(state, line,
        target ? (x >> 1) : x);
      compositeOverlayPixel(state, video, pixels, base + x, priorityPixel, color, sourceByte, line.overlayPalette, priorityMask, map, line.anticGtiaMode, line.suppressCollisionReplay, line.anticMode);
    }
  }

  function applyDefaultPlayfieldPalette(state, video, scanline, line, gtia, x1, x2) {
    if (!line || !line.playfieldPalette || !video || !video.vbxeRgb || !video.pixels) return;
    const scanBase = (scanline | 0) * 456;
    const start = overlayLegacyStart(line);
    const width = overlayNativeWidth(line) >> 1;
    const extendedColor = (state.videoControlActive & 0x02) !== 0;
    const pmMask = PRIO_PM0 | PRIO_PM1 | PRIO_PM2 | PRIO_PM3 |
      PRIO_M10_PM0 | PRIO_M10_PM1 | PRIO_M10_PM2 | PRIO_M10_PM3;
    const palette = line.playfieldPalette & 0x03;
    const first = Math.max(0, x1 === undefined ? 0 : x1 | 0);
    const last = Math.min(width, x2 === undefined ? width : x2 | 0);
    for (let x = first; x < last; x++) {
      const pixel = scanBase + start + x;
      if (pixel < 0 || pixel >= video.vbxeRgb.length ||
          (line.overlayEnabled !== false && video.vbxeRgb[pixel] !== 0)) continue;
      const stored = video.vbxeCollisionPriority ? video.vbxeCollisionPriority[pixel] & 0xffff : 0;
      const visible = (stored & VBXE_CONTRIBUTOR_VALID) !== 0
        ? stored & ~VBXE_CONTRIBUTOR_VALID
        : (video.priority ? video.priority[pixel] & 0xffff : 0);
      // VBXE shadows GTIA's playfield/background path, but never recolors a
      // player/missile color that won GTIA priority.
      if ((visible & pmMask) !== 0) continue;
      let color = video.pixels[pixel] & 0xff;
      if (gtia) {
        color = gtia[8];
        if (visible & PRIO_PF0) color |= gtia[4];
        if (visible & PRIO_PF1) color |= gtia[5];
        if (visible & PRIO_PF2) color |= gtia[6];
        if (visible & PRIO_PF3) color |= gtia[7];
      }
      color = extendedColor ? color : color & 0xfe;
      const p = (palette * 256 + color) * 3;
      video.vbxeRgb[pixel] = ((255 << 24) | (state.palette[p + 2] << 16) |
        (state.palette[p + 1] << 8) | state.palette[p]) >>> 0;
    }
  }

  function applyGtiaSpans(state, video, scanline, line, drawLine) {
    if (!line || !video || !video.vbxeRgb || !drawLine || drawLine.gtiaEventOverflow ||
        !drawLine.gtiaEventCount || !drawLine.gtiaInitialRegisters) return;
    const registers = new Uint8Array(drawLine.gtiaInitialRegisters);
    const width = overlayNativeWidth(line) >> 1;
    const start = overlayLegacyStart(line);
    let collisionClearPixel = -1;
    for (let i = 0; i < (drawLine.vbxeCollisionClearCount | 0); i++) {
      collisionClearPixel = Math.max(collisionClearPixel,
        Math.max(0, Math.min(width,
          24 + (drawLine.vbxeCollisionClearCycles[i] | 0) * 4 - start)));
    }
    // The line was composed once at its close, before the later GTIA writes
    // are replayed. Remove only map output before rebuilding the spans. A
    // standard/lores overlay lives in the legacy plane, so its native map
    // plane can be refreshed independently; hires/text share the native plane
    // and retain the existing overlay-pixel guard below.
    if (line.attributeMapEnabled) {
      if (!line.overlayEnabled) {
        const legacyBase = (scanline | 0) * 456 + start;
        if (legacyBase >= 0 && legacyBase + width <= video.vbxeRgb.length)
          {video.vbxeRgb.fill(0, legacyBase, legacyBase + width);}
      }
      if (!line.overlayEnabled || line.mode === "standard" || line.mode === "lores") {
        const target = hiresTarget(video, scanline, overlayNativeWidth(line));
        if (target) target.pixels.fill(0, target.rowBase, target.rowBase + target.width);
      }
    }
    // Rebuild the overlay and map together for every GTIA span. Altirra's
    // RenderScanline does this in one horizontal compositor; replaying the
    // same operation here prevents a mid-line PRIOR/transparency change from
    // leaving the overlay composed with the state from the first span.
    // Remove the contribution from the initial whole-line render before
    // recalculating it. Historical COLDETECT bits from earlier lines remain.
    if (state.collisionLineMask) {
      state.collisionDetect &= ~state.collisionLineMask;
      state.collisionLineMask = 0;
    }
    clearXdlOutputLine(video, scanline);
    function renderReplaySpan(spanLine, first, last) {
      if (last <= first) return;
      if (collisionClearPixel < 0 || last <= collisionClearPixel || first >= collisionClearPixel) {
        const replayLine = collisionClearPixel >= 0 && first < collisionClearPixel
          ? Object.assign({}, spanLine, { suppressCollisionReplay: true })
          : (collisionClearPixel >= 0
            ? Object.assign({}, spanLine, { suppressCollisionReplay: "atari" })
            : spanLine);
        renderXdlLine(state, video, scanline, replayLine, [first, last]);
        return;
      }
      renderXdlLine(state, video, scanline,
        Object.assign({}, spanLine, { suppressCollisionReplay: true }),
        [first, collisionClearPixel]);
      renderXdlLine(state, video, scanline,
        Object.assign({}, spanLine, { suppressCollisionReplay: "atari" }),
        [collisionClearPixel, last]);
    }
    let pixel = 0;
    for (let i = 0; i < drawLine.gtiaEventCount; i++) {
      const next = Math.max(0, Math.min(overlayNativeWidth(line) >> 1,
        24 + (drawLine.gtiaEventCycles[i] | 0) * 4 - start));
      const spanLine = Object.assign({}, line, {
        anticPf3: registers[7] & 0xff,
        anticGtiaMode: (registers[9] >>> 6) & 0x03,
      });
      renderReplaySpan(spanLine, pixel, next);
      applyPlayfieldAttributes(state, video, scanline, spanLine, registers, pixel, next);
      registers[drawLine.gtiaEventRegisters[i]] = drawLine.gtiaEventValues[i];
      pixel = next;
    }
    const finalLine = Object.assign({}, line, {
      anticPf3: registers[7] & 0xff,
      anticGtiaMode: (registers[9] >>> 6) & 0x03,
    });
    renderReplaySpan(finalLine, pixel, width);
    applyPlayfieldAttributes(state, video, scanline, finalLine, registers, pixel, width);
  }

  function applyPlayfieldAttributes(state, video, scanline, line,
    gtiaRegisters, x1, x2) {
    if (!line || !video || !video.vbxeRgb) return;
    if (!line.attributeMapEnabled) {
      applyDefaultPlayfieldPalette(state, video, scanline, line, gtiaRegisters, x1, x2);
      return;
    }
    // AHRM 12.4: the attribute map uses the same horizontal position and
    // width as the overlay, even when no overlay is enabled.
    const signalWidth = overlayNativeWidth(line);
    const standardWidth = signalWidth >> 1;
    const signalStart = overlayLegacyStart(line);
    const atariBase = (scanline | 0) * 456 + signalStart;
    if (atariBase < 0 || atariBase + standardWidth > video.vbxeRgb.length) return;
    const extendedColor = (state.videoControlActive & 0x02) !== 0;
    // The span's GTIA registers override two line fields while it renders;
    // restore them at the end instead of copying the whole line object.
    const renderLine = line;
    const savedPf3 = line.anticPf3;
    const savedGtiaMode = line.anticGtiaMode;
    if (gtiaRegisters) {
      line.anticPf3 = gtiaRegisters[7] & 0xff;
      line.anticGtiaMode = (gtiaRegisters[9] >>> 6) & 0x03;
    }
    const first = Math.max(0, x1 === undefined ? 0 : x1 | 0);
    const last = Math.min(standardWidth, x2 === undefined ? standardWidth : x2 | 0);

    // Mirror the final map color into the hires presentation plane, two
    // samples per standard-resolution pixel. The target width and source
    // position must follow the same narrow/normal/wide signal as the overlay.
    // Both planes get the same color, so decide it once per pixel and write
    // it to every plane whose overlay guard allows it.
    const nativeTarget = hiresTarget(video, scanline, signalWidth);
    const nativeAtariBase = (scanline | 0) * 456 + signalStart;
    const writeNative = !!nativeTarget && nativeAtariBase >= 0 &&
      nativeAtariBase + standardWidth <= video.priority.length;
    if (writeNative) {
      // Direct state callers do not have renderXdlLine's off-overlay clear.
      if (x1 === undefined && (!line.mode || line.mode === "off")) {
        nativeTarget.pixels.fill(0, nativeTarget.rowBase,
          nativeTarget.rowBase + nativeTarget.width);
      }
    }
    const overlayGuard = line.overlayEnabled !== false;
    const anticHires = isAnticHiresSource(renderLine);
    const cellWidth = renderLine.attributeCellWidth | 0;
    const rawScroll = renderLine.attributeScrollX & 0x1f;
    const effectiveScroll = rawScroll >= cellWidth ? rawScroll - 32 : rawScroll;
    const collisionPriority = video.vbxeCollisionPriority;
    const vbxeRgb = video.vbxeRgb;
    const palette = state.palette;
    let x = first;
    while (x < last) {
      // Every pixel of a map cell shares its four bytes, so look the cell up
      // once per run. A negative scrolled position keeps using the first
      // buffered cell until the counter reaches zero.
      const scrolled = x + effectiveScroll;
      let runEnd = cellWidth > 0
        ? (scrolled < 0 ? -effectiveScroll : (((scrolled / cellWidth) | 0) + 1) * cellWidth - effectiveScroll)
        : last;
      if (runEnd > last || runEnd <= x) runEnd = last;
      const map = attributeMapCell(state, renderLine, x);
      if (!map) { x = runEnd; continue; }
      const reverse = map.reverse;
      for (; x < runEnd; x++) {
        const pixel = atariBase + x;
        // A visible overlay already has its final RGB value in this plane and
        // must remain above the playfield override. A legacy standard/lores
        // overlay is still stored in vbxeRgb, so it also guards the native
        // plane while that renderer path is migrated.
        const legacyOverlay = vbxeRgb[pixel];
        const targetPixel = writeNative ? nativeTarget.base + x * 2 : 0;
        const toNative = writeNative &&
          !(overlayGuard && (nativeTarget.pixels[targetPixel] !== 0 || legacyOverlay !== 0));
        const toLegacy = !(overlayGuard && legacyOverlay !== 0);
        if (!toNative && !toLegacy) continue;
        const visible = collisionPriority &&
            (collisionPriority[pixel] & VBXE_CONTRIBUTOR_VALID) !== 0
          ? collisionPriority[pixel] & ~VBXE_CONTRIBUTOR_VALID
          : (video.priority ? video.priority[pixel] : 0);
        let color = -1;
        if (!reverse) {
          if (anticHires && (visible & PRIO_PF2) &&
              attributeMapPf3MaskBit(renderLine, x, map.playfield0)) {
            color = renderLine.anticPf3 & 0xff;
          } else if (visible & PRIO_PF0) color = map.playfield0;
          else if (visible & PRIO_PF1) color = map.playfield1;
          else if (visible & PRIO_PF2) color = map.playfield2;
        } else if (isGtiaReverseBlackMode(renderLine) && anticHires &&
            reverseHiresColor(renderLine, map, video.anticSourceBits, pixel) >= 0) {
          color = 0;
        } else if (isGtiaMode10(renderLine) && isAnticLoresCharacterMode(renderLine)) {
          color = reverseLoresMode10Color(map, video.anticSourceLores, pixel);
        } else if (isGtiaMode10(renderLine) && isAnticLoresSelectorCharacterMode(renderLine) &&
            hasReverseLoresSource(video.anticSourceLores, pixel)) {
          color = 0;
        } else if (isGtiaMode10(renderLine) && isAnticLoresGraphicsMode(renderLine)) {
          color = 0;
        } else if (isGtiaMode9Or11(renderLine) && isAnticLoresCharacterMode(renderLine) &&
            hasReverseLoresSource(video.anticSourceLores, pixel)) {
          color = 0;
        } else if (isGtiaMode9Or11(renderLine) && isAnticLoresSelectorCharacterMode(renderLine) &&
            hasReverseLoresSource(video.anticSourceLores, pixel)) {
          color = 0;
        } else if (isGtiaMode9Or11(renderLine) && isValidatedGtia9Or11GraphicsMode(renderLine)) {
          color = 0;
        } else if (!hasGtiaSpecialMode(renderLine) && anticHires) {
          color = reverseHiresColor(renderLine, map, video.anticSourceBits, pixel);
        } else if (!hasGtiaSpecialMode(renderLine) && isAnticLoresMode(renderLine)) {
          color = reverseLoresColor(map, video.anticSourceLores, pixel);
        } else if (visible & PRIO_PF0) color = map.playfield0;
        else if (visible & PRIO_PF1) color = map.playfield1;
        else if (visible & PRIO_PF2) color = map.playfield2;
        if (color === undefined || color === null || color < 0) continue;
        color = extendedColor ? color & 0xff : color & 0xfe;
        const p = ((map.playfieldPalette * 256 + color) * 3) | 0;
        const rgb = ((255 << 24) | (palette[p + 2] << 16) |
          (palette[p + 1] << 8) | palette[p]) >>> 0;
        if (toNative) {
          nativeTarget.pixels[targetPixel] = rgb;
          nativeTarget.pixels[targetPixel + 1] = rgb;
        }
        if (toLegacy) vbxeRgb[pixel] = rgb;
      }
    }
    line.anticPf3 = savedPf3;
    line.anticGtiaMode = savedGtiaMode;
  }

  function isAddress(state, address) {
    if (!state || !state.enabled) return false;
    const a = address & 0xffff;
    return a >= state.page && a < state.page + REGISTER_COUNT;
  }

  // Returns a local VRAM address for a CPU or ANTIC MEMAC request, or -1
  // when this device does not claim the Atari address. Hardware/ROM and
  // expansion-window precedence is intentionally decided by the bus mapper.
  function memacAddress(state, address, isAntic) {
    if (!state || !state.enabled) return -1;
    const addr = address & 0xffff;
    const accessBit = isAntic ? 0x04 : 0x08;
    const aSize = 0x1000 << (state.memacControl & 0x03);
    const aBase = (state.memacControl & 0xf0) << 8;
    if (
      (state.memacBankSelect & 0x80) !== 0 &&
      (state.memacControl & accessBit) !== 0 &&
      addr >= aBase && addr - aBase < aSize
    ) {
      const vramBase = ((state.memacBankSelect & 0x7f) << 12) & ~(aSize - 1);
      return (vramBase + addr - aBase) & 0x7ffff;
    }
    if (
      addr >= 0x4000 && addr < 0x8000 &&
      // Altirra maps bit 7 to CPU read/write and bit 6 to ANTIC DMA.
      (state.memacBControl & (isAntic ? 0x40 : 0x80)) !== 0
    ) {
      return (((state.memacBControl & 0x1f) << 14) + addr - 0x4000) & 0x7ffff;
    }
    return -1;
  }

  // AHRM 12.4: the RAMBO-capable core exposes the upper 256K of VBXE local
  // RAM through the normal 16K extended-memory window when PORTB D4 enables
  // it. PORTB D6,D5,D3,D2 are inverted and feed local address D17,D16,D15,D14.
  function ramboAddress(state, address, portB) {
    if (!state || !state.enabled || state.profile !== "fx1.26r") return -1;
    const addr = address & 0xffff;
    const port = portB & 0xff;
    if (addr < 0x4000 || addr >= 0x8000 || (port & 0x10) !== 0) return -1;
    const bank = ((port & 0x40) ? 0 : 0x20000) |
      ((port & 0x20) ? 0 : 0x10000) |
      ((port & 0x08) ? 0 : 0x08000) |
      ((port & 0x04) ? 0 : 0x04000);
    return (0x40000 + bank + addr - 0x4000) & 0x7ffff;
  }

  // Memory callers report the access kind and, when available, the CPU cycle
  // relative to the current display-list fetch. The trace is diagnostic state
  // as well as the source for temporal local-slot hints; aggregate counters
  // remain useful for compatibility with older callers and snapshots.
  function noteMemacAccess(state, accessKind, cpuCycle, lineStartCycle) {
    if (!state || !state.enabled) return;
    state.memacSlots = Math.min(912, (state.memacSlots | 0) + 1);
    const kind = accessKind === "cpu-write" || accessKind === "cpu-read" ||
      accessKind === "antic-read" ? accessKind : "cpu-read";
    const phase = kind === "cpu-write" ? 3 : 1;
    if (kind === "cpu-write") {
      state.memacWriteSlots = Math.min(912, (state.memacWriteSlots | 0) + 1);
    } else {
      // CPU reads and ANTIC fetches both use the AHRM read phase; the trace
      // retains their origin for later horizontal arbitration.
      state.memacReadSlots = Math.min(912, (state.memacReadSlots | 0) + 1);
    }
    if (!Array.isArray(state.memacTrace)) state.memacTrace = [];
    if (state.memacTrace.length < 2048) {
      const hasCycle = Number.isFinite(cpuCycle) && Number.isFinite(lineStartCycle);
      const lineCycle = hasCycle ? (cpuCycle | 0) - (lineStartCycle | 0) : -1;
      state.memacTrace.push({
        sequence: state.memacSequence++,
        kind: kind,
        phase: phase,
        cpuCycle: Number.isFinite(cpuCycle) ? (cpuCycle | 0) : null,
        lineCycle: lineCycle >= 0 && lineCycle < 114 ? lineCycle : -1,
        localSlot: lineCycle >= 0 && lineCycle < 114
          ? lineCycle * 8 + phase : -1,
      });
    }
  }

  // Slots reserved in the schedule currently being built; counting here avoids
  // rescanning all slots on every scanline.
  let reservedLocalSlots = 0;

  function reserveLocalSlot(schedule, index) {
    const slot = index | 0;
    if (slot < 0 || slot >= LOCAL_BUS_SLOTS || schedule[slot] !== 0) return false;
    schedule[slot] = 1;
    reservedLocalSlots++;
    return true;
  }

  function reserveFreeLocalSlots(schedule, start, count) {
    let remaining = Math.max(0, count | 0);
    for (let i = Math.max(0, start | 0);
      i < LOCAL_BUS_SLOTS && remaining > 0; i++) {
      if (reserveLocalSlot(schedule, i)) remaining--;
    }
    return remaining === 0;
  }

  // Local-bus slots that display DMA takes from this scanline: overlay fetch,
  // XDL entry and the attribute-map row reload (see buildLocalBusSchedule).
  function lineDmaSlots(state, line) {
    let slots = state.xdlSlots | 0;
    if (line && line.overlayEnabled) {
      const width = overlayWidthCode(line);
      slots += line.mode === "text" ? OVERLAY_TEXT_SLOTS[width]
        : OVERLAY_MACHINE_CYCLES[width] * (line.mode === "lores" ? 2 : 4);
    }
    if (line && line.attributeMapEnabled &&
        (line.attributeMapReload || line.attributeRow === 0)) slots += 43 * 4;
    return slots;
  }

  function reserveOverlaySlots(schedule, line) {
    if (!line || !line.overlayEnabled) return 0;
    const width = overlayWidthCode(line);
    // Altirra's overlay-start table is expressed in local-bus slots. The
    // subsequent fetch pattern advances in eight-slot machine-cycle groups.
    const start = OVERLAY_DMA_START[width];
    // The active widths are 128/160/168 color clocks, i.e. 64/80/84
    // machine-cycle positions. Each machine cycle contributes the even local
    // phases listed below, producing Altirra's 128/160/168 lores and
    // 256/320/336 standard/hires reservations.
    const machineCycles = OVERLAY_MACHINE_CYCLES[width];
    const phases = line.mode === "lores" ? [0, 4] : [0, 2, 4, 6];
    if (line.mode === "text") {
      // Text fetches three even-phase bytes per eight local slots. The
      // cycle counts intentionally match Altirra's 195/243/255 table.
      const count = OVERLAY_TEXT_SLOTS[width];
      const groups = Math.ceil(count / 3);
      for (let group = 0; group < groups; group++) {
        const base = start + group * 8;
        for (let phase = 0; phase < 3 && group * 3 + phase < count; phase++)
          {reserveLocalSlot(schedule, base + phase * 2);}
      }
      return count;
    }
    let count = 0;
    for (let cycle = 0; cycle < machineCycles; cycle++) {
      for (let i = 0; i < phases.length; i++) {
        if (reserveLocalSlot(schedule, start + cycle * 8 + phases[i])) count++;
      }
    }
    return count;
  }

  function buildLocalBusSchedule(state, line, lineStartCycle) {
    // Rebuilt every scanline; reuse the buffer instead of allocating one each time.
    const schedule = state.localBusSchedule && state.localBusSchedule.length === LOCAL_BUS_SLOTS
      ? state.localBusSchedule.fill(0)
      : new Uint8Array(LOCAL_BUS_SLOTS);
    reservedLocalSlots = 0;
    reserveOverlaySlots(schedule, line);
    // AHRM 12.4 assigns local-bus phase 1 to reads and phase 3 to writes.
    // Keep the legacy aggregate field as a read fallback for callers that
    // have not supplied an access kind yet.
    let memacReads = state.memacReadSlots | 0;
    let memacWrites = state.memacWriteSlots | 0;
    if (memacReads === 0 && memacWrites === 0 && state.memacSlots) {
      memacReads = state.memacSlots | 0;
    }
    // When the CPU/ANTIC caller supplied a cycle, preserve its relative
    // position instead of collapsing every access to the beginning of the
    // scanline. Un-timestamped accesses continue through the aggregate path.
    let timedReads = 0;
    let timedWrites = 0;
    const trace = Array.isArray(state.memacTrace) ? state.memacTrace : [];
    for (let i = 0; i < trace.length; i++) {
      const event = trace[i];
      if (event.localSlot < 0 || event.localSlot >= LOCAL_BUS_SLOTS) continue;
      if (Number.isFinite(lineStartCycle) && event.cpuCycle !== null) {
        const lineCycle = (event.cpuCycle | 0) - (lineStartCycle | 0);
        if (lineCycle >= 0 && lineCycle < 114) {
          event.lineCycle = lineCycle;
          event.localSlot = lineCycle * 8 + event.phase;
        }
      }
      if (event.localSlot < 0 || event.localSlot >= LOCAL_BUS_SLOTS) continue;
      if (reserveLocalSlot(schedule, event.localSlot)) {
        if (event.kind === "cpu-write") timedWrites++;
        else timedReads++;
      }
    }
    memacReads = Math.max(0, memacReads - timedReads);
    memacWrites = Math.max(0, memacWrites - timedWrites);
    for (let cycle = 0; cycle < LOCAL_BUS_MACHINE_CYCLES && memacReads > 0; cycle++) {
      if (reserveLocalSlot(schedule, cycle * 8 + 1)) memacReads--;
    }
    for (let cycle = 0; cycle < LOCAL_BUS_MACHINE_CYCLES && memacWrites > 0; cycle++) {
      if (reserveLocalSlot(schedule, cycle * 8 + 3)) memacWrites--;
    }
    const overlayEnd = line && line.overlayEnabled
      ? (OVERLAY_DMA_START[overlayWidthCode(line)] +
        (line.mode === "text"
          ? Math.ceil(OVERLAY_TEXT_SLOTS[overlayWidthCode(line)] / 3) * 8
          : OVERLAY_MACHINE_CYCLES[overlayWidthCode(line)] * 8))
      : 0;
    // XDL and the attribute row are scheduled after active overlay DMA. They
    // skip MEMAC slots because MEMAC preempts these lower-priority fetches.
    if (state.xdlSlots) reserveFreeLocalSlots(schedule, overlayEnd, state.xdlSlots);
    if (line && line.attributeMapEnabled &&
        (line.attributeMapReload || line.attributeRow === 0)) {
      const xdlEnd = overlayEnd + (state.xdlSlots | 0);
      reserveFreeLocalSlots(schedule, xdlEnd, 43 * 4);
    }
    // Keep the count observable for diagnostics and assert the schedule's
    // aggregate matches the existing AHRM budget contract.
    const free = LOCAL_BUS_SLOTS - reservedLocalSlots;
    // Keep the exact reserved-slot result if a future DMA shape overlaps
    // itself; do not invent cycles from the aggregate estimate.
    state.localBusSchedule = schedule;
    return free;
  }

  function localBusBudget(state, line, lineStartCycle) {
    if (!state || !state.enabled) return 0;
    const budget = buildLocalBusSchedule(state, line, lineStartCycle);
    state.lastMemacTrace = Array.isArray(state.memacTrace)
      ? state.memacTrace.map(event => Object.assign({}, event)) : [];
    state.memacTrace = [];
    state.localBusCursor = 0;
    state.memacSlots = 0;
    state.memacReadSlots = 0;
    state.memacWriteSlots = 0;
    state.xdlSlots = 0;
    return budget;
  }

  function getMemacTrace(state) {
    if (!state) return [];
    const completed = Array.isArray(state.lastMemacTrace) ? state.lastMemacTrace : [];
    const pending = Array.isArray(state.memacTrace) ? state.memacTrace : [];
    return completed.concat(pending).map(event => Object.assign({}, event));
  }

  function paletteOffset(state) {
    return (((state.paletteSelect & 0x03) * PALETTE_ENTRIES +
      (state.colorSelect & 0xff)) * PALETTE_COMPONENTS) | 0;
  }

  function access(state, address, value) {
    if (!state || !state.enabled) return null;
    const addr = address & 0xffff;
    // Altirra exposes the configuration serial pins across the final 64-byte
    // block of the device's $Dx00 page, independently of the $Dx40 register
    // bank. D0-D2 are latchable inputs; the emulated device leaves CONF_DONE
    // low, just like Altirra's mConfigLatch.
    const configBase = (state.page & 0xff00) | 0x00c0;
    if (addr >= configBase && addr < configBase + 0x40) {
      if (value === undefined || value === null) return state.configLatch & 0x07;
      state.configLatch = value & 0x07;
      return 0xff;
    }
    if (!isAddress(state, addr)) return null;
    const reg = (addr - state.page) & 0x1f;
    if (value === undefined || value === null) {
      switch (reg) {
        // Altirra 4.40 reports the full FX core as $10 for all selectable
        // revisions. This takes precedence over the older AHRM text that
        // labels the latest FX core $11.
        case 0x00: return 0x10;
        case 0x01:
          return state.profile === "fx1.20" ? 0x20 :
            state.profile === "fx1.24" ? 0x24 :
              (state.profile === "fx1.26r" ? 0xa6 : 0x26);
        case 0x0a: return state.collisionDetect & 0xff;
        case 0x10: return state.blitCollisionCode & 0xff;
        // AHRM 12.4: bit 0 denotes a control-block load and bit 1 denotes
        // active data processing. They are never set at the same time.
        case 0x13: return state.blitterBusy & 0x03;
        case 0x14: return state.irqStatus & 0x01;
        case 0x1e: return state.memacControl & 0xff;
        case 0x1f: return state.memacBankSelect & 0xff;
        default: return 0xff;
      }
    }

    const v = value & 0xff;
    switch (reg) {
      case 0x00:
        state.videoControlPending = v & 0x0f;
        // AHRM buffers only XDL enable (D0) until VSync. Extended color and
        // both transparency bits take effect immediately, as in Altirra's
        // WriteControl implementation.
        state.videoControlActive = (state.videoControlActive & 0x01) | (v & 0x0e);
        break;
      case 0x01:
        state.xdlAddressPending = (state.xdlAddressPending & 0x7ff00) | v;
        break;
      case 0x02:
        state.xdlAddressPending = (state.xdlAddressPending & 0x700ff) | (v << 8);
        break;
      case 0x03:
        state.xdlAddressPending = (state.xdlAddressPending & 0x0ffff) | ((v & 0x07) << 16);
        break;
      case 0x04:
        state.colorSelect = v;
        break;
      case 0x05:
        state.paletteSelect = v & 0x03;
        break;
      case 0x06:
      case 0x07:
      case 0x08: {
        const component = reg - 0x06;
        // The FPGA stores seven component bits. Altirra exposes the same
        // 8-bit expansion used by its palette corrector: D7 is copied into
        // D0 rather than forcing D0 low.
        state.palette[paletteOffset(state) + component] =
          (v & 0xfe) | (v >>> 7);
        if (reg === 0x08) state.colorSelect = (state.colorSelect + 1) & 0xff;
        break;
      }
      case 0x09:
        state.collisionMask = v;
        break;
      case 0x0a:
        state.collisionDetect = 0;
        break;
      case 0x10:
      case 0x11:
      case 0x12:
        state.blitAddress = (state.blitAddress & ~(0xff << ((reg - 0x10) * 8))) |
          ((reg === 0x12 ? v & 0x07 : v) << ((reg - 0x10) * 8));
        state.blitAddress &= 0x7ffff;
        break;
      case 0x13:
        if ((v & 0x01) === 0) stopBlitter(state);
        else startBlitter(state);
        break;
      case 0x14:
        state.irqControl = v & 0x01;
        state.irqStatus = 0;
        state.blitterIrqPending = false;
        state.blitterIrqScheduled = false;
        break;
      case 0x15:
      case 0x16:
      case 0x17:
      case 0x18:
        state.priority[reg - 0x15] = v;
        break;
      case 0x1d:
        state.memacBControl = v;
        break;
      case 0x1e:
        state.memacControl = v;
        break;
      case 0x1f:
        state.memacBankSelect = v;
        break;
      default:
        break;
    }
    return 0xff;
  }

  function cloneState(state) {
    if (!state) return null;
    return {
      enabled: !!state.enabled,
      profile: normalizeProfile(state.profile),
      page: state.page === 0xd740 ? 0xd740 : DEFAULT_PAGE,
      vram: new Uint8Array(state.vram || 0),
      palette: new Uint8Array(state.palette || 0),
      videoControlPending: state.videoControlPending & 0xff,
      videoControlActive: state.videoControlActive & 0xff,
      xdlAddressPending: state.xdlAddressPending & 0x7ffff,
      xdlAddressActive: state.xdlAddressActive & 0x7ffff,
      colorSelect: state.colorSelect & 0xff,
      paletteSelect: state.paletteSelect & 0x03,
      collisionMask: state.collisionMask & 0xff,
      collisionDetect: state.collisionDetect & 0xff,
      collisionLineMask: state.collisionLineMask & 0xff,
      blitAddress: state.blitAddress & 0x7ffff,
      blitCollisionCode: state.blitCollisionCode & 0xff,
      blitterBusy: state.blitterBusy & 0x03,
      blitter: state.blitter ? Object.assign({}, state.blitter) : null,
      irqStatus: state.irqStatus & 0x01,
      irqControl: state.irqControl & 0x01,
      blitterIrqPending: !!state.blitterIrqPending,
      blitterIrqScheduled: !!state.blitterIrqScheduled,
      blitterIrqResidual: state.blitterIrqResidual | 0,
      memacSlots: state.memacSlots | 0,
      memacReadSlots: state.memacReadSlots | 0,
      memacWriteSlots: state.memacWriteSlots | 0,
      memacTrace: Array.isArray(state.memacTrace)
        ? state.memacTrace.map(event => Object.assign({}, event)) : [],
      lastMemacTrace: Array.isArray(state.lastMemacTrace)
        ? state.lastMemacTrace.map(event => Object.assign({}, event)) : [],
      memacSequence: state.memacSequence | 0,
      xdlSlots: state.xdlSlots | 0,
      priority: new Uint8Array(state.priority || 0),
      memacBControl: state.memacBControl & 0xff,
      memacControl: state.memacControl & 0xff,
      memacBankSelect: state.memacBankSelect & 0xff,
      configLatch: state.configLatch & 0x07,
      xdl: Object.assign({}, state.xdl, {
        attributeBuffer: state.xdl.attributeBuffer
          ? new Uint8Array(state.xdl.attributeBuffer) : null,
      }),
    };
  }

  function restoreState(snapshot, fallbackConfig) {
    const source = snapshot && typeof snapshot === "object" ? snapshot : null;
    const state = createState(source || fallbackConfig);
    if (!source) return state;
    const copy = function (target, input) {
      if (input) target.set(new Uint8Array(input).subarray(0, target.length));
    };
    state.profile = normalizeProfile(source.profile);
    state.enabled = state.profile !== "off" && source.enabled !== false;
    state.page = source.page === 0xd740 ? 0xd740 : DEFAULT_PAGE;
    copy(state.vram, source.vram);
    copy(state.palette, source.palette);
    copy(state.priority, source.priority);
    ["videoControlPending", "videoControlActive", "colorSelect", "collisionMask",
      "collisionDetect", "blitCollisionCode", "blitterBusy", "irqStatus", "irqControl",
      "collisionLineMask",
      "memacSlots", "xdlSlots",
      "memacReadSlots", "memacWriteSlots",
      "memacBControl", "memacControl", "memacBankSelect", "configLatch"].forEach(function (key) {
      if (source[key] !== undefined) state[key] = source[key] & 0xff;
    });
    // The configuration pins expose only DATA0/DCLK/CONFIG; discard any
    // impossible upper bits from legacy or hand-authored snapshots.
    state.configLatch &= 0x07;
    state.blitterIrqPending = !!source.blitterIrqPending;
    state.blitterIrqScheduled = !!source.blitterIrqScheduled;
    state.blitterIrqResidual = source.blitterIrqResidual | 0;
    state.memacTrace = Array.isArray(source.memacTrace)
      ? source.memacTrace.map(event => Object.assign({}, event)) : [];
    state.lastMemacTrace = Array.isArray(source.lastMemacTrace)
      ? source.lastMemacTrace.map(event => Object.assign({}, event)) : [];
    state.memacSequence = source.memacSequence | 0;
    state.xdlAddressPending = source.xdlAddressPending & 0x7ffff;
    state.xdlAddressActive = source.xdlAddressActive & 0x7ffff;
    state.blitAddress = source.blitAddress & 0x7ffff;
    state.blitter = source.blitter ? Object.assign({}, source.blitter) : null;
    state.paletteSelect = source.paletteSelect & 0x03;
    if (source.xdl) {
      state.xdl = Object.assign(createXdlState(), source.xdl, {
        attributeBuffer: source.xdl.attributeBuffer
          ? new Uint8Array(source.xdl.attributeBuffer) : null,
      });
    }
    return state;
  }

  window.A8EVbxe = {
    VRAM_SIZE: VRAM_SIZE,
    normalizeConfig: normalizeConfig,
    normalizeProfile: normalizeProfile,
    createState: createState,
    softReset: softReset,
    powerCycle: powerCycle,
    verticalSync: verticalSync,
    advanceBlitter: advanceBlitter,
    startBlitterMidLine: startBlitterMidLine,
    scheduleBlitterIrq: scheduleBlitterIrq,
    raiseScheduledBlitterIrq: raiseScheduledBlitterIrq,
    localBusBudget: localBusBudget,
    nextXdlLine: nextXdlLine,
    renderXdlLine: renderXdlLine,
    applyPlayfieldAttributes: applyPlayfieldAttributes,
    applyGtiaSpans: applyGtiaSpans,
    attributeMapCell: attributeMapCell,
    collisionBitsForPriority: collisionBitsForPriority,
    overlayWinsPriority: overlayWinsPriority,
    isAddress: isAddress,
    memacAddress: memacAddress,
    ramboAddress: ramboAddress,
    noteMemacAccess: noteMemacAccess,
    getMemacTrace: getMemacTrace,
    access: access,
    cloneState: cloneState,
    restoreState: restoreState,
  };
})();
