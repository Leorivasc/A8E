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

const powerUpPalette = new Uint8Array(256 * 3);
powerUpPalette.set([0x12, 0x34, 0x56], 0x24 * 3);
const paletteState = vbxe.createState("fx1.26", powerUpPalette);
assert.deepEqual(Array.from(paletteState.palette.slice(0x24 * 3, 0x24 * 3 + 3)), [0x12, 0x34, 0x56]);
assert.deepEqual(Array.from(paletteState.palette.slice(256 * 3, 256 * 3 + 3)), [0, 0, 0]);

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
// A repeat count is the number of additional lines, so $BF supplies this
// attribute-map entry for 192 scanlines in total before the following XDL
// entry is fetched.
state.xdlAddressPending = 0x80;
state.vram.set([
  0x28, 0x02, 0xbf, 0x00, 0x20, 0x00, 0x00, 0x00,
  0x10, 0x80,
], 0x80);
vbxe.verticalSync(state);
for (let line = 0; line < 192; line++) {
  const repeated = vbxe.nextXdlLine(state, 8 + line);
  assert.equal(repeated.attributeMapEnabled, true, "repeat line " + line);
}
assert.equal(state.xdl.address, 0x88, "repeat must not consume the next XDL entry early");
assert.equal(vbxe.nextXdlLine(state, 200), null,
  "AtMapOff + End must stop the XDL after the repeated field");
