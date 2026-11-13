/* global __dirname, console, process, require */

// The disk drive as a device of the generic SIO contract. The scenario below
// drives every disk command through the real pokey_sio.js and compares the
// complete SERIN byte stream, the media and the observer events with a golden
// trace recorded from the disk handler before it moved onto the contract
// (tests/fixtures/sio_disk_device.golden.json). A change in any byte or in the
// phase boundaries fails here.
//
// Regenerate the golden file only for an intended protocol change:
//   node tests/sio_disk_device.test.js --update

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const GOLDEN = path.join(__dirname, "fixtures", "sio_disk_device.golden.json");

function checksum(bytes) {
  let value = 0;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] & 0xff;
    value = (value + (((value + byte) >> 8) & 0xff) + byte) & 0xff;
  }
  return value & 0xff;
}

function loadApi() {
  const source = fs.readFileSync(path.join(__dirname, "..", "js", "core", "pokey_sio.js"), "utf8");
  const context = { console: console, Uint8Array: Uint8Array, Int16Array: Int16Array, Number: Number, Object: Object, Math: Math };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "pokey_sio.js" });
  const api = context.window.A8EPokeySio.createApi({
    IO_SEROUT_SERIN: 0xd20d,
    SERIAL_OUTPUT_DATA_NEEDED_CYCLES: 1,
    SERIAL_OUTPUT_TRANSMISSION_DONE_CYCLES: 1,
    SERIAL_INPUT_FIRST_DATA_READY_CYCLES: 1,
    SERIAL_INPUT_DATA_READY_CYCLES: 1,
    IO_IRQEN_IRQST: 0xd20e,
    CYCLE_NEVER: Number.POSITIVE_INFINITY,
    cycleTimedEventUpdate: function () {},
  });
  const raw = api.seroutWrite;
  api.seroutWrite = function (ctx, value) {
    raw(ctx, value);
    api.serialOutputTransmitNow(ctx);
  };
  return api;
}

function makeImage(sectorSize, sectors) {
  const bytes = new Uint8Array(16 + sectors * sectorSize);
  bytes[0] = 0x96;
  bytes[1] = 0x02;
  bytes[4] = sectorSize & 0xff;
  bytes[5] = (sectorSize >> 8) & 0xff;
  for (let i = 16; i < bytes.length; i++) bytes[i] = (i * 7 + sectorSize) & 0xff;
  return { bytes: bytes, size: bytes.length };
}

function makeContext(images, mounted, events) {
  const slots = new Int16Array(8).fill(-1);
  mounted.forEach(function (imageIndex, slot) { slots[slot] = imageIndex; });
  return {
    cycleCounter: 0,
    ram: new Uint8Array(0x10000),
    ioData: {
      sioBuffer: new Uint8Array(4096),
      sioOutIndex: 0,
      sioOutPhase: 0,
      sioDataIndex: 0,
      sioPendingDevice: 0,
      sioPendingCmd: 0,
      sioPendingSector: 0,
      sioPendingBytes: 0,
      sioInIndex: 0,
      sioInSize: 0,
      sioInReady: false,
      sioPendingReadSize: 0,
      sioPendingWriteResult: 0,
      sioDiskFdcStatus: new Uint8Array(8),
      serialOutputNeedDataCycle: Number.POSITIVE_INFINITY,
      serialOutputTransmissionDoneCycle: Number.POSITIVE_INFINITY,
      serialInputDataReadyCycle: 0,
      deviceSlots: slots,
      diskImages: images,
      diskMediaChangeObserver: function (imageIndex, deviceSlot) { events.push(["changed", imageIndex, deviceSlot]); },
      diskActivityObserver: function (a) { events.push(["activity", a.imageIndex, a.deviceSlot, a.operation]); },
    },
  };
}

