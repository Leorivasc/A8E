/* global console, Uint8Array, Number, Object */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = {
  console: console,
  Uint8Array: Uint8Array,
  Number: Number,
  Object: Object,
};
context.window = context;
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "..", "js", "core", "io.js"), "utf8"),
  context,
);

let irqRequests = 0;
const CPU = {
  irq: function (ctx) {
    irqRequests++;
    ctx.irqPending = 1;
  },
  reconcileIrq: function (ctx) {
    ctx.irqPending = 0;
    const io = ctx.ioData;
    const pa = ctx.sram[0xd302] & 0xff;
    const pb = ctx.sram[0xd303] & 0xff;
    const ma = (pa >>> 3) & 7;
    const mb = (pb >>> 3) & 7;
    if (((io.piaStatusA & 0x80) && (pa & 1)) ||
        ((io.piaStatusA & 0x40) && ma < 4 && (ma & 1)) ||
        ((io.piaStatusB & 0x80) && (pb & 1)) ||
        ((io.piaStatusB & 0x40) && mb < 4 && (mb & 1))) {
      ctx.irqPending = 1;
    }
  },
};

const api = context.A8EIo.createApi({
  CPU: CPU,
  CYCLE_NEVER: Number.POSITIVE_INFINITY,
  CYCLES_PER_LINE: 114,
  IO_PORTA: 0xd300,
  IO_PORTB: 0xd301,
  IO_PACTL: 0xd302,
  IO_PBCTL: 0xd303,
});
const ctx = {
  accessAddress: 0,
  cycleCounter: 0,
  irqPending: 0,
  ram: new Uint8Array(0x10000),
  sram: new Uint8Array(0x10000),
  ioData: {
    valuePortA: 0,
    valuePortB: 0,
    outputPortB: 0,
    piaCa1Level: 1,
    piaCa2Level: 1,
    piaCb1Level: 1,
    piaCb2Level: 1,
    piaStatusA: 0,
    piaStatusB: 0,
    piaCb2WasRaisedOutput: false,
    piaCa2PulseUntilCycle: -1,
    piaCb2PulseUntilCycle: -1,
  },
};

function write(address, value) {
  ctx.accessAddress = address;
  api.ioAccess(ctx, value);
}

function read(address) {
  ctx.accessAddress = address;
  return api.ioAccess(ctx);
}

write(0xd302, 0x03);
api.piaSetControlLine(ctx, "ca1", 0);
api.piaSetControlLine(ctx, "ca1", 1);
assert.equal(read(0xd302) & 0xc0, 0x80);
assert.equal(ctx.irqPending, 1);
assert.ok(irqRequests > 0);

write(0xd302, 0x02);
assert.equal(read(0xd302) & 0xc0, 0x80);
assert.equal(ctx.irqPending, 0);
write(0xd302, 0x06);
assert.equal(read(0xd302) & 0xc0, 0x80);
read(0xd300);
assert.equal(read(0xd302) & 0xc0, 0);

write(0xd303, 0x0d);
api.piaSetControlLine(ctx, "cb2", 0);
assert.equal(read(0xd303) & 0xc0, 0x40);
read(0xd301);
assert.equal(read(0xd303) & 0xc0, 0);

write(0xd303, 0x34);
write(0xd303, 0x3c);
write(0xd303, 0x04);
assert.equal(read(0xd303) & 0xc0, 0x40);
write(0xd303, 0x34);
assert.equal(read(0xd303) & 0x40, 0);

console.log("pia_control_lines.test.js passed");