assert.equal(state.xdl.ended, true, "End terminates the XDL");
assert.equal(state.xdl.attributeMapEnabled, false, "AtMapOff clears the map before End");
assert.equal(state.xdl.address, 0x8a, "termination entry is fetched after the repeated field");
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
video.vbxeRgb.fill(0x12345678, 10 * 456 + 128, 10 * 456 + 384);
vbxe.renderXdlLine(state, video, 10, { mode: "off", attributeMapEnabled: true });
assert.equal(video.vbxeRgb[10 * 456 + 128], 0,
  "attribute-map-only line clears stale overlay RGB before composition");
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
state.vram.set([0x12, 0x34, 0x56, 0xc4], 0x2020);
const completeMapCell = vbxe.attributeMapCell(state, {
  attributeMapEnabled: true, attributeAddress: 0x2020, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 8,
  attributeCellHeight: 8, attributeRow: 0,
}, 0);
assert.deepEqual(
  completeMapCell,
  { control: 0xc4, playfield0: 0x12, playfield1: 0x34, playfield2: 0x56,
    reverse: true, playfieldPalette: 3, overlayPalette: 0, priority: 0x00 },
);
// The first playfield subset replaces only a visible PF0-PF2 pixel with the
// selected map palette; a winning overlay remains above that replacement.
state.palette.set([0xa1, 0xb2, 0xc3], (3 * 256 + 0x12) * 3);
video.vbxeRgb.fill(0);
video.priority = new Uint16Array(456 * 16);
video.priority[9 * 456 + 128] = 0x01;
vbxe.applyPlayfieldAttributes(state, video, 9, {
  attributeMapEnabled: true, attributeAddress: 0x2020, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 8,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.equal(video.vbxeRgb[9 * 456 + 128], 0xffc3b2a1);
state.palette.set([0xd4, 0xe5, 0xf6], (3 * 256 + 0x34) * 3);
state.palette.set([0x07, 0x18, 0x29], (3 * 256 + 0x56) * 3);
video.vbxeRgb.fill(0);
video.priority.fill(0);
video.priority[9 * 456 + 128] = 0x02;
video.priority[9 * 456 + 129] = 0x04;
vbxe.applyPlayfieldAttributes(state, video, 9, {
  attributeMapEnabled: true, attributeAddress: 0x2020, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 8,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.equal(video.vbxeRgb[9 * 456 + 128], 0xfff6e5d4);
assert.equal(video.vbxeRgb[9 * 456 + 129], 0xff291807);
state.vram.set([0x13, 0x35, 0x57, 0xc0], 0x2030);
state.palette.set([0x7a, 0x8b, 0x9c], (3 * 256 + 0x13) * 3);
video.vbxeRgb.fill(0);
video.priority.fill(0);
video.priority[9 * 456 + 128] = 0x01;
state.videoControlActive = 0x03;
vbxe.applyPlayfieldAttributes(state, video, 9, {
  attributeMapEnabled: true, attributeAddress: 0x2030, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 8,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.equal(video.vbxeRgb[9 * 456 + 128], 0xff9c8b7a);
video.vbxeRgb[9 * 456 + 128] = 0xff010203;
vbxe.applyPlayfieldAttributes(state, video, 9, {
  attributeMapEnabled: true, attributeAddress: 0x2020, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 8,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.equal(video.vbxeRgb[9 * 456 + 128], 0xff010203);
// In ANTIC Graphics 8 (mode F), byte 0 is a PF3 bitmap rather than a PF0
// override. A set bit replaces a visible PF2 source; its palette remains the
// playfield palette selected by the cell.
state.vram.set([0x80, 0x00, 0x56, 0xc0], 0x2040);
state.palette.set([0x11, 0x22, 0x33], (3 * 256 + 0x56) * 3);
state.palette.set([0x44, 0x55, 0x66], (3 * 256 + 0x78) * 3);
video.vbxeRgb.fill(0);
video.priority.fill(0);
video.priority[9 * 456 + 128] = 0x04;
video.priority[9 * 456 + 129] = 0x04;
state.videoControlActive = 0x03;
vbxe.applyPlayfieldAttributes(state, video, 9, {
  anticMode: 0x0f, anticPf3: 0x78,
  attributeMapEnabled: true, attributeAddress: 0x2040, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 8,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.equal(video.vbxeRgb[9 * 456 + 128], 0xff665544);
assert.equal(video.vbxeRgb[9 * 456 + 129], 0xff332211);
// Rev turns Graphics 8's adjacent source bits into a PF0-PF3 value. The
// map's byte 0 returns to PF0 while PF3 comes from the shadowed GTIA color.
state.vram.set([0x12, 0x34, 0x56, 0x04], 0x2050);
state.palette.set([0x01, 0x02, 0x03], 0x12 * 3);
state.palette.set([0x11, 0x12, 0x13], 0x34 * 3);
state.palette.set([0x21, 0x22, 0x23], 0x56 * 3);
state.palette.set([0x31, 0x32, 0x33], 0x78 * 3);
video.vbxeRgb.fill(0);
video.anticSourceBits = new Uint8Array(456 * 16);
video.anticSourceBits.fill(0xff);
const reverseBase = 9 * 456 + 128;
video.anticSourceBits.set([0, 0, 0, 1, 1, 0, 1, 1], reverseBase);
vbxe.applyPlayfieldAttributes(state, video, 9, {
  anticMode: 0x0f, anticPf3: 0x78,
  attributeMapEnabled: true, attributeAddress: 0x2050, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 32,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.deepEqual(Array.from(video.vbxeRgb.slice(reverseBase, reverseBase + 8)), [
  0xff030201, 0xff030201, 0xff131211, 0xff131211,
  0xff232221, 0xff232221, 0xff333231, 0xff333231,
]);
// Mode 9 without VBXE displays raw-nibble luminance. In the FX 1.26
// attribute-map path, however, a valid reversed hires pair becomes opaque
// palette color 0; the focused Altirra differential is black for this setup.
video.vbxeRgb.fill(0);
video.priority.fill(0);
vbxe.applyPlayfieldAttributes(state, video, 9, {
  anticMode: 0x0f, anticGtiaMode: 1, anticPf3: 0x78,
  attributeMapEnabled: true, attributeAddress: 0x2050, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 32,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.deepEqual(Array.from(video.vbxeRgb.slice(reverseBase, reverseBase + 8)),
  [0xff000000, 0xff000000, 0xff000000, 0xff000000,
    0xff000000, 0xff000000, 0xff000000, 0xff000000]);
// Attribute-map colors also preserve the normal ANTIC field's native 320-pixel
// geometry in the 640-sample presentation plane instead of shrinking through
// the legacy 256-pixel compositor aperture.
const nativeSourceBase = 9 * 456 + 96;
const nativeHiresBase = 672 + 16;
video.vbxeRgb.fill(0);
video.vbxeHiresRgb.fill(0);
video.anticSourceBits.fill(0xff);
video.anticSourceBits.set([0, 0, 0, 1, 1, 0, 1, 1], nativeSourceBase);
vbxe.applyPlayfieldAttributes(state, video, 9, {
  mode: "off", anticMode: 0x0f, anticPf3: 0x78,
  attributeMapEnabled: true, attributeAddress: 0x2050, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 32,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.deepEqual(Array.from(video.vbxeHiresRgb.slice(nativeHiresBase, nativeHiresBase + 16)), [
  0xff030201, 0xff030201, 0xff030201, 0xff030201,
  0xff131211, 0xff131211, 0xff131211, 0xff131211,
  0xff232221, 0xff232221, 0xff232221, 0xff232221,
  0xff333231, 0xff333231, 0xff333231, 0xff333231,
]);
// AHRM classifies character modes 2 and 3 as hires too, so their decoded
// source bits use the same pair-to-PF0-PF3 reverse rule as Graphics 8.
video.vbxeRgb.fill(0);
video.anticSourceBits.set([0, 0, 0, 1, 1, 0, 1, 1], reverseBase);
vbxe.applyPlayfieldAttributes(state, video, 9, {
  anticMode: 0x02, anticPf3: 0x78,
  attributeMapEnabled: true, attributeAddress: 0x2050, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 32,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.deepEqual(Array.from(video.vbxeRgb.slice(reverseBase, reverseBase + 8)), [
  0xff030201, 0xff030201, 0xff131211, 0xff131211,
  0xff232221, 0xff232221, 0xff333231, 0xff333231,
]);
// Rev over a mode-D/E lores source turns each original two-bit value into
// two hires luminance samples on a PF2 base. It does not map the value to
// the PF0-PF3 color table used by reversed mode F.
state.vram.set([0x12, 0x84, 0x26, 0x04], 0x2060);
state.palette.set([0x10, 0x20, 0x30], 0x26 * 3);
state.palette.set([0x40, 0x50, 0x60], 0x24 * 3);
video.vbxeRgb.fill(0);
video.anticSourceLores = new Uint8Array(456 * 16);
video.anticSourceLores.fill(0xff);
video.anticSourceLores.set([0, 0, 1, 1, 2, 2, 3, 3], reverseBase);
vbxe.applyPlayfieldAttributes(state, video, 9, {
  anticMode: 0x0e,
  attributeMapEnabled: true, attributeAddress: 0x2060, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 32,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.deepEqual(Array.from(video.vbxeRgb.slice(reverseBase, reverseBase + 8)), [
  0xff302010, 0xff302010, 0xff302010, 0xff605040,
  0xff605040, 0xff302010, 0xff605040, 0xff605040,
]);
// In modes 6/7, a set glyph bit carries the character's PF0-PF3 selector;
// a clear bit (and PF0) both become the hires pair 00 under Reverse.
video.vbxeRgb.fill(0);
video.anticSourceLores.set([3, 3, 0, 0, 3, 3, 0, 0], reverseBase);
vbxe.applyPlayfieldAttributes(state, video, 9, {
  anticMode: 0x06,
  attributeMapEnabled: true, attributeAddress: 0x2060, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 32,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.deepEqual(Array.from(video.vbxeRgb.slice(reverseBase, reverseBase + 8)), [
  0xff605040, 0xff605040, 0xff302010, 0xff302010,
  0xff605040, 0xff605040, 0xff302010, 0xff302010,
]);
// Two-color lores modes use only background (000) and PF0 (100), whose
// AN0-1 portions both decode to the hires pair 00 under Reverse.
video.vbxeRgb.fill(0);
video.anticSourceLores.fill(0, reverseBase, reverseBase + 8);
vbxe.applyPlayfieldAttributes(state, video, 9, {
  anticMode: 0x09,
  attributeMapEnabled: true, attributeAddress: 0x2060, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 32,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.deepEqual(Array.from(video.vbxeRgb.slice(reverseBase, reverseBase + 8)), [
  0xff302010, 0xff302010, 0xff302010, 0xff302010,
  0xff302010, 0xff302010, 0xff302010, 0xff302010,
]);
// Bitmap modes 8/A retain each two-bit lores source over their wider pixel
// footprint; reversing each retained sample keeps the documented phase.
video.vbxeRgb.fill(0);
video.anticSourceLores.set([0, 0, 0, 0, 1, 1, 1, 1], reverseBase);
vbxe.applyPlayfieldAttributes(state, video, 9, {
  anticMode: 0x08,
  attributeMapEnabled: true, attributeAddress: 0x2060, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 32,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.deepEqual(Array.from(video.vbxeRgb.slice(reverseBase, reverseBase + 8)), [
  0xff302010, 0xff302010, 0xff302010, 0xff302010,
  0xff302010, 0xff605040, 0xff302010, 0xff605040,
]);
// Multicolor character modes 4/5 also supply two-bit lores glyph values at
// the D/E cadence, so AHRM's lores-to-hires reverse rule is identical.
video.vbxeRgb.fill(0);
video.anticSourceLores.set([0, 0, 1, 1, 2, 2, 3, 3], reverseBase);
vbxe.applyPlayfieldAttributes(state, video, 9, {
  anticMode: 0x04,
  attributeMapEnabled: true, attributeAddress: 0x2060, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 32,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.deepEqual(Array.from(video.vbxeRgb.slice(reverseBase, reverseBase + 8)), [
  0xff302010, 0xff302010, 0xff302010, 0xff605040,
  0xff605040, 0xff302010, 0xff605040, 0xff605040,
]);
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
