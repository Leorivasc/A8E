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
assert.equal(vbxe.normalizeConfig().enabled, false);
assert.deepEqual(
  vbxe.normalizeConfig({ profile: "fx1.26", page: 0xd740 }),
  { enabled: true, profile: "fx1.26", page: 0xd740 },
);

const state = vbxe.createState("fx1.26");
assert.equal(state.enabled, true);
assert.equal(state.vram.length, 512 * 1024);
assert.equal(vbxe.access(state, 0xd640), 0x11);
assert.equal(vbxe.access(state, 0xd641), 0x26);
assert.equal(vbxe.access(state, 0xd642), 0xff);

vbxe.access(state, 0xd640, 0x0f);
vbxe.access(state, 0xd641, 0x34);
vbxe.access(state, 0xd642, 0x12);
vbxe.access(state, 0xd643, 0x07);
assert.equal(state.videoControlActive, 0);
assert.equal(state.xdlAddressActive, 0);
vbxe.verticalSync(state);
assert.equal(state.videoControlActive, 0x0f);
assert.equal(state.xdlAddressActive, 0x71234);

vbxe.access(state, 0xd644, 0x22);
vbxe.access(state, 0xd645, 0x03);
vbxe.access(state, 0xd646, 0xaa);
vbxe.access(state, 0xd647, 0x54);
vbxe.access(state, 0xd648, 0xfe);
const colorOffset = ((3 * 256 + 0x22) * 3) | 0;
assert.deepEqual(
  Array.from(state.palette.subarray(colorOffset, colorOffset + 3)),
  [0xaa, 0x54, 0xfe],
);
assert.equal(state.colorSelect, 0x23);

vbxe.access(state, 0xd65e, 0x9f);
vbxe.access(state, 0xd65f, 0xe7);
assert.equal(vbxe.access(state, 0xd65e), 0x9f);
assert.equal(vbxe.access(state, 0xd65f), 0xe7);
assert.equal(vbxe.memacAddress(state, 0x9000, false), 0x60000);
assert.equal(vbxe.memacAddress(state, 0x9000, true), 0x60000);
vbxe.access(state, 0xd65d, 0xc5);
assert.equal(vbxe.memacAddress(state, 0x4000, false), 0x14000);
assert.equal(vbxe.memacAddress(state, 0x7fff, true), 0x17fff);
state.vram[0x1234] = 0x5a;
const restored = vbxe.restoreState(vbxe.cloneState(state));
assert.equal(restored.vram[0x1234], 0x5a);
assert.equal(restored.xdlAddressActive, 0x71234);
assert.equal(restored.memacControl, 0x9f);

