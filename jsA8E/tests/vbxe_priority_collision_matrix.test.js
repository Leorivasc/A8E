"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "js", "core", "vbxe.js"),
  "utf8",
);
const context = { Uint8Array: Uint8Array };
context.window = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: "vbxe.js" });

const vbxe = context.A8EVbxe;

// The collision latch reports final GTIA contributors, not the RGB value.
// Ordinary GTIA, mode 9, and mode 11 retain the contributor groups; mode 10
// exposes the measured all-input mask whenever a visible input exists.
const contributors = [
  ["P0", 0x0010, 0x01],
  ["P1", 0x0020, 0x02],
  ["P2", 0x0040, 0x04],
  ["P3", 0x0080, 0x08],
  ["PF0", 0x0001, 0x10],
  ["PF1", 0x0002, 0x20],
  ["PF2", 0x0004, 0x40],
  ["PF3/P5", 0x0008, 0x40],
];
for (const gtiaMode of [0, 1, 3]) {
  for (const [name, priority, expected] of contributors) {
    assert.equal(vbxe.collisionBitsForPriority(priority, gtiaMode), expected,
      name + " must retain its collision group in GTIA mode " + gtiaMode);
  }
}
assert.equal(vbxe.collisionBitsForPriority(0, 2), 0,
  "GTIA mode 10 must not report a collision without a visible input");
for (const [name, priority] of contributors) {
  assert.equal(vbxe.collisionBitsForPriority(priority, 2), 0x7f,
    name + " must expose the measured all-input mask in GTIA mode 10");
}
assert.equal(vbxe.collisionBitsForPriority(0x0001 | 0x0004 | 0x0020 | 0x0800), 0x5a,
  "mixed PF/P1/GTIA-10 contributors must keep independent groups");

// FX 1.20/1.24 use the legacy priority map: background is always visible,
// PF2 and PF3/P5 use bits 6/7, and player/missile layers are not addressable.
for (const profile of ["fx1.20", "fx1.24"]) {
  assert.equal(vbxe.overlayWinsPriority(profile, 0, 0x00), true,
    profile + " background must remain visible with a zero mask");
  assert.equal(vbxe.overlayWinsPriority(profile, 0x0004, 0x00), false,
    profile + " PF2 must be hidden without bit 6");
  assert.equal(vbxe.overlayWinsPriority(profile, 0x0004, 0x40), true,
    profile + " PF2 must be addressable by bit 6");
  assert.equal(vbxe.overlayWinsPriority(profile, 0x0008, 0x40), false,
    profile + " PF3/P5 must not use bit 6");
  assert.equal(vbxe.overlayWinsPriority(profile, 0x0008, 0x80), true,
    profile + " PF3/P5 must be addressable by bit 7");
  assert.equal(vbxe.overlayWinsPriority(profile, 0x0010, 0xff), false,
    profile + " player layers must not be addressable");
}

// FX 1.26 and 1.26r use the full eight-group priority map.
for (const profile of ["fx1.26", "fx1.26r"]) {
  const cases = [
    ["background", 0x0000, 0x80],
    ["PF0", 0x0001, 0x10],
    ["PF1", 0x0002, 0x20],
    ["PF2/PF3", 0x000c, 0x40],
    ["P0", 0x0010, 0x01],
    ["P1", 0x0020, 0x02],
    ["P2", 0x0040, 0x04],
    ["P3", 0x0080, 0x08],
  ];
  for (const [name, priority, mask] of cases) {
    assert.equal(vbxe.overlayWinsPriority(profile, priority, mask), true,
      profile + " " + name + " must respond to its priority bit");
    assert.equal(vbxe.overlayWinsPriority(profile, priority, mask ^ 0xff), false,
      profile + " " + name + " must remain hidden without its priority bit");
  }
}

console.log("vbxe_priority_collision_matrix: profiles, GTIA modes, and contributor groups verified.");
