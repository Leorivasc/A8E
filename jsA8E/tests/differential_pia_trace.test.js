/* global console, Uint8Array, Uint16Array, Uint32Array, Int16Array, Number, Math, Object */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadIoApi() {
  const filename = path.join(__dirname, "..", "js", "core", "io.js");
  const context = {
    console: console,
    Uint8Array: Uint8Array,
    Uint16Array: Uint16Array,
    Uint32Array: Uint32Array,
    Int16Array: Int16Array,
    Number: Number,
    Math: Math,
    Object: Object,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename: filename });
  const api = context.A8EIo.createApi({
    CPU: {
      setRam: function () {},
      setRom: function () {},
      reconcileIrq: function () {},
      irq: function () {},
    },
    CYCLE_NEVER: Number.POSITIVE_INFINITY,
    CYCLES_PER_LINE: 114,
    IO_PORTB: 0xd301,
    IO_PBCTL: 0xd303,
    IO_PACTL: 0xd302,
  });
  return {
    ioAccess: api.ioAccess,
    piaIrqAsserted: api.piaIrqAsserted,
  };
}

function makeContext(ioApi) {
  const ctx = {
    accessAddress: 0xd301,
    cycleCounter: 0,
    clock: 0,
    currentInstructionCycles: 0,
    ram: new Uint8Array(0x10000),
    sram: new Uint8Array(0x10000),
    ioData: {
      valuePortA: 0,
      valuePortB: 0,
      outputPortB: 0,
      piaStatusA: 0,
      piaStatusB: 0,
      piaCa2Level: 1,
      piaCb2Level: 1,
      piaCb2WasRaisedOutput: false,
      memoryExpansion: null,
      memoryExpansionSync: function () {},
    },
    ioAccess: ioApi.ioAccess,
    piaIrqAsserted: ioApi.piaIrqAsserted,
  };
  ctx.ram[0xd301] = 0xff;
  ctx.sram[0xd301] = 0xff;
  ctx.ram[0xd302] = 0x3c;
  ctx.sram[0xd302] = 0x00;
  ctx.ram[0xd303] = 0x3c;
  ctx.sram[0xd303] = 0x00;
  return ctx;
}

function write(ctx, address, value) {
  ctx.accessAddress = address;
  ctx.ioAccess(ctx, value & 0xff);
}

function traceLine(ctx, step, event) {
  return JSON.stringify({
    step: step,
    event: event,
    cycle: ctx.cycleCounter,
    pactl: ctx.ram[0xd302] & 0xff,
    pbctl: ctx.ram[0xd303] & 0xff,
    portb: ctx.sram[0xd301] & 0xff,
    ddrb: ctx.ioData.valuePortB & 0xff,
    orb: ctx.ioData.outputPortB & 0xff,
    irq: ctx.piaIrqAsserted(ctx) ? 1 : 0,
  });
}

const expected = fs
  .readFileSync(path.join(__dirname, "..", "..", "implementation", "traces", "pia_portb_contract.jsonl"), "utf8")
  .trim()
  .split(/\r?\n/);
const ioAccess = loadIoApi();
const ctx = makeContext(ioAccess);
const actual = [traceLine(ctx, "reset", 0)];
const operations = [
  ["select-ddrb", 0xd303, 0x00],
  ["write-ddrb-zero", 0xd301, 0x00],
  ["select-orb", 0xd303, 0x04],
  ["write-orb-zero", 0xd301, 0x00],
  ["select-ddrb-again", 0xd303, 0x00],
  ["write-ddrb-03", 0xd301, 0x03],
  ["select-orb-again", 0xd303, 0x04],
  ["write-orb-ff", 0xd301, 0xff],
  ["write-orb-final-zero", 0xd301, 0x00],
  ["select-ddrb-final", 0xd303, 0x00],
  ["write-ddrb-f0", 0xd301, 0xf0],
];
for (let i = 0; i < operations.length; i++) {
  ctx.cycleCounter = i + 1;
  write(ctx, operations[i][1], operations[i][2]);
  actual.push(traceLine(ctx, operations[i][0], i + 1));
}

assert.deepEqual(actual, expected);
console.log("differential_pia_trace.test.js passed");
