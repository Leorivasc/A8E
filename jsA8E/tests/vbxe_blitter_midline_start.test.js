"use strict";

// Altirra runs the rest of the current scanline's blitter budget as soon as
// BLITTER_START is written. A guest that reads BLT_COLLISION_CODE right after
// starting a stencil blit (Mr. Proper does) must already see the collision.

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

function prepare(background, mask) {
  const state = vbxe.createState("fx1.26");
  // 4x4 stencil sprite of colour $41 over a background whose rows 2-3 hold $60.
  for (let i = 0; i < 16; i++) state.vram[0x100 + i] = 0x41;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) state.vram[0x200 + y * 4 + x] = y >= 2 ? (background === undefined ? 0x60 : background) : 0;
  }
  state.vram.set([
    0x00, 0x01, 0x00, 0x04, 0x00, 0x01,
    0x00, 0x02, 0x00, 0x04, 0x00, 0x01,
    0x03, 0x00, 0x03, 0xff, 0x00, mask === undefined ? 0xff : mask, 0x00, 0x00, 0x01,
  ], 0x300);
  vbxe.access(state, 0xd650, 0x00);
  vbxe.access(state, 0xd651, 0x03);
  vbxe.access(state, 0xd652, 0x00);
  vbxe.access(state, 0xd653, 1);
  return state;
}

// Plenty of the line left: the blit completes and the code is readable at once.
let state = prepare();
const residual = vbxe.startBlitterMidLine(state, 600, null);
assert.equal(vbxe.access(state, 0xd653), 0, "short blit finishes inside the line slice");
assert.equal(vbxe.access(state, 0xd650), 0x60, "collision code is visible right after START");
assert.equal(residual, -1, "no completion IRQ was armed");
assert.equal(state.blitterEarlyRun, true, "the line-end budget is marked as spent");

// Almost no line left: only the control block load fits, so nothing collided yet.
state = prepare();
vbxe.startBlitterMidLine(state, 30, null);
assert.notEqual(vbxe.access(state, 0xd653), 0, "blit continues into the next line");
assert.equal(vbxe.access(state, 0xd650), 0, "no collision before the blit reaches row 2");

// AHRM 12.4: collision mask bit 0 covers $01-1F and bit 1 covers $20-3F.
state = prepare(0x20, 0x01);
vbxe.startBlitterMidLine(state, 600, null);
assert.equal(vbxe.access(state, 0xd650), 0, "$20 is outside the bit-0 group");
state = prepare(0x20, 0x02);
vbxe.startBlitterMidLine(state, 600, null);
assert.equal(vbxe.access(state, 0xd650), 0x20, "$20 belongs to the bit-1 group");

console.log("vbxe_blitter_midline_start: START executes the rest of the line.");
