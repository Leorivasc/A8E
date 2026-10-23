/* global __dirname, console, process, require */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function checksum(bytes) {
  let value = 0;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] & 0xff;
    value = (value + (((value + byte) >> 8) & 0xff) + byte) & 0xff;
  }
  return value & 0xff;
}

function loadApi() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "js", "core", "pokey_sio.js"),
    "utf8",
  );
  const context = {
    console: console,
    Uint8Array: Uint8Array,
    Int16Array: Int16Array,
    Number: Number,
    Object: Object,
    Math: Math,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "pokey_sio.js" });
  return context.window.A8EPokeySio.createApi({
    IO_SEROUT_SERIN: 0xd20d,
    SERIAL_OUTPUT_DATA_NEEDED_CYCLES: 1,
    SERIAL_OUTPUT_TRANSMISSION_DONE_CYCLES: 1,
    SERIAL_INPUT_FIRST_DATA_READY_CYCLES: 1,
    SIO_DISK_RESPONSE_TURNAROUND_CYCLES: 37,
    SERIAL_INPUT_DATA_READY_CYCLES: 1,
    IO_IRQEN_IRQST: 0xd20e,
    CYCLE_NEVER: Number.POSITIVE_INFINITY,
    serialOutputClockAvailable: function () { return true; },
    serialOutputClockPeriod: function () { return 1; },
    serialOutputClockNextCycle: function (ctx, now) { return now + 100; },
    cycleTimedEventUpdate: function () {},
  });
}

function makeContext() {
  const disk = new Uint8Array(16 + 4 * 128);
  disk[0] = 0x96;
  disk[1] = 0x02;
  disk[4] = 128;
  return {
    cycleCounter: 0,
    ram: new Uint8Array(0x10000),
    ioData: {
      sioTurbo: true,
      sioBuffer: new Uint8Array(4096),
      sioOutIndex: 0,
      sioOutPhase: 0,
      sioCommandLineControlled: true,
      sioCommandLineAsserted: false,
      sioCommandFrameReady: false,
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
      serialOutputNeedDataCycle: Number.POSITIVE_INFINITY,
      serialOutputTransmissionDoneCycle: Number.POSITIVE_INFINITY,
      serialInputDataReadyCycle: Number.POSITIVE_INFINITY,
      deviceSlots: new Int16Array([0, -1, -1, -1, -1, -1, -1, -1]),
      diskImages: [{ bytes: disk, size: disk.length }],
    },
  };
}

function sendTimedByte(api, ctx, value) {
  api.seroutWrite(ctx, value);
  const need = ctx.ioData.serialOutputNeedDataCycle;
  assert.ok(Number.isFinite(need), "SEROUT did not schedule DATA NEEDED");
  ctx.cycleCounter = need;
  api.serialOutputDataNeeded(ctx);
  // The normal event loop clears this deadline after dispatching the event.
  ctx.ioData.serialOutputNeedDataCycle = Number.POSITIVE_INFINITY;

  const done = ctx.ioData.serialOutputTransmissionDoneCycle;
  assert.ok(Number.isFinite(done), "SEROUT did not schedule XMTDONE");
  ctx.cycleCounter = done;
  const queued = api.serialOutputTransmissionDone(ctx, done);
  if (!queued) ctx.ioData.serialOutputTransmissionDoneCycle = Number.POSITIVE_INFINITY;
}

function readResponseByte(api, ctx) {
  api.serialInputReady(ctx);
  return api.serinRead(ctx);
}

function sendWriteCommand(api, ctx) {
  const command = [0x31, 0x57, 0x01, 0x00];
  command.push(checksum(command));
  api.sioCommandLineChanged(ctx, 0);
  for (const byte of command) sendTimedByte(api, ctx, byte);
  assert.equal(ctx.ioData.sioInSize, 0);
  api.sioCommandLineChanged(ctx, 1);
  // The simplified receive path exposes whole bytes directly, so the first
  // response delay is already the guest-visible SERIN delay.  It must not
  // gain a second byte interval.
  assert.equal(ctx.ioData.serialInputDataReadyCycle, ctx.cycleCounter + 38);
  assert.equal(readResponseByte(api, ctx), "A".charCodeAt(0));
}

function testLateTransmissionKeepsCadence(api) {
  const ctx = makeContext();

  api.seroutWrite(ctx, 0x31);
  const need = ctx.ioData.serialOutputNeedDataCycle;
  ctx.cycleCounter = need;
  api.serialOutputDataNeeded(ctx);
  ctx.ioData.serialOutputNeedDataCycle = Number.POSITIVE_INFINITY;

  const firstDone = ctx.ioData.serialOutputTransmissionDoneCycle;
  ctx.cycleCounter = firstDone - 5;
  api.seroutWrite(ctx, 0x52);

  // Deliver the first frame five cycles late.  The queued second byte must
  // retain the original 20-cycle frame cadence instead of inheriting the
  // late dispatcher time.
  ctx.cycleCounter = firstDone + 5;
  assert.equal(api.serialOutputTransmissionDone(ctx, ctx.cycleCounter), true);
  assert.equal(
    ctx.ioData.serialOutputTransmissionDoneCycle,
    firstDone + 20,
  );
}

function testSeroutUsesFinalBusCycle(api) {
  const ctx = makeContext();
  ctx.cycleCounter = 100;

  // The CPU I/O layer supplies the final cycle of a four-cycle store.  The
  // serial shifter must schedule from that bus write, not from instruction
  // start, otherwise a clock edge can consume the byte too early.
  api.seroutWrite(ctx, 0x31, 103);
  assert.equal(ctx.ioData.serialOutputNeedDataCycle, 203);
}

function main() {
  const api = loadApi();
  testLateTransmissionKeepsCadence(api);
  testSeroutUsesFinalBusCycle(api);
  const ctx = makeContext();
  sendWriteCommand(api, ctx);
  // The first payload byte is accepted only after its POKEY output-clock edge.
  sendTimedByte(api, ctx, 0xa5);

  const delayedWriteCycle = ctx.cycleCounter + 5;
  ctx.cycleCounter = delayedWriteCycle;
  api.seroutWrite(ctx, 0xa5);
  assert.equal(ctx.ioData.serialOutputNeedDataCycle, delayedWriteCycle + 100);

  // Finish the sector through the same timed path.  The burst window is
  // renewed after each payload byte and closes on the checksum byte.
  ctx.cycleCounter = ctx.ioData.serialOutputNeedDataCycle;
  api.serialOutputDataNeeded(ctx);
  ctx.ioData.serialOutputNeedDataCycle = Number.POSITIVE_INFINITY;
  ctx.cycleCounter = ctx.ioData.serialOutputTransmissionDoneCycle;
  api.serialOutputTransmissionDone(ctx, ctx.cycleCounter);
  ctx.ioData.serialOutputTransmissionDoneCycle = Number.POSITIVE_INFINITY;
  for (let i = 2; i < 128; i++) sendTimedByte(api, ctx, 0xa5);
  sendTimedByte(api, ctx, checksum(new Uint8Array(128).fill(0xa5)));

  assert.equal(ctx.ioData.sioCommandLineAsserted, false);
  assert.equal(readResponseByte(api, ctx), "A".charCodeAt(0));
  assert.equal(readResponseByte(api, ctx), "C".charCodeAt(0));
  assert.deepEqual(
    Array.from(ctx.ioData.diskImages[0].bytes.subarray(16, 144)),
    Array.from(new Uint8Array(128).fill(0xa5)),
  );
  console.log("pokey_sio_burst.test.js passed");
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
