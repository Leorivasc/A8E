"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const context = { Uint8Array: Uint8Array };
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "core", "gtia.js"), "utf8"),
  context, { filename: "gtia.js" });

const io = { clock: 20, displayListFetchCycle: 0, drawLine: {
  gtiaEventCount: 0, gtiaEventOverflow: false,
  gtiaEventRegisters: new Uint8Array(64), gtiaEventValues: new Uint8Array(64),
  gtiaEventCycles: new Uint8Array(64),
} };
const gtia = context.A8EGtia.createApi({
  CYCLES_PER_LINE: 114,
  IO_COLPM0_TRIG2: 0xd012, IO_COLPM1_TRIG3: 0xd013,
  IO_COLPM2_PAL: 0xd014, IO_COLPM3: 0xd015,
  IO_COLPF0: 0xd016, IO_COLPF1: 0xd017, IO_COLPF2: 0xd018,
  IO_COLPF3: 0xd019, IO_COLBK: 0xd01a, IO_PRIOR: 0xd01b,
});
const ctx = { ioData: io, currentInstructionCycles: 3 };
gtia.recordGtiaRegisterWrite(ctx, 0xd016, 0x7f);
gtia.recordGtiaRegisterWrite(ctx, 0xd01b, 0xc0);
assert.equal(io.drawLine.gtiaEventCount, 2);
assert.deepEqual(Array.from(io.drawLine.gtiaEventRegisters.slice(0, 2)), [4, 9]);
assert.deepEqual(Array.from(io.drawLine.gtiaEventValues.slice(0, 2)), [0x7f, 0xc0]);
assert.deepEqual(Array.from(io.drawLine.gtiaEventCycles.slice(0, 2)), [22, 22]);
io.clock = 114;
gtia.recordGtiaRegisterWrite(ctx, 0xd016, 0x00);
assert.equal(io.drawLine.gtiaEventCount, 2, "writes outside the line belong to the next queue");
console.log("gtia_register_span_queue: GTIA colour/PRIOR writes timestamped.");
