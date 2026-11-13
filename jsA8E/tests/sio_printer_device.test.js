/* global __dirname, console, require */

// The generic SIO device contract with the 820 printer on it: command and data
// frames driven through the real pokey_sio.js, checked at the SERIN level.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ACK = 0x41;
const NAK = 0x4e;
const COMPLETE = 0x43;

function checksum(bytes) {
  let value = 0;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] & 0xff;
    value = (value + (((value + byte) >> 8) & 0xff) + byte) & 0xff;
  }
  return value & 0xff;
}

function loadCore() {
  const context = { console: console, Uint8Array: Uint8Array, Number: Number, Object: Object, Math: Math, String: String, Array: Array };
  context.window = context;
  vm.createContext(context);
  ["sio_printer.js", "pokey_sio.js"].forEach(function (name) {
    const source = fs.readFileSync(path.join(__dirname, "..", "js", "core", name), "utf8");
    vm.runInContext(source, context, { filename: name });
  });
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

function makeContext(events) {
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
      serialOutputNeedDataCycle: Number.POSITIVE_INFINITY,
      serialOutputTransmissionDoneCycle: Number.POSITIVE_INFINITY,
      serialInputDataReadyCycle: 0,
      deviceSlots: new Int16Array(8).fill(-1),
      diskImages: [],
      sioDeviceEventObserver: function (message) { events.push(message); },
    },
  };
}

function readSerin(api, ctx) {
  api.serialInputReady(ctx);
  return api.serinRead(ctx);
}

function send(api, ctx, bytes) {
  bytes.forEach(function (value) { api.seroutWrite(ctx, value); });
}

function command(api, ctx, device, cmd, aux1, aux2) {
  const frame = [device, cmd, aux1, aux2];
  frame.push(checksum(frame));
  send(api, ctx, frame);
}

function dataFrame(text, width, goodChecksum) {
  const data = new Uint8Array(width).fill(0x9b);
  for (let i = 0; i < text.length; i++) data[i] = text.charCodeAt(i);
  return Array.from(data).concat([goodChecksum === false ? checksum(data) ^ 0xff : checksum(data)]);
}

function status(api, ctx) {
  command(api, ctx, 0x40, 0x53, 0, 0);
  assert.equal(readSerin(api, ctx), ACK);
  assert.equal(readSerin(api, ctx), COMPLETE);
  const bytes = [readSerin(api, ctx), readSerin(api, ctx), readSerin(api, ctx), readSerin(api, ctx)];
  assert.equal(readSerin(api, ctx), checksum(bytes), "status checksum");
  return bytes;
}

function main() {
  const api = loadCore();
  const events = [];
  const ctx = makeContext(events);

  // Status before any Write: no errors, no orientation, timeout $06.
  assert.deepEqual(status(api, ctx), [0, 0, 0x06, 0]);

  // Normal write: ACK, data frame, ACK, Complete; one line on the paper.
  command(api, ctx, 0x40, 0x57, 0x4e, 0);
  assert.equal(readSerin(api, ctx), ACK);
  send(api, ctx, dataFrame("Hello, \u007f printer", 40));
  assert.equal(readSerin(api, ctx), ACK);
  assert.equal(readSerin(api, ctx), COMPLETE);
  assert.equal(events.length, 1);
  assert.equal(events[0].device, 0x40);
  assert.deepEqual(JSON.parse(JSON.stringify(events[0].event)), { type: "line", text: "Hello,   printer", sideways: false, columns: 40 });
  assert.deepEqual(status(api, ctx), [0, 0x4e, 0x06, 0]);

  // Sideways: 29 bytes, lowercase maps to uppercase, printed right to left.
  command(api, ctx, 0x40, 0x57, 0x53, 0);
  assert.equal(readSerin(api, ctx), ACK);
  send(api, ctx, dataFrame("abc 12", 29));
  assert.equal(readSerin(api, ctx), ACK);
  assert.equal(readSerin(api, ctx), COMPLETE);
  assert.deepEqual(JSON.parse(JSON.stringify(events[1].event)), { type: "line", text: " ".repeat(23) + "21 CBA", sideways: true, columns: 29 });

  // Unsupported orientation: NAK, command-error flag, nothing printed.
  command(api, ctx, 0x40, 0x57, 0x41, 0);
  assert.equal(readSerin(api, ctx), NAK);
  assert.deepEqual(status(api, ctx), [0x01, 0x41, 0x06, 0]);
  assert.equal(events.length, 2);

  // Bad data checksum: NAK, data-error flag, nothing printed.
  command(api, ctx, 0x40, 0x57, 0x4e, 0);
  assert.equal(readSerin(api, ctx), ACK);
  send(api, ctx, dataFrame("lost", 40, false));
  assert.equal(readSerin(api, ctx), NAK);
  assert.deepEqual(status(api, ctx), [0x02, 0x4e, 0x06, 0]);
  assert.equal(events.length, 2);

  // Unknown command: NAK. Command frame with a bad checksum: silence.
  command(api, ctx, 0x40, 0x21, 0, 0);
  assert.equal(readSerin(api, ctx), NAK);
  send(api, ctx, [0x40, 0x53, 0, 0, 0x00]);
  assert.equal(ctx.ioData.sioInSize | 0, 0, "no response to a corrupt command frame");

  // Other printer unit IDs are absent from the bus: they get no answer here.
  command(api, ctx, 0x42, 0x53, 0, 0);
  assert.notEqual(ctx.ioData.sioBuffer[0], ACK);

  console.log("sio_printer_device.test.js passed");
}

main();
