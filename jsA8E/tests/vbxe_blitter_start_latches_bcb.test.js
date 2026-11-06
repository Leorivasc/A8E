"use strict";

// Altirra loads the first blitter control block as soon as BLITTER_START is
// written ("some demos are a bit creative and overwrite the first entry
// without checking blitter status"). Gacek rewrites its BCB right after
// starting a blit; using the new bytes left trails of undrawn sprites.

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
// Two 4x1 sources with different colors; the blit copies source A to $400.
state.vram.set([1, 2, 3, 4], 0x100);
state.vram.set([9, 9, 9, 9], 0x200);
const bcb = [
  0x00, 0x01, 0x00, 0x04, 0x00, 0x01,   // source $0100, Y step 4, X step 1
  0x00, 0x04, 0x00, 0x04, 0x00, 0x01,   // destination $0400, Y step 4, X step 1
  0x03, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, // 4x1, AND $FF, mode 0
];
state.vram.set(bcb, 0x300);
vbxe.access(state, 0xd650, 0x00);
vbxe.access(state, 0xd651, 0x03);
vbxe.access(state, 0xd652, 0x00);
vbxe.access(state, 0xd653, 1);
// The program reuses the block for the next sprite before the load finishes.
state.vram[0x301] = 0x02; // source now $0200
// Not enough budget to finish loading in this call, enough afterwards.
vbxe.advanceBlitter(state, 10, true);
vbxe.advanceBlitter(state, 400, true);
assert.deepEqual(Array.from(state.vram.subarray(0x400, 0x404)), [1, 2, 3, 4],
  "the blit uses the BCB as it was at BLITTER_START");

// A second blit started afterwards sees the rewritten block.
state.vram.fill(0, 0x400, 0x404);
vbxe.access(state, 0xd653, 1);
vbxe.advanceBlitter(state, 400, true);
assert.deepEqual(Array.from(state.vram.subarray(0x400, 0x404)), [9, 9, 9, 9],
  "a new START latches the new BCB");

console.log("vbxe_blitter_start_latches_bcb: first BCB is latched at START.");
