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

function loadApi(
  serialOutputClockPeriod,
  serialOutputClockAvailable,
  serialOutputClockNextCycle,
  traceSerialEvent,
) {
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
    SERIAL_INPUT_DATA_READY_CYCLES: 1,
    IO_IRQEN_IRQST: 0xd20e,
    CYCLE_NEVER: Number.POSITIVE_INFINITY,
    serialOutputClockAvailable: serialOutputClockAvailable,
    serialOutputClockPeriod: serialOutputClockPeriod,
    serialOutputClockNextCycle: serialOutputClockNextCycle,
    traceSerialEvent: traceSerialEvent,
    cycleTimedEventUpdate: function () {},
  });
}

function makeContext(observer, activityObserver) {
  const bytes = new Uint8Array(16 + 3 * 128 + 128);
  bytes[0] = 0x96;
  bytes[1] = 0x02;
  bytes[4] = 128;
  const ioData = {
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
    sioPendingReadSize: 0,
    sioPendingWriteResult: 0,
    serialOutputNeedDataCycle: 0,
    serialOutputTransmissionDoneCycle: 0,
    serialInputDataReadyCycle: 0,
    deviceSlots: new Int16Array([3, -1, -1, -1, -1, -1, -1, -1]),
    diskImages: [{ bytes: new Uint8Array(1) }, { bytes: new Uint8Array(1) }, { bytes: new Uint8Array(1) }, { bytes: bytes, size: bytes.length }],
    diskMediaChangeObserver: observer,
    diskActivityObserver: activityObserver,
  };
  return {
    cycleCounter: 0,
    ram: new Uint8Array(0x10000),
    ioData: ioData,
  };
}

