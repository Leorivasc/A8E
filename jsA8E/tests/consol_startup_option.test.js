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
  return context.A8EIo.createApi({
    CPU: {},
    CYCLE_NEVER: Number.POSITIVE_INFINITY,
    CYCLES_PER_LINE: 114,
    IO_CONSOL: 0xd01f,
  }).ioAccess;
}

function readConsol(ioAccess, optionOnStart, pc) {
  const ctx = {
    accessAddress: 0xd01f,
    ram: new Uint8Array(0x10000),
    sram: new Uint8Array(0x10000),
    cpu: { pc: pc },
    ioData: { optionOnStart: optionOnStart },
  };
  ctx.ram[0xd01f] = 0x07;
  return {
    value: ioAccess(ctx),
    storedValue: ctx.ram[0xd01f],
  };
}

const ioAccess = loadIoApi();
assert.deepEqual(readConsol(ioAccess, false, 0xc49d), {
  value: 0x07,
  storedValue: 0x07,
});
assert.deepEqual(readConsol(ioAccess, true, 0xc49d), {
  value: 0x03,
  storedValue: 0x07,
});
assert.deepEqual(readConsol(ioAccess, true, 0xc49e), {
  value: 0x07,
  storedValue: 0x07,
});
console.log("consol_startup_option.test.js passed");
