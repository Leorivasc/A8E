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

function makeContext(events, model) {
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
      sioDeviceSettings: { printerModel: model },
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

function status(api, ctx, device) {
  command(api, ctx, device || 0x40, 0x53, 0, 0);
  assert.equal(readSerin(api, ctx), ACK);
  assert.equal(readSerin(api, ctx), COMPLETE);
  const bytes = [readSerin(api, ctx), readSerin(api, ctx), readSerin(api, ctx), readSerin(api, ctx)];
  assert.equal(readSerin(api, ctx), checksum(bytes), "status checksum");
  return bytes;
}

function plain(event) {
  return JSON.parse(JSON.stringify(event));
}

function lines(events) {
  return events.filter(function (m) { return m.event.type === "line"; }).map(function (m) { return plain(m.event); });
}

function test820() {
  const api = loadCore();
  const events = [];
  const ctx = makeContext(events, "820");

  // Status before any Write: no errors, no orientation, timeout $06.
  assert.deepEqual(status(api, ctx), [0, 0, 0x06, 0]);

  // Normal write: ACK, data frame, ACK, Complete; one line on the paper.
  command(api, ctx, 0x40, 0x57, 0x4e, 0);
  assert.equal(readSerin(api, ctx), ACK);
  send(api, ctx, dataFrame("Hello, \u007f printer", 40));
  assert.equal(readSerin(api, ctx), ACK);
  assert.equal(readSerin(api, ctx), COMPLETE);
  assert.equal(lines(events).length, 1);
  assert.equal(events[0].device, 0x40);
  assert.deepEqual(lines(events)[0], { type: "line", text: "Hello,   printer", sideways: false, columns: 40 });
  assert.deepEqual(status(api, ctx), [0, 0x4e, 0x06, 0]);

  // Sideways: 29 bytes, lowercase maps to uppercase, printed right to left.
  command(api, ctx, 0x40, 0x57, 0x53, 0);
  assert.equal(readSerin(api, ctx), ACK);
  send(api, ctx, dataFrame("abc 12", 29));
  assert.equal(readSerin(api, ctx), ACK);
  assert.equal(readSerin(api, ctx), COMPLETE);
  assert.deepEqual(lines(events)[1], { type: "line", text: " ".repeat(23) + "21 CBA", sideways: true, columns: 29 });

  // Unsupported orientation: NAK, command-error flag, nothing printed.
  command(api, ctx, 0x40, 0x57, 0x41, 0);
  assert.equal(readSerin(api, ctx), NAK);
  assert.deepEqual(status(api, ctx), [0x01, 0x41, 0x06, 0]);
  assert.equal(lines(events).length, 2);

  // Bad data checksum: NAK, data-error flag, nothing printed.
  command(api, ctx, 0x40, 0x57, 0x4e, 0);
  assert.equal(readSerin(api, ctx), ACK);
  send(api, ctx, dataFrame("lost", 40, false));
  assert.equal(readSerin(api, ctx), NAK);
  assert.deepEqual(status(api, ctx), [0x02, 0x4e, 0x06, 0]);
  assert.equal(lines(events).length, 2);

  // Unknown command: NAK. Command frame with a bad checksum: silence.
  command(api, ctx, 0x40, 0x21, 0, 0);
  assert.equal(readSerin(api, ctx), NAK);
  send(api, ctx, [0x40, 0x53, 0, 0, 0x00]);
  assert.equal(ctx.ioData.sioInSize | 0, 0, "no response to a corrupt command frame");

  // The 820 only answers on $40: $42 is treated like an absent device.
  command(api, ctx, 0x42, 0x53, 0, 0);
  assert.notEqual(ctx.ioData.sioBuffer[0], ACK);
}

function write1025(api, ctx, bytes, device) {
  command(api, ctx, device || 0x40, 0x57, 0x4e, 0);
  assert.equal(readSerin(api, ctx), ACK);
  const data = new Uint8Array(40).fill(0x9b);
  data.set(bytes);
  send(api, ctx, Array.from(data).concat([checksum(data)]));
  assert.equal(readSerin(api, ctx), ACK);
  assert.equal(readSerin(api, ctx), COMPLETE);
}

function ascii(text) {
  return Array.from(text, function (c) { return c.charCodeAt(0); });
}

function padded(bytes) {
  // What the OS P: handler sends after an EOL: the rest of the buffer in spaces.
  const out = bytes.slice();
  while (out.length < 40) out.push(0x20);
  return out;
}

function text1025(events) {
  return lines(events).map(function (l) { return l.text; });
}

function test1025() {
  const api = loadCore();
  const events = [];
  const ctx = makeContext(events, "1025");

  // Status: flags, $00, timeout $0F, unused $30.
  assert.deepEqual(status(api, ctx), [0, 0, 0x0f, 0x30]);
  // Also answers on $42 (P3:), not on $43.
  assert.deepEqual(status(api, ctx, 0x42), [0, 0, 0x0f, 0x30]);
  command(api, ctx, 0x43, 0x53, 0, 0);
  assert.notEqual(ctx.ioData.sioBuffer[0], ACK);

  // The Atari Writer case: a 67 byte line (10 space margin) split by the OS
  // into two 40 byte frames. The 1025 joins them; the padding after the EOL
  // is ignored.
  const margin = " ".repeat(10);
  const body = margin + "Este texto empieza justo en la primera linea sin espacios";
  write1025(api, ctx, ascii(body.slice(0, 40)));
  assert.deepEqual(text1025(events), [], "a partial line is not printed yet");
  write1025(api, ctx, padded(ascii(body.slice(40)).concat([0x9b])));
  assert.deepEqual(text1025(events), [body]);
  assert.deepEqual(lines(events)[0].columns, 80);

  // Blank line: EOL in the first column.
  write1025(api, ctx, padded([0x9b]));
  assert.deepEqual(text1025(events).slice(1), [""]);

  // A line of exactly 80 characters prints at once, and the EOL that follows
  // does not add a blank line (AHRM 9.6).
  const full = "x".repeat(80);
  write1025(api, ctx, ascii(full.slice(0, 40)));
  write1025(api, ctx, ascii(full.slice(40)));
  assert.equal(text1025(events).length, 3);
  assert.equal(text1025(events)[2], full);
  write1025(api, ctx, padded([0x9b]));
  assert.equal(text1025(events).length, 3, "no extra blank line after a full line");
  write1025(api, ctx, padded([0x9b]));
  assert.equal(text1025(events).length, 4, "a second EOL is a real blank line");

  // Escape commands: ESC CTRL+N = 5 cpi (40 columns); the line breaks at 40.
  write1025(api, ctx, [0x1b, 0x0e].concat(ascii("y".repeat(38))));
  assert.equal(text1025(events).length, 4);
  write1025(api, ctx, ascii("zz"));
  const wide = lines(events)[4];
  assert.equal(wide.text, "y".repeat(38) + "zz");
  assert.equal(wide.cpi, 5);
  assert.equal(wide.columns, 40);

  // ESC S = short line (32 columns at 5 cpi); ESC 8 = 8 lpi; the settings
  // stay until changed. ESC in the middle of a line only acts for CTRL+W/X.
  write1025(api, ctx, [0x1b, 0x53, 0x1b, 0x38].concat(ascii("a".repeat(32))));
  const shortLine = lines(events)[5];
  assert.equal(shortLine.text, "a".repeat(32));
  assert.deepEqual([shortLine.shortLine, shortLine.lpi, shortLine.columns], [true, 8, 32]);

  // European characters: off blanks $7B and ignores $01; ESC CTRL+W turns them on.
  write1025(api, ctx, [0x1b, 0x0f, 0x1b, 0x4c].concat(ascii("a"), [0x7b, 0x01], ascii("b"), [0x9b]));
  assert.equal(lines(events)[6].text, "a b");
  write1025(api, ctx, [0x1b, 0x17].concat(ascii("a"), [0x7b, 0x01], ascii("b"), [0x9b]));
  assert.equal(lines(events)[7].text, "a\u00c4\u00f9b");

  // Sideways is not supported: NAK and the command-error flag.
  command(api, ctx, 0x40, 0x57, 0x53, 0);
  assert.equal(readSerin(api, ctx), NAK);
  assert.deepEqual(status(api, ctx), [0x01, 0, 0x0f, 0x30]);

  // STATUS resets the settings and drops a partial line (the OS issues it on
  // OPEN), so LPRINT starts every line from the power-on state.
  write1025(api, ctx, padded([0x1b, 0x0e].concat(ascii("partial"))));
  status(api, ctx);
  write1025(api, ctx, ascii("fresh").concat([0x9b]));
  const fresh = lines(events)[8];
  assert.deepEqual([fresh.text, fresh.cpi, fresh.lpi, fresh.shortLine, fresh.columns], ["fresh", 10, 6, false, 80]);

  // The model can be switched at run time through the shared settings.
  ctx.ioData.sioDeviceSettings.printerModel = "820";
  command(api, ctx, 0x42, 0x53, 0, 0);
  assert.notEqual(ctx.ioData.sioBuffer[0], ACK, "$42 is absent again under the 820");
}

test820();
test1025();
console.log("sio_printer_device.test.js passed");