function main() {
  const observed = [];
  const activities = [];
  const serialTrace = [];
  const api = loadApi(undefined, undefined, undefined, function (ctx, event, fields) {
    serialTrace.push(JSON.parse(JSON.stringify({ event: event, fields: fields })));
  });
  const ctx = makeContext(
    function (imageIndex) { observed.push(imageIndex); },
    function (activity) { activities.push(activity); },
  );
  const command = [0x31, 0x57, 0x01, 0x00];
  command.push(checksum(command));
  command.forEach(function (value) { api.seroutWrite(ctx, value); });

  const payload = new Uint8Array(128);
  payload.fill(0xa5);
  for (let i = 0; i < payload.length; i++) api.seroutWrite(ctx, payload[i]);
  api.seroutWrite(ctx, checksum(payload));

  assert.deepEqual(Array.from(ctx.ioData.diskImages[3].bytes.subarray(16, 144)), Array.from(payload));
  assert.deepEqual(observed, [3]);
  assert.equal(activities.length, 1);
  assert.equal(activities[0].imageIndex, 3);
  assert.equal(activities[0].deviceSlot, 0);
  assert.equal(activities[0].operation, "write");
  assert.equal(ctx.ioData.sioBuffer[0], "A".charCodeAt(0));
  assert.equal(ctx.ioData.sioInSize, 1);
  assert.equal(api.serinRead(ctx), "A".charCodeAt(0));
  assert.equal(ctx.ioData.sioInSize, 1);
  assert.equal(api.serinRead(ctx), "C".charCodeAt(0));

  // PUT has the same data-frame ACK phase but no readback verification.
  const putCommand = [0x31, 0x50, 0x02, 0x00];
  putCommand.push(checksum(putCommand));
  putCommand.forEach(function (value) { api.seroutWrite(ctx, value); });
  payload.fill(0x5a);
  for (let i = 0; i < payload.length; i++) api.seroutWrite(ctx, payload[i]);
  api.seroutWrite(ctx, checksum(payload));
  assert.equal(ctx.ioData.sioInSize, 1);
  assert.equal(api.serinRead(ctx), "A".charCodeAt(0));
  assert.equal(ctx.ioData.sioInSize, 1);
  assert.equal(api.serinRead(ctx), "C".charCodeAt(0));

  // VERIFY also separates the data-frame ACK from its completion result.
  const verifyCommand = [0x31, 0x56, 0x02, 0x00];
  verifyCommand.push(checksum(verifyCommand));
  verifyCommand.forEach(function (value) { api.seroutWrite(ctx, value); });
  for (let i = 0; i < payload.length; i++) api.seroutWrite(ctx, payload[i]);
  api.seroutWrite(ctx, checksum(payload));
  assert.equal(ctx.ioData.sioInSize, 1);
  assert.equal(api.serinRead(ctx), "A".charCodeAt(0));
  assert.equal(ctx.ioData.sioInSize, 1);
  assert.equal(api.serinRead(ctx), "C".charCodeAt(0));

  // AHRM 9.1: a bad command checksum is ignored, not NAKed.
  const invalidCommand = [0x31, 0x53, 0x00, 0x00, 0x00];
  invalidCommand.forEach(function (value) { api.seroutWrite(ctx, value); });
  assert.equal(ctx.ioData.sioInSize, 0);
  assert.deepEqual(serialTrace.pop(), {
    event: "SIO_COMMAND_DROPPED",
    fields: {
      device: 0x31,
      command: 0x53,
      aux1: 0x00,
      aux2: 0x00,
      calculatedChecksum: checksum(invalidCommand.slice(0, 4)),
      providedChecksum: 0x00,
      reason: "invalid-command-checksum",
    },
  });

  // AHRM 10.2: STATUS byte +2 is the format timeout. It must not be the
  // short normal-command timeout because DOS may reuse it for another drive.
  const statusCommand = [0x31, 0x53, 0x00, 0x00];
  statusCommand.push(checksum(statusCommand));
  statusCommand.forEach(function (value) { api.seroutWrite(ctx, value); });
  // AHRM 10.2: STATUS byte +1 is inverted FDC status. A ready writable
  // disk must not advertise not-ready, write-protect, or command errors.
  assert.equal(ctx.ioData.sioBuffer[3], 0xff);
  assert.equal(ctx.ioData.sioBuffer[4], 0xe0);
  assert.equal(ctx.ioData.sioBuffer[6], 0xf0);

  // FORMAT must return the command ACK followed by the sector-sized empty
  // bad-sector list. Returning only ACK/Complete makes DOS report timeout
  // 138 after it waits for the format result.
  const formatCommand = [0x31, 0x21, 0x00, 0x00];
  formatCommand.push(checksum(formatCommand));
  ctx.ioData.diskImages[3].bytes.fill(0xa5, 16);
  formatCommand.forEach(function (value) { api.seroutWrite(ctx, value); });
  assert.equal(ctx.ioData.sioInSize, 1);
  assert.equal(api.serinRead(ctx), "A".charCodeAt(0));
  assert.equal(ctx.ioData.sioInSize, 130);
  assert.equal(api.serinRead(ctx), "C".charCodeAt(0));
  assert.equal(ctx.ioData.sioBuffer[1], 0xff);
  assert.equal(ctx.ioData.sioBuffer[2], 0xff);
  assert.equal(ctx.ioData.diskImages[3].bytes[16], 0);
  assert.equal(
    ctx.ioData.diskImages[3].bytes[ctx.ioData.diskImages[3].bytes.length - 1],
    0,
  );

  // AHRM 5.6: reading SERIN returns the byte but does not acknowledge the
  // active-low serial input IRQ status bit.
  ctx.ioData.sioBuffer[0] = 0x43;
  ctx.ioData.sioInIndex = 0;
  ctx.ioData.sioInSize = 1;
  ctx.ram[0xd20e] = 0xdf;
  assert.equal(api.serinRead(ctx), 0x43);
  assert.equal(ctx.ram[0xd20e] & 0x20, 0x00);

  // AHRM 5.6: standard SIO output deadlines follow the configured timer-4
  // period. The multiplier covers the ten-bit serial frame at two timer
  // phases per bit; an external-clock setup uses the legacy fallback.
  const clockedApi = loadApi(function () { return 47; });
  const clockedCtx = makeContext(function () {}, function () {});
  clockedCtx.cycleCounter = 100;
  clockedApi.seroutWrite(clockedCtx, 0x55);
  assert.equal(clockedCtx.ioData.serialOutputNeedDataCycle, 147);
  assert.equal(clockedCtx.ioData.serialOutputTransmissionDoneCycle, 1087);

  // AHRM 5.6: DATA NEEDED follows the next rising serial-clock edge, not a
  // fixed period measured from SEROUT. The high phase skips the next timer
  // expiry because that expiry is the falling edge.
  const phaseApi = loadApi(
    function () { return 56; },
    function () { return true; },
    function (ctx) {
      return ctx.ioData.timer4Cycle + (ctx.ioData.serialOutputClockHigh ? 56 : 0);
    },
  );
  const phaseCtx = makeContext(function () {}, function () {});
  phaseCtx.cycleCounter = 100;
  phaseCtx.ioData.timer4Cycle = 140;
  phaseApi.seroutWrite(phaseCtx, 0x55);
  assert.equal(phaseCtx.ioData.serialOutputNeedDataCycle, 140);
  assert.equal(phaseCtx.ioData.serialOutputTransmissionDoneCycle, 1260);

  phaseCtx.ioData.serialOutputNeedDataCycle = 0;
  phaseCtx.ioData.serialOutputTransmissionDoneCycle = 0;
  phaseCtx.ioData.serialOutputClockHigh = true;
  phaseApi.seroutWrite(phaseCtx, 0x55);
  assert.equal(phaseCtx.ioData.serialOutputNeedDataCycle, 196);
  assert.equal(phaseCtx.ioData.serialOutputTransmissionDoneCycle, 1316);

  // AHRM 5.6: no synthetic output deadlines are created when the selected
  // serial mode has no internal output clock. XMTDONE remains inactive while
  // the output shift register has no clock source.
  const unclockedApi = loadApi(function () { return 47; }, function () { return false; });
  const unclockedCtx = makeContext(function () {}, function () {});
  unclockedCtx.cycleCounter = 100;
  unclockedApi.seroutWrite(unclockedCtx, 0x55);
  assert.equal(unclockedCtx.ioData.serialOutputNeedDataCycle, Number.POSITIVE_INFINITY);
  assert.equal(unclockedCtx.ioData.serialOutputTransmissionDoneCycle, Number.POSITIVE_INFINITY);
  assert.equal(unclockedCtx.ram[0xd20e] & 0x08, 0);
  console.log("pokey_sio_disk_observer.test.js passed");
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