state.videoControlPending = 1;
state.xdlAddressPending = 0x20;
state.vram.set([0x62, 0x00, 0x00, 0x00, 0x10, 0x00, 0x40, 0x01], 0x20);
vbxe.verticalSync(state);
const xdlLine = vbxe.nextXdlLine(state, 8);
assert.equal(xdlLine.mode, "standard");
assert.equal(xdlLine.address, 0x1000);
assert.equal(xdlLine.stride, 0x140);
assert.equal(xdlLine.overlayPalette, 1);
assert.equal(xdlLine.priority, 0xff);
assert.equal(vbxe.nextXdlLine(state, 9).address, 0x1140);
state.xdlAddressPending = 0x30;
state.vram.set([0x42, 0x10, 0x00, 0x10, 0x00, 0x40], 0x30);
vbxe.verticalSync(state);
assert.equal(vbxe.nextXdlLine(state, 8).mode, "hires");
state.xdlAddressPending = 0x40;
state.vram.set([0xe1, 0x01, 0x07, 0x00, 0x10, 0x00, 0xa0, 0x00, 0x03, 0x04, 0x20], 0x40);
vbxe.verticalSync(state);
for (let row = 0; row < 8; row++) {
  const textLine = vbxe.nextXdlLine(state, 8 + row);
  assert.equal(textLine.mode, "text");
  assert.equal(textLine.address, 0x1000);
  assert.equal(textLine.stride, 0xa0);
  assert.equal(textLine.characterBase, 0x10000);
  assert.equal(textLine.textScrollX, 3);
  assert.equal(textLine.textScrollY, 4);
  assert.equal(textLine.textRow, row);
}
assert.equal(state.xdl.overlayAddress, 0x10a0);
// Attribute-map optional blocks preserve an address/4-byte stride, layout,
// and the per-line map state. Bit 3 of control byte 0 enables the map.
state.xdlAddressPending = 0x50;
state.vram.set([
  0x4a, 0x0e, // Graphics, AtMapOn, OvAddress; AttrAddr/Layout/OvMisc.
  0x00, 0x10, 0x00, 0x40, 0x00,
  0x00, 0x20, 0x00, 0xa0, 0x00,
  0x00, 0x00, 0x07, 0x07,
  0x04, 0xff,
], 0x50);
vbxe.verticalSync(state);
const attributeLine = vbxe.nextXdlLine(state, 8);
assert.equal(attributeLine.attributeMapEnabled, true);
assert.equal(attributeLine.attributeAddress, 0x2000);
assert.equal(attributeLine.attributeStride, 0xa0);
assert.equal(attributeLine.attributeScrollX, 1);
assert.equal(attributeLine.attributeScrollY, 1);
assert.equal(attributeLine.attributeCellWidth, 8);
assert.equal(attributeLine.attributeCellHeight, 8);
assert.equal(attributeLine.attributeRow, 0);
state.vram[0x1000] = 0x02;
state.palette.set([0x12, 0x34, 0x56], (256 + 2) * 3);
const video = {
  vbxeRgb: new Uint32Array(456 * 16),
  vbxeHiresRgb: new Uint32Array(672 * 16),
  vbxeHiresWidth: 672,
};
vbxe.renderXdlLine(state, video, 8, { mode: "standard", address: 0x1000 });
assert.equal(video.vbxeRgb[8 * 456 + 128], 0xff563412);
vbxe.renderXdlLine(state, video, 9, { mode: "lores", address: 0x1000 });
assert.equal(video.vbxeRgb[9 * 456 + 128], 0xff563412);
assert.equal(video.vbxeRgb[9 * 456 + 129], 0xff563412);
// Hires holds two MSB-first 4-bit pixels in each source byte. It uses the
// selected palette's first sixteen entries, while COLMASK still sees the
// complete byte (AHRM 12.4).
state.vram[0x1010] = 0xa5;
state.palette.set([0x9a, 0xbc, 0xde], (256 + 0x0a) * 3);
state.palette.set([0x45, 0x67, 0x89], (256 + 0x05) * 3);
vbxe.renderXdlLine(state, video, 9, { mode: "hires", address: 0x1010 });
const hiresBase = 672 + 16;
assert.equal(video.vbxeHiresRgb[hiresBase], 0xffdebc9a);
assert.equal(video.vbxeHiresRgb[hiresBase + 1], 0xff896745);
// Text is an 80-column stream of character/attribute pairs. Font bits are
// hires-resolution and use the 2 KiB-aligned XDL character base.
state.videoControlActive = 0x01;
state.vram[0x1020] = 1;
state.vram[0x1021] = 2;
state.vram[0x1108] = 0x80;
state.palette.set([0x21, 0x43, 0x65], (256 + 2) * 3);
vbxe.renderXdlLine(state, video, 9, { mode: "text", address: 0x1020, characterBase: 0x1100, textRow: 0 });
assert.equal(video.vbxeHiresRgb[hiresBase], 0xff654321);
state.vram[0x1108] = 0;
state.vram[0x1021] = 0x82;
state.palette.set([0xab, 0xcd, 0xef], (256 + 0x82) * 3);
vbxe.renderXdlLine(state, video, 9, { mode: "text", address: 0x1020, characterBase: 0x1100, textRow: 0 });
assert.equal(video.vbxeHiresRgb[hiresBase], 0xffefcdab);
state.videoControlActive = 0x05;
state.vram[0x1021] = 2;
vbxe.renderXdlLine(state, video, 9, { mode: "text", address: 0x1020, characterBase: 0x1100, textRow: 0 });
assert.equal(video.vbxeHiresRgb[hiresBase], 0);
state.videoControlActive = 0x01;
state.vram[0x1020] = 1;
state.vram[0x1021] = 2;
state.vram[0x1022] = 2;
state.vram[0x1023] = 3;
state.vram[0x1108] = 0;
state.vram[0x1110] = 0x80;
state.palette.set([0x11, 0x22, 0x33], (256 + 3) * 3);
vbxe.renderXdlLine(state, video, 9, { mode: "text", address: 0x1020, characterBase: 0x1100, textRow: 0, textScrollX: 8 });
assert.equal(video.vbxeHiresRgb[hiresBase], 0xff332211);
state.vram[0x1024] = 2;
state.vram[0x1025] = 3;
state.vram[0x110f] = 0;
state.vram[0x1110] = 0x80;
vbxe.renderXdlLine(state, video, 9, { mode: "text", address: 0x1020, stride: 4, characterBase: 0x1100, textRow: 7, textScrollY: 1 });
assert.equal(video.vbxeHiresRgb[hiresBase], 0xff332211);
// Attribute-map control bits select an overlay palette and one of P0-P3 for
// every 8x8 standard-resolution cell. Bit 3 independently latches ATT.
state.videoControlActive = 0x01;
state.vram[0x1200] = 1;
state.vram[0x1201] = 2;
state.vram[0x1204] = 2;
state.vram[0x1205] = 2;
state.vram[0x1108] = 0x80;
state.vram[0x1110] = 0x80;
state.vram[0x2003] = 0x28; // Palette 2, ATT collision, priority P0.
state.vram[0x2007] = 0x30; // Palette 3, priority P0.
state.palette.set([0x10, 0x20, 0x30], (2 * 256 + 2) * 3);
state.palette.set([0x40, 0x50, 0x60], (3 * 256 + 2) * 3);
state.priority[0] = 0x10; // Above PF0.
video.priority = new Uint16Array(456 * 16);
video.priority.fill(0x01, 9 * 456 + 128, 10 * 456 + 128);
state.collisionDetect = 0;
vbxe.renderXdlLine(state, video, 9, {
  mode: "text", address: 0x1200, characterBase: 0x1100, textRow: 0,
  priority: 0x00, attributeMapEnabled: true, attributeAddress: 0x2000,
  attributeStride: 0xa0, attributeCellWidth: 8, attributeCellHeight: 8,
  attributeRow: 0,
});
assert.equal(video.vbxeHiresRgb[hiresBase], 0xff302010);
assert.equal(video.vbxeHiresRgb[hiresBase + 16], 0xff605040);
assert.equal(vbxe.access(state, 0xd64a), 0x80);
// A zero map step reuses that initialized map row after every 8-line cell
// row. This is also the compact external diagnostic layout.
video.priority.fill(0x01, 10 * 456 + 128, 11 * 456 + 128);
vbxe.renderXdlLine(state, video, 10, {
  mode: "text", address: 0x1200, characterBase: 0x1100, textRow: 0,
  priority: 0x00, attributeMapEnabled: true, attributeAddress: 0x2000,
  attributeStride: 0, attributeCellWidth: 8, attributeCellHeight: 8,
  attributeRow: 8,
});
const secondMapRowBase = 2 * 672 + 16;
assert.equal(video.vbxeHiresRgb[secondMapRowBase], 0xff302010);
assert.equal(video.vbxeHiresRgb[secondMapRowBase + 16], 0xff605040);
state.palette.set([0x12, 0x34, 0x56], (256 + 2) * 3);
state.videoControlActive = 0x05;
state.vram[0x1000] = 0;
video.vbxeRgb[10 * 456 + 128] = 0x12345678;
vbxe.renderXdlLine(state, video, 10, { mode: "standard", address: 0x1000 });
assert.equal(video.vbxeRgb[10 * 456 + 128], 0);
state.videoControlActive = 0x0d;
state.vram[0x1000] = 0x2f;
video.vbxeRgb[10 * 456 + 128] = 0x12345678;
vbxe.renderXdlLine(state, video, 10, { mode: "standard", address: 0x1000 });
assert.equal(video.vbxeRgb[10 * 456 + 128], 0);
video.priority = new Uint16Array(456 * 16);
state.vram[0x1001] = 2;
video.priority[11 * 456 + 128] = 0x01;
vbxe.renderXdlLine(state, video, 11, { mode: "standard", address: 0x1001, priority: 0x00 });
assert.equal(video.vbxeRgb[11 * 456 + 128], 0);
vbxe.renderXdlLine(state, video, 11, { mode: "standard", address: 0x1001, priority: 0x10 });
assert.equal(video.vbxeRgb[11 * 456 + 128], 0xff563412);