function hex(bytes) {
  return Array.from(bytes, function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
}

function runScenario() {
  const api = loadApi();
  const events = [];
  const images = [makeImage(128, 12), makeImage(256, 12), makeImage(512, 6)];
  const ctx = makeContext(images, [0, 1, 2], events); // D1 single, D2 double, D3 512
  const trace = [];

  // Reads whatever the drive sends for the last frame: the SERIN bytes in the
  // order and phases the OS would see them.
  function drain() {
    const out = [];
    let guard = 0;
    while (guard++ < 5000) {
      api.serialInputReady(ctx);
      if (!ctx.ioData.sioInReady) break;
      out.push(api.serinRead(ctx));
    }
    return hex(out);
  }

  function frame(label, bytes) {
    bytes.forEach(function (b) { api.seroutWrite(ctx, b); });
    trace.push([label, drain(), ctx.ioData.sioInSize | 0, ctx.ioData.sioOutPhase | 0, events.splice(0)]);
  }

  function command(label, device, cmd, aux1, aux2) {
    const f = [device, cmd, aux1, aux2];
    f.push(checksum(f));
    frame(label, f);
  }

  function data(label, payload, goodChecksum) {
    const f = Array.from(payload);
    f.push(goodChecksum === false ? checksum(payload) ^ 0xff : checksum(payload));
    frame(label, f);
  }

  const sectorSizes = [128, 256, 512];
  for (let drive = 0; drive < 3; drive++) {
    const dev = 0x31 + drive;
    const size = sectorSizes[drive];
    const name = "D" + (drive + 1);
    command(name + " status", dev, 0x53, 0, 0);
    command(name + " status turbo marker", dev, 0x53, 0, 0x80);
    command(name + " read 1", dev, 0x52, 1, 0);
    command(name + " status after read", dev, 0x53, 0, 0);
    command(name + " read 5", dev, 0x52, 5, 0);
    command(name + " read out of range", dev, 0x52, 0xff, 0x7f);
    command(name + " read sector 0", dev, 0x52, 0, 0);
    command(name + " high speed index", dev, 0x3f, 0, 0);
    command(name + " poll", dev, 0x40, 0, 0);
    command(name + " motor on", dev, 0x55, 0, 0);
    command(name + " unknown command", dev, 0x21 + 0x20, 0, 0);

    const payload = new Uint8Array(size).map(function (_, i) { return (i * 3 + drive) & 0xff; });
    command(name + " write 2", dev, 0x57, 2, 0);
    data(name + " write 2 data", payload);
    command(name + " write 2 bad checksum", dev, 0x57, 2, 0);
    data(name + " write 2 bad data", payload, false);
    command(name + " write out of range", dev, 0x57, 0xff, 0x7f);
    command(name + " put 3", dev, 0x50, 3, 0);
    data(name + " put 3 data", payload);
    command(name + " verify 2 same", dev, 0x56, 2, 0);
    data(name + " verify 2 same data", payload);
    command(name + " verify 4 different", dev, 0x56, 4, 0);
    data(name + " verify 4 data", payload);
    command(name + " status after verify", dev, 0x53, 0, 0);
    command(name + " read 2 back", dev, 0x52, 2, 0);
    command(name + " format", dev, 0x21, 0, 0);
    command(name + " read 2 after format", dev, 0x52, 2, 0);
  }

  // Drives without a disk: every command is answered with a NAK, as before.
  command("D4 read (no disk)", 0x34, 0x52, 1, 0);
  command("D4 status (no disk)", 0x34, 0x53, 0, 0);
  command("D4 format (no disk)", 0x34, 0x21, 0, 0);
  command("D4 write (no disk)", 0x34, 0x57, 1, 0);
  command("D4 poll (no disk)", 0x34, 0x40, 0, 0);

  // A command frame with a bad checksum: a mounted disk NAKs it (the OS
  // first-byte race), an empty drive and an absent device stay silent.
  frame("bad checksum to D1", [0x31, 0x52, 1, 0, 0x00]);
  frame("bad checksum to D4", [0x34, 0x52, 1, 0, 0x00]);
  frame("bad checksum to absent", [0x7f, 0x52, 1, 0, 0x00]);

  // The media after all of it.
  images.forEach(function (image, index) {
    trace.push(["image " + index, hex(image.bytes.subarray(0, 64)) + "/" + checksum(image.bytes), 0, 0, []]);
  });
  trace.push(["fdc", hex(ctx.ioData.sioDiskFdcStatus), 0, 0, []]);
  return trace;
}

const trace = JSON.parse(JSON.stringify(runScenario()));

if (process.argv.includes("--update")) {
  fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
  fs.writeFileSync(GOLDEN, JSON.stringify(trace, null, 0) + "\n");
  console.log("sio_disk_device golden written: " + trace.length + " entries");
} else {
  const golden = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
  assert.equal(trace.length, golden.length, "scenario length");
  for (let i = 0; i < golden.length; i++) {
    assert.deepEqual(trace[i], golden[i], "step " + i + " (" + golden[i][0] + ")");
  }
  console.log("sio_disk_device.test.js passed (" + trace.length + " steps)");
}
