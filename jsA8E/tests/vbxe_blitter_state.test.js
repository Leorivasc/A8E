"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const context = { Uint8Array: Uint8Array };
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "core", "vbxe.js"), "utf8"),
  context, { filename: "vbxe.js" });

const vbxe = context.A8EVbxe;
const state = vbxe.createState("fx1.26");

function block(values) {
  const data = new Uint8Array(21);
  data.set(values);
  data[15] = values[15] === undefined ? 0xff : values[15];
  return data;
}

function writeBlock(address, values) {
  state.vram.set(block(values), address);
}

function start(address, irqEnabled) {
  vbxe.access(state, 0xd650, address & 0xff);
  vbxe.access(state, 0xd651, (address >>> 8) & 0xff);
  vbxe.access(state, 0xd652, (address >>> 16) & 0x07);
  vbxe.access(state, 0xd654, irqEnabled ? 1 : 0);
  vbxe.access(state, 0xd653, 1);
}

function finish() {
  vbxe.advanceBlitter(state, 4096);
  assert.equal(vbxe.access(state, 0xd653), 0, "blitter should become idle");
}

// Copy a 2x2 rectangle with independent source and destination row strides.
state.vram.set([1, 2], 0x100);
state.vram.set([3, 4], 0x104);
writeBlock(0x300, [
  0x00, 0x01, 0x00, 0x04, 0x00, 0x01,
  0x00, 0x02, 0x00, 0x04, 0x00, 0x01,
  0x01, 0x00, 0x01, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
start(0x300, false);
assert.equal(vbxe.access(state, 0xd653), 1, "start enters control-block load state");
vbxe.advanceBlitter(state, 20);
assert.equal(vbxe.access(state, 0xd653), 1, "a block remains loading for all 21 VRAM cycles");
vbxe.advanceBlitter(state, 1);
assert.equal(vbxe.access(state, 0xd653), 2, "loaded blitter reports active state");
const resumed = vbxe.restoreState(vbxe.cloneState(state));
vbxe.advanceBlitter(resumed, 4096);
assert.deepEqual(Array.from(resumed.vram.slice(0x200, 0x202)), [1, 2]);
assert.deepEqual(Array.from(resumed.vram.slice(0x204, 0x206)), [3, 4]);
vbxe.access(state, 0xd653, 0);

// All byte operations and nibble stencil follow the AHRM mode table.
for (const [mode, source, destination, expected] of [
  [0, 0x0f, 0xf3, 0x0f], [1, 0x00, 0xf3, 0xf3], [2, 0x02, 0xff, 0x01],
  [3, 0x0f, 0xf0, 0xff], [4, 0x0f, 0xf3, 0x03], [5, 0x0f, 0xf3, 0xfc],
  [6, 0x0b, 0xa0, 0xab],
]) {
  state.vram[0x120] = source;
  state.vram[0x220] = destination;
  writeBlock(0x320, [
    0x20, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x20, 0x02, 0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00, 0x00, mode,
  ]);
  start(0x320, false);
  finish();
  assert.equal(state.vram[0x220], expected, "blit mode " + mode);
}

// Pattern fetch and X zoom replicate source bytes before the destination step.
state.vram.set([0x2a, 0x4b], 0x140);
writeBlock(0x340, [
  0x40, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x40, 0x02, 0x00, 0x00, 0x00, 0x01,
  0x02, 0x00, 0x00, 0xff, 0x00, 0x00, 0x01, 0x81, 0x00,
]);
start(0x340, false);
finish();
assert.deepEqual(Array.from(state.vram.slice(0x240, 0x246)), [0x2a, 0x2a, 0x4b, 0x4b, 0x2a, 0x2a]);

// Linked lists, stencil collision reporting, and completion IRQ status.
state.vram[0x160] = 0x11;
state.vram[0x260] = 0x22;
writeBlock(0x380, [
  0x60, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x60, 0x02, 0x00, 0x00, 0x00, 0x01,
  0x00, 0x00, 0x00, 0xff, 0x00, 0x02, 0x00, 0x00, 0x09,
]);
state.vram[0x161] = 0x00;
state.vram[0x261] = 0x7e;
writeBlock(0x395, [
  0x61, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x61, 0x02, 0x00, 0x00, 0x00, 0x01,
  0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00, 0x00, 0x01,
]);
start(0x380, true);
finish();
assert.equal(state.vram[0x260], 0x11);
assert.equal(state.vram[0x261], 0x7e, "stencil preserves a zero source byte");
assert.equal(vbxe.access(state, 0xd650), 0,
  "loading the linked block starts a new blit and clears its predecessor's collision code");
assert.equal(vbxe.access(state, 0xd654), 1, "completion asserts IRQ status when enabled");
vbxe.access(state, 0xd654, 0);
assert.equal(vbxe.access(state, 0xd654), 0, "IRQ control write clears completion status");

// Machine-driven blits defer the completion line until the remaining local
// slots have elapsed. The device helper exposes that handoff without changing
// the immediate behavior used by standalone register tests.
writeBlock(0x3a0, [
  0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
  0x80, 0x02, 0x00, 0x00, 0x00, 0x01,
  0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
start(0x3a0, true);
vbxe.advanceBlitter(state, 23, true);
assert.equal(vbxe.access(state, 0xd654), 0,
  "scheduled completion must not assert before its scanline phase");
assert.equal(vbxe.scheduleBlitterIrq(state), 0,
  "a completed constant fill leaves no local slots after a 23-cycle budget");
assert.equal(vbxe.raiseScheduledBlitterIrq(state), true,
  "scheduled completion must raise exactly once");
assert.equal(vbxe.access(state, 0xd654), 1,
  "scheduled completion must assert IRQ status at its due phase");
vbxe.access(state, 0xd654, 0);

// BLITTER_START=0 must also cancel a completion already queued for its
// in-line IRQ phase. Altirra unsets that scheduler event on STOP.
start(0x3a0, true);
vbxe.advanceBlitter(state, 23, true);
assert.equal(vbxe.scheduleBlitterIrq(state), 0);
vbxe.access(state, 0xd653, 0);
assert.equal(vbxe.raiseScheduledBlitterIrq(state), false,
  "stopping before the scheduled phase cancels the completion IRQ");
assert.equal(vbxe.access(state, 0xd654), 0);

// The AHRM local-cycle table gates progress: a normal copy needs two cycles,
// while a constant mode-0 fill elides its source fetch and takes one.
state.vram[0x180] = 0x7f;
writeBlock(0x3c0, [
  0x80, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x80, 0x02, 0x00, 0x00, 0x00, 0x01,
  0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
start(0x3c0, false);
vbxe.advanceBlitter(state, 21);
assert.equal(vbxe.access(state, 0xd653), 2, "one full block load consumes 21 cycles");
vbxe.advanceBlitter(state, 1);
assert.equal(state.vram[0x280], 0, "a two-cycle copy cannot progress on one cycle");
vbxe.advanceBlitter(state, 2);
assert.equal(state.vram[0x280], 0x7f, "a normal copy completes on two cycles");

writeBlock(0x3e0, [
  0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
  0x81, 0x02, 0x00, 0x00, 0x00, 0x01,
  0x00, 0x00, 0x00, 0x00, 0x5a, 0x00, 0x00, 0x00, 0x00,
]);
start(0x3e0, false);
vbxe.advanceBlitter(state, 22);
assert.equal(state.vram[0x281], 0x5a, "constant mode-0 fill takes one output cycle");

// The local-bus budget starts at 912 cycles and reserves AHRM DMA consumers
// before the low-priority blitter. The FX scheduler charges each overlay
// mode by its actual narrow/normal/wide aggregate reservation; a fixed
// 22-cycle XDL update, attribute row, and 26 MEMAC accesses leave 372 cycles.
assert.equal(vbxe.localBusBudget(state, null), 912, "idle scanline has all local cycles");
state.videoControlActive = 1;
state.xdlSlots = 22;
for (let i = 0; i < 26; i++) vbxe.noteMemacAccess(state);
assert.equal(vbxe.localBusBudget(state, {
  mode: "standard", overlayEnabled: true, attributeMapEnabled: true, attributeRow: 0,
  attributeScrollY: 0, attributeCellHeight: 8,
}), 372, "busy standard line reserves FX aggregate overlay bandwidth");
assert.equal(state.memacSlots, 0, "scanline budget consumes recorded MEMAC slots");

assert.equal(vbxe.localBusBudget(state, {
  mode: "lores", overlayEnabled: true, overlayWidth: 0,
}), 784, "narrow lores reserves 128 local cycles");
assert.equal(vbxe.localBusBudget(state, {
  mode: "text", overlayEnabled: true, overlayWidth: 2,
}), 657, "wide text reserves 255 local cycles");
assert.equal(vbxe.localBusBudget(state, {
  mode: "hires", overlayEnabled: true, overlayWidth: 3,
}), 656, "width code three aliases narrow for DMA");

// AHRM 12.4: AtMapOn or a new map address reloads the 43-cell buffer even
// when the old map row had not reached its normal height rollover.
assert.equal(vbxe.localBusBudget(state, {
  mode: "off", overlayEnabled: false, attributeMapEnabled: true, attributeRow: 3,
  attributeScrollY: 0, attributeCellHeight: 8, attributeMapReload: true,
}), 740, "restarting an attribute map reserves its buffered row immediately");

console.log("vbxe_blitter_state.test.js passed");