// Overlay collisions use the source-byte COLMASK groups and GTIA layer
// metadata. They do not depend on whether the XDL priority lets the overlay
// remain visible. The values below represent PF0, PF2, P1, and GTIA-mode-10
// P3 respectively.
assert.equal(vbxe.collisionBitsForPriority(0x0001 | 0x0004 | 0x0020 | 0x0800), 0x5a);
state.videoControlActive = 0x01;
state.collisionDetect = 0;
vbxe.access(state, 0xd649, 0x02); // $20-$3F source-byte group only.
state.vram[0x1002] = 0x22;
state.palette.set([0x12, 0x34, 0x56], (256 + 0x22) * 3);
video.priority[12 * 456 + 128] = 0x0001 | 0x0004 | 0x0020 | 0x0800;
vbxe.renderXdlLine(state, video, 12, { mode: "standard", address: 0x1002, priority: 0x00 });
assert.equal(video.vbxeRgb[12 * 456 + 128], 0);
assert.equal(vbxe.access(state, 0xd64a), 0x5a);
vbxe.access(state, 0xd64a, 0xff);
assert.equal(vbxe.access(state, 0xd64a), 0);
video.vbxeCollisionPriority = new Uint16Array(456 * 16);
video.priority[12 * 456 + 128] = 0x11; // PF0 plus an active, hidden P0.
video.vbxeCollisionPriority[12 * 456 + 128] = 0x8001; // PF0 alone contributes.
vbxe.renderXdlLine(state, video, 12, { mode: "standard", address: 0x1002, priority: 0x01 });
assert.equal(video.vbxeRgb[12 * 456 + 128], 0);
vbxe.renderXdlLine(state, video, 12, { mode: "standard", address: 0x1002, priority: 0x10 });
assert.equal(video.vbxeRgb[12 * 456 + 128], 0xff563412);
vbxe.renderXdlLine(state, video, 12, { mode: "standard", address: 0x1002 });
assert.equal(vbxe.access(state, 0xd64a), 0x10);
vbxe.access(state, 0xd64a, 0xff);
vbxe.access(state, 0xd649, 0x01);
vbxe.renderXdlLine(state, video, 12, { mode: "standard", address: 0x1002 });
assert.equal(vbxe.access(state, 0xd64a), 0);
state.videoControlActive = 0x05; // Color zero transparent.
state.vram[0x1002] = 0;
vbxe.access(state, 0xd649, 0x01);
vbxe.renderXdlLine(state, video, 12, { mode: "standard", address: 0x1002 });
assert.equal(vbxe.access(state, 0xd64a), 0);
state.videoControlActive = 0x0d; // Color 0 and 15 transparent.
state.vram[0x1002] = 0xf5;
video.priority[12 * 456 + 128] = 0x0001;
vbxe.access(state, 0xd649, 0x20); // $A0-$BF source-byte group.
vbxe.renderXdlLine(state, video, 12, { mode: "hires", address: 0x1002 });
assert.equal(video.vbxeRgb[12 * 456 + 128], 0);
assert.equal(vbxe.access(state, 0xd64a), 0);
state.vram[0x1002] = 0x2f;
vbxe.access(state, 0xd649, 0x02); // $20-$3F source-byte group.
vbxe.renderXdlLine(state, video, 12, { mode: "standard", address: 0x1002 });
assert.equal(vbxe.access(state, 0xd64a), 0);
state.videoControlActive = 0x01;
state.vram[0x1002] = 0xa5;
vbxe.access(state, 0xd649, 0x20);
vbxe.renderXdlLine(state, video, 12, { mode: "hires", address: 0x1002 });
assert.equal(vbxe.access(state, 0xd64a), 0x10);

vbxe.softReset(state);
assert.equal(state.videoControlPending, 0);
assert.equal(state.memacControl, 0);
assert.equal(state.vram[0x1234], 0x5a);
vbxe.powerCycle(state);
assert.equal(state.vram[0x1234], 0);

console.log("vbxe_device_state.test.js passed");
