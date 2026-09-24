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
    CPU: {
      setRam: function () {},
      setRom: function () {},
    },
    CYCLE_NEVER: Number.POSITIVE_INFINITY,
    CYCLES_PER_LINE: 114,
    IO_PORTB: 0xd301,
    IO_PBCTL: 0xd303,
  }).ioAccess;
}

function makeContext(ioAccess) {
  const mapChanges = [];
  const ctx = {
    accessAddress: 0xd301,
    ram: new Uint8Array(0x10000),
    sram: new Uint8Array(0x10000),
    ioData: {
      valuePortB: 0,
      outputPortB: 0,
      memoryExpansion: null,
      memoryExpansionSync: function (_ctx, oldValue, newValue) {
        mapChanges.push([oldValue, newValue]);
      },
    },
    ioAccess: ioAccess,
    mapChanges: mapChanges,
  };
  ctx.ram[0xd301] = 0xff;
  ctx.sram[0xd301] = 0xff;
  return ctx;
}

function write(ctx, address, value) {
  ctx.accessAddress = address;
  ctx.ioAccess(ctx, value & 0xff);
}

function testDirectionLatchContract() {
  const ioAccess = loadIoApi();
  const ctx = makeContext(ioAccess);

  // DDRB mode with all bits as inputs: XL/XE pull-ups make the effective
  // PORTB value high, regardless of the output latch.
  write(ctx, 0xd303, 0x00);
  write(ctx, 0xd301, 0x00);
  assert.equal(ctx.sram[0xd301], 0xff);

  // Selecting ORB and writing a low latch cannot pull down input bits.
  write(ctx, 0xd303, 0x04);
  write(ctx, 0xd301, 0x00);
  assert.equal(ctx.sram[0xd301], 0xff);

  // Re-select DDRB and make only bits 0-1 outputs. The stored ORB latch is
  // still low, so those two outputs become effective immediately.
  write(ctx, 0xd303, 0x00);
  write(ctx, 0xd301, 0x03);
  assert.equal(ctx.sram[0xd301], 0xfc);

  // Changing ORB while DDRB remains selected must not overwrite DDRB. After
  // returning to ORB mode, the output latch changes only the configured bits.
  write(ctx, 0xd303, 0x04);
  write(ctx, 0xd301, 0xff);
  assert.equal(ctx.sram[0xd301], 0xff);
  assert.equal(ctx.ioData.valuePortB, 0x03);
  assert.equal(ctx.ioData.outputPortB, 0xff);

  // A new low ORB latch followed by a partial direction mask applies
  // immediately to the retained ORB.
  write(ctx, 0xd303, 0x04);
  write(ctx, 0xd301, 0x00);
  write(ctx, 0xd303, 0x00);
  write(ctx, 0xd301, 0xf0);
  assert.equal(ctx.sram[0xd301], 0x0f);
  assert.deepEqual(ctx.mapChanges.at(-1), [0xfc, 0x0f]);
}

testDirectionLatchContract();
console.log("pia_ddrb_orb_contract.test.js passed");
