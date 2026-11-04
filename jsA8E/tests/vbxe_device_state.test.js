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
assert.deepEqual(
  vbxe.normalizeConfig({ profile: "fx1.24", page: 0xd640 }),
  { enabled: true, profile: "fx1.24", page: 0xd640 },
);
assert.deepEqual(
  vbxe.normalizeConfig("fx120"),
  { enabled: true, profile: "fx1.20", page: 0xd640 },
);
assert.deepEqual(
  vbxe.normalizeConfig("fx126r"),
  { enabled: true, profile: "fx1.26r", page: 0xd640 },
);

const state = vbxe.createState("fx1.26");
assert.equal(state.enabled, true);
assert.equal(state.vram.length, 512 * 1024);
assert.equal(vbxe.access(state, 0xd640), 0x10);
assert.equal(vbxe.access(state, 0xd641), 0x26);
assert.equal(vbxe.access(state, 0xd642), 0xff);
const legacyState = vbxe.createState("fx1.24");
assert.equal(vbxe.access(legacyState, 0xd640), 0x10);
assert.equal(vbxe.access(legacyState, 0xd641), 0x24);
const earlyState = vbxe.createState("fx1.20");
assert.equal(vbxe.access(earlyState, 0xd641), 0x20);
const ramboState = vbxe.createState("fx1.26r");
assert.equal(vbxe.access(ramboState, 0xd641), 0xa6,
  "RAMBO capability appears in MINOR_REVISION D7");
assert.equal(vbxe.ramboAddress(ramboState, 0x4000, 0xff), -1,
  "PORTB D4 disables the shared window");
assert.equal(vbxe.ramboAddress(ramboState, 0x4000, 0xef), 0x40000,
  "all RAMBO bank bits high select local $40000");
assert.equal(vbxe.ramboAddress(ramboState, 0x7fff, 0x00), 0x7ffff,
  "all RAMBO bank bits low select local $7C000");
const alternateLegacyState = vbxe.createState({ profile: "fx1.24", page: 0xd740 });
assert.equal(vbxe.access(alternateLegacyState, 0xd640), null);
assert.equal(vbxe.access(alternateLegacyState, 0xd740), 0x10);
assert.equal(vbxe.access(alternateLegacyState, 0xd741), 0x24);
// The serial configuration pins occupy $DxC0-$DxFF for the selected VBXE
// page. Only DATA0/DCLK//CONFIG (D0-D2) are latched; CONF_DONE stays low.
assert.equal(vbxe.access(alternateLegacyState, 0xd7c0), 0);
vbxe.access(alternateLegacyState, 0xd7ff, 0xfd);
assert.equal(vbxe.access(alternateLegacyState, 0xd7c2), 0x05);
assert.equal(vbxe.access(alternateLegacyState, 0xd6c0), null);
const restoredLegacyState = vbxe.restoreState(vbxe.cloneState(alternateLegacyState));
assert.equal(restoredLegacyState.profile, "fx1.24");
assert.equal(restoredLegacyState.page, 0xd740);
assert.equal(vbxe.access(restoredLegacyState, 0xd7c0), 0x05);

const powerUpPalette = new Uint8Array(256 * 3);
powerUpPalette.set([0x12, 0x34, 0x56], 0x24 * 3);
const paletteState = vbxe.createState("fx1.26", powerUpPalette);
assert.deepEqual(Array.from(paletteState.palette.slice(0x24 * 3, 0x24 * 3 + 3)), [0x12, 0x34, 0x56]);
assert.deepEqual(Array.from(paletteState.palette.slice(256 * 3, 256 * 3 + 3)), [0, 0, 0]);

vbxe.access(state, 0xd640, 0x0f);
vbxe.access(state, 0xd641, 0x34);
vbxe.access(state, 0xd642, 0x12);
vbxe.access(state, 0xd643, 0x07);
assert.equal(state.videoControlActive, 0x0e,
  "VIDEO_CONTROL transparency and extended color apply before VSync");
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
  [0xab, 0x54, 0xff],
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
// MEMAC B bit 7 grants CPU access; bit 6 independently grants ANTIC DMA.
// DACTest relies on the CPU-only $80 form while probing the VBXE base.
vbxe.access(state, 0xd65d, 0x80);
assert.equal(vbxe.memacAddress(state, 0x4000, false), 0);
assert.equal(vbxe.memacAddress(state, 0x4000, true), -1);
vbxe.access(state, 0xd65d, 0x40);
assert.equal(vbxe.memacAddress(state, 0x4000, false), -1);
assert.equal(vbxe.memacAddress(state, 0x4000, true), 0);
state.vram[0x1234] = 0x5a;
const restored = vbxe.restoreState(vbxe.cloneState(state));
assert.equal(restored.vram[0x1234], 0x5a);
assert.equal(restored.xdlAddressActive, 0x71234);
assert.equal(restored.memacControl, 0x9f);

state.videoControlPending = 1;
state.xdlAddressPending = 0x20;
state.vram.set([0x62, 0x08, 0x00, 0x00, 0x10, 0x00, 0x40, 0x01, 0x61, 0xff], 0x20);
vbxe.verticalSync(state);
const xdlLine = vbxe.nextXdlLine(state, 8);
assert.equal(xdlLine.mode, "standard");
assert.equal(state.xdlSlots, 22,
  "a new XDL entry reserves the fixed AHRM update cost");
assert.equal(xdlLine.address, 0x1000);
assert.equal(xdlLine.stride, 0x140);
assert.equal(xdlLine.overlayWidth, 1, "width code 1 is normal");
assert.equal(xdlLine.playfieldPalette, 1);
assert.equal(xdlLine.overlayPalette, 2);
assert.equal(xdlLine.priority, 0xff);
// Width code 3 aliases narrow, while palette fields remain independently
// latched from the two high bit pairs of OvMisc.
state.xdlAddressPending = 0x2c;
state.vram.set([0x02, 0x08, 0xc3, 0x5a], 0x2c);
vbxe.verticalSync(state);
const narrowLine = vbxe.nextXdlLine(state, 8);
assert.equal(narrowLine.overlayWidth, 0);
assert.equal(narrowLine.playfieldPalette, 3);
assert.equal(narrowLine.overlayPalette, 0);
assert.equal(narrowLine.priority, 0x5a);
state.xdlAddressPending = 0x20;
vbxe.verticalSync(state);
const xdlLineAgain = vbxe.nextXdlLine(state, 8);
assert.equal(xdlLineAgain.overlayPalette, 2);
assert.equal(xdlLineAgain.priority, 0xff);
assert.equal(vbxe.nextXdlLine(state, 9).address, 0x1140);
state.xdlAddressPending = 0x30;
state.vram.set([0x42, 0x10, 0x00, 0x10, 0x00, 0x40], 0x30);
vbxe.verticalSync(state);
assert.equal(vbxe.nextXdlLine(state, 8).mode, "hires");
state.xdlAddressPending = 0x40;
state.vram.set([0xe1, 0x01, 0x07, 0x00, 0x10, 0x00, 0xa0, 0x00, 0xfb, 0xfc, 0x20], 0x40);
vbxe.verticalSync(state);
for (let row = 0; row < 8; row++) {
  const textLine = vbxe.nextXdlLine(state, 8 + row);
  assert.equal(textLine.mode, "text");
  assert.equal(textLine.address, row >= 4 ? 0x10a0 : 0x1000);
  assert.equal(textLine.stride, 0xa0);
  assert.equal(textLine.characterBase, 0x10000);
  assert.equal(textLine.textScrollX, 3, "text horizontal scroll is three bits");
  assert.equal(textLine.textScrollY, 4, "text vertical scroll is three bits");
  assert.equal(textLine.textRow, (4 + row) & 7);
}
assert.equal(state.xdl.overlayAddress, 0x10a0);
// A new text entry starts at its own vertical scroll row. The previous entry
// must not leak its current character row into the new entry.
state.xdlAddressPending = 0x44;
state.vram.set([0xe1, 0x81, 0x07, 0x00, 0x10, 0x00, 0x40, 0x00, 0x03, 0x04, 0x00], 0x44);
vbxe.verticalSync(state);
const scrolledTextLine = vbxe.nextXdlLine(state, 8);
assert.equal(scrolledTextLine.mode, "text");
assert.equal(scrolledTextLine.textRow, 4,
  "a new XDL text entry starts at OvScrollY");

// Control bits 0-1 set to 3 are disabled by Altirra's mode table.
state.xdlAddressPending = 0x48;
state.vram.set([0x03, 0x10], 0x48);
vbxe.verticalSync(state);
assert.equal(vbxe.nextXdlLine(state, 8), null,
  "the invalid combined graphics/text mode is disabled");

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
assert.equal(attributeLine.attributeScrollX, 0);
assert.equal(attributeLine.attributeScrollY, 0);
assert.equal(attributeLine.attributeCellWidth, 8);
assert.equal(attributeLine.attributeCellHeight, 8);
assert.equal(attributeLine.attributeRow, 0);
assert.equal(attributeLine.attributeMapReload, true,
  "AtMapOn/address update starts with a freshly buffered map row");
state.vram[0x2000] = 0x7e;
assert.equal(vbxe.attributeMapCell(state, attributeLine, 0).playfield0, 0,
  "attribute-map rendering uses the fetched 43-cell line buffer");
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
  assert.equal(state.xdlSlots, line === 0 ? 22 : 0,
    "only the first line of a repeated XDL entry pays the fixed XDL update");
}
assert.equal(state.xdl.address, 0x88, "repeat must not consume the next XDL entry early");
assert.equal(vbxe.nextXdlLine(state, 200), null,
  "AtMapOff + End must stop the XDL after the repeated field");
assert.equal(state.xdl.ended, true, "End terminates the XDL");
assert.equal(state.xdl.attributeMapEnabled, false, "AtMapOff clears the map before End");
assert.equal(state.xdl.address, 0x8a, "termination entry is fetched after the repeated field");
// A repeated XDL entry must refill the 43-cell line buffer after the
// attribute row counter wraps. Otherwise the first line of the next map row
// would keep rendering the previous row's cells.
const mapRepeatState = vbxe.createState("fx1.26");
mapRepeatState.videoControlPending = 1;
mapRepeatState.xdlAddressPending = 0x100;
mapRepeatState.vram.set([
  0x28, 0x02, 0x08, // AtMapOn + repeat, eight additional lines.
  0x00, 0x20, 0x00, // Attribute map address $02000.
  0x04, 0x00,       // Four-byte row stride.
], 0x100);
mapRepeatState.vram[0x2000] = 0x11;
mapRepeatState.vram[0x2004] = 0x22;
vbxe.verticalSync(mapRepeatState);
const firstMapRow = vbxe.nextXdlLine(mapRepeatState, 8);
assert.equal(vbxe.attributeMapCell(mapRepeatState, firstMapRow, 0).playfield0, 0x11);
for (let line = 1; line < 8; line++) vbxe.nextXdlLine(mapRepeatState, 8 + line);
const secondMapRow = vbxe.nextXdlLine(mapRepeatState, 16);
assert.equal(secondMapRow.attributeMapReload, true,
  "the wrapped repeated line refills the attribute-map buffer");
assert.equal(vbxe.attributeMapCell(mapRepeatState, secondMapRow, 0).playfield0, 0x22,
  "the wrapped line must use the next buffered map row");
// AHRM keeps the overlay and attribute-map address/stride latches across the
// next VSync restart. The visual XDL latches still return to their defaults,
// and a later entry can explicitly replace either address block.
state.xdlAddressPending = 0xa0;
state.vram.set([
  0x4a, 0x0e,
  0x00, 0x30, 0x00, 0x40, 0x00,
  0x00, 0x40, 0x00, 0xa0, 0x00,
  0x00, 0x00, 0x07, 0x07,
  0x04, 0xff,
], 0xa0);
vbxe.verticalSync(state);
const addressedLine = vbxe.nextXdlLine(state, 8);
assert.equal(addressedLine.address, 0x3000);
assert.equal(addressedLine.attributeAddress, 0x4000);
assert.equal(state.xdl.overlayAddress, 0x3040,
  "the overlay address advances after the first active line");

state.xdlAddressPending = 0xb0;
state.xdl.characterBase = 0x10000;
state.vram.set([0x0a, 0x00], 0xb0);
vbxe.verticalSync(state);
const carriedAddressLine = vbxe.nextXdlLine(state, 8);
assert.equal(carriedAddressLine.address, 0x3040,
  "VSync must preserve the overlay address counter");
assert.equal(carriedAddressLine.stride, 0x40,
  "VSync must preserve the overlay stride");
assert.equal(carriedAddressLine.attributeMapEnabled, true,
  "AtMapOn can reuse the carried map address at the new frame");
assert.equal(carriedAddressLine.attributeAddress, 0x4000,
  "VSync must preserve the attribute-map address counter");
assert.equal(carriedAddressLine.attributeStride, 0xa0,
  "VSync must preserve the attribute-map stride");
assert.equal(carriedAddressLine.overlayWidth, 1,
  "VSync still resets visual XDL parameters to defaults");
assert.equal(carriedAddressLine.characterBase, 0x10000,
  "the character-base latch remains available after VSync");
// XDLC_END takes effect after, rather than instead of, the terminating
// entry's repeat count. Altirra keeps the decoded mode active for both lines.
state.xdlAddressPending = 0x90;
state.vram.set([0x22, 0x80, 0x01], 0x90);
vbxe.verticalSync(state);
assert.equal(vbxe.nextXdlLine(state, 8).mode, "standard");
assert.equal(vbxe.nextXdlLine(state, 9).mode, "standard");
assert.equal(vbxe.nextXdlLine(state, 10), null,
  "End must stop only after the final repeated line");

// Warm reset stops presentation but preserves the address/stride latches used
// by the next XDL restart, matching Altirra WarmReset.
state.xdl.overlayAddress = 0x23450;
state.xdl.overlayStride = 0x120;
state.xdl.attributeAddress = 0x34560;
state.xdl.attributeStride = 0x1a0;
state.xdl.characterBase = 0x1c000;
vbxe.softReset(state);
assert.equal(state.xdl.overlayAddress, 0x23450);
assert.equal(state.xdl.overlayStride, 0x120);
assert.equal(state.xdl.attributeAddress, 0x34560);
assert.equal(state.xdl.attributeStride, 0x1a0);
assert.equal(state.xdl.characterBase, 0x1c000);
state.vram[0x1000] = 0x02;
state.palette.set([0x12, 0x34, 0x56], (256 + 2) * 3);
const video = {
  vbxeRgb: new Uint32Array(456 * 16),
  vbxeHiresRgb: new Uint32Array(672 * 16),
  vbxeHiresWidth: 672,
  pixels: new Uint8Array(456 * 16),
};
vbxe.renderXdlLine(state, video, 8, { mode: "standard", address: 0x1000 });
assert.equal(video.vbxeRgb[8 * 456 + 96], 0xff563412);
assert.equal(video.vbxeRgb[8 * 456 + 95], 0,
  "normal-width standard overlay begins at the hardware $30 boundary");
vbxe.renderXdlLine(state, video, 9, { mode: "lores", address: 0x1000 });
assert.equal(video.vbxeRgb[9 * 456 + 96], 0xff563412);
assert.equal(video.vbxeRgb[9 * 456 + 97], 0xff563412);
// OvMisc selects an alternate palette for the normal ANTIC/GTIA playfield
// even if an attribute map is not enabled. P/M winners remain GTIA colors.
state.palette.set([0x22, 0x44, 0x66], (3 * 256 + 0x2a) * 3);
video.pixels[13 * 456 + 96] = 0x2a;
video.priority = new Uint16Array(456 * 16);
vbxe.applyPlayfieldAttributes(state, video, 13, {
  overlayWidth: 1, playfieldPalette: 3,
});
assert.equal(video.vbxeRgb[13 * 456 + 96], 0xff664422);
video.vbxeRgb[13 * 456 + 97] = 0;
video.pixels[13 * 456 + 97] = 0x2a;
video.priority[13 * 456 + 97] = 0x10;
vbxe.applyPlayfieldAttributes(state, video, 13, {
  overlayWidth: 1, playfieldPalette: 3,
});
assert.equal(video.vbxeRgb[13 * 456 + 97], 0,
  "playfield-palette selection must not recolor a visible player");
state.vram[0x1000] = 0x02;
state.vram[0x10ff] = 0x02;
vbxe.renderXdlLine(state, video, 10, {
  mode: "standard", address: 0x1000, overlayWidth: 0,
});
assert.equal(video.vbxeRgb[10 * 456 + 127], 0,
  "narrow overlay leaves the normal-width margin untouched");
assert.equal(video.vbxeRgb[10 * 456 + 128], 0xff563412);
assert.equal(video.vbxeRgb[10 * 456 + 383], 0xff563412);
state.vram[0x114f] = 0x02;
vbxe.renderXdlLine(state, video, 11, {
  mode: "standard", address: 0x1000, overlayWidth: 2,
});
assert.equal(video.vbxeRgb[11 * 456 + 87], 0,
  "wide overlay begins at the VBXE $2C boundary");
assert.equal(video.vbxeRgb[11 * 456 + 88], 0xff563412);
assert.equal(video.vbxeRgb[11 * 456 + 423], 0xff563412);
state.vram[0x1010] = 0xa5;
state.vram[0x110f] = 0xa5;
state.palette.set([0x9a, 0xbc, 0xde], (256 + 0x0a) * 3);
state.palette.set([0x45, 0x67, 0x89], (256 + 0x05) * 3);
vbxe.renderXdlLine(state, video, 12, {
  mode: "hires", address: 0x1010, overlayWidth: 0,
});
const narrowHiresBase = 4 * 672 + 80;
assert.equal(video.vbxeHiresRgb[narrowHiresBase], 0xffdebc9a);
assert.equal(video.vbxeHiresRgb[narrowHiresBase + 511], 0xff896745);
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
state.videoControlActive = 0x05;
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
state.videoControlActive = 0x01;
state.vram[0x1021] = 2;
vbxe.renderXdlLine(state, video, 9, { mode: "text", address: 0x1020, characterBase: 0x1100, textRow: 0 });
assert.equal(video.vbxeHiresRgb[hiresBase], 0);
state.videoControlActive = 0x05;
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
state.videoControlActive = 0x05;
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
video.priority[9 * 456 + 96] = 0x01;
vbxe.applyPlayfieldAttributes(state, video, 9, {
  attributeMapEnabled: true, attributeAddress: 0x2020, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 8,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.equal(video.vbxeRgb[9 * 456 + 96], 0xffc3b2a1);
state.palette.set([0xd4, 0xe5, 0xf6], (3 * 256 + 0x34) * 3);
state.palette.set([0x07, 0x18, 0x29], (3 * 256 + 0x56) * 3);
video.vbxeRgb.fill(0);
video.priority.fill(0);
video.priority[9 * 456 + 96] = 0x02;
video.priority[9 * 456 + 97] = 0x04;
vbxe.applyPlayfieldAttributes(state, video, 9, {
  attributeMapEnabled: true, attributeAddress: 0x2020, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 8,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.equal(video.vbxeRgb[9 * 456 + 96], 0xfff6e5d4);
assert.equal(video.vbxeRgb[9 * 456 + 97], 0xff291807);
state.vram.set([0x13, 0x35, 0x57, 0xc0], 0x2030);
state.palette.set([0x7a, 0x8b, 0x9c], (3 * 256 + 0x13) * 3);
video.vbxeRgb.fill(0);
video.priority.fill(0);
video.priority[9 * 456 + 96] = 0x01;
state.videoControlActive = 0x07;
vbxe.applyPlayfieldAttributes(state, video, 9, {
  attributeMapEnabled: true, attributeAddress: 0x2030, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 8,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.equal(video.vbxeRgb[9 * 456 + 96], 0xff9c8b7a);
video.vbxeRgb[9 * 456 + 96] = 0xff010203;
vbxe.applyPlayfieldAttributes(state, video, 9, {
  attributeMapEnabled: true, attributeAddress: 0x2020, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 8,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.equal(video.vbxeRgb[9 * 456 + 96], 0xff010203);
// The attribute map follows the overlay's horizontal geometry even when the
// overlay is disabled. Exercise all three widths in both presentation planes.
const geometryState = vbxe.createState("fx1.26");
geometryState.videoControlActive = 0x07;
geometryState.priority[0] = 0x01;
geometryState.palette.set([0x11, 0x22, 0x33], 0x12 * 3);
for (let cell = 0; cell < 43; cell++) {
  geometryState.vram.set([0x12, 0x00, 0x00, 0x00], 0x3000 + cell * 4);
}
const geometryVideo = {
  vbxeRgb: new Uint32Array(456 * 16),
  vbxeHiresRgb: new Uint32Array(672 * 16),
  vbxeHiresWidth: 672,
  pixels: new Uint8Array(456 * 16),
  priority: new Uint16Array(456 * 16),
};
for (const geometry of [
  { overlayWidth: 0, start: 128, width: 256, nativeStart: 80 },
  { overlayWidth: 1, start: 96, width: 320, nativeStart: 16 },
  { overlayWidth: 2, start: 88, width: 336, nativeStart: 0 },
]) {
  geometryVideo.vbxeRgb.fill(0);
  geometryVideo.vbxeHiresRgb.fill(0);
  geometryVideo.priority.fill(0);
  const scanline = 9;
  const sourceStart = scanline * 456 + geometry.start;
  geometryVideo.priority.fill(0x01, sourceStart, sourceStart + geometry.width);
  vbxe.applyPlayfieldAttributes(geometryState, geometryVideo, scanline, {
    mode: "off", overlayWidth: geometry.overlayWidth,
    attributeMapEnabled: true, attributeAddress: 0x3000,
    attributeStride: 0, attributeScrollX: 0, attributeScrollY: 0,
    attributeCellWidth: 32, attributeCellHeight: 8, attributeRow: 0,
  });
  const legacyBase = scanline * 456 + geometry.start;
  assert.equal(geometryVideo.vbxeRgb[legacyBase], 0xff332211,
    "attribute map must start at the overlay boundary");
  assert.equal(geometryVideo.vbxeRgb[legacyBase + geometry.width - 1], 0xff332211,
    "attribute map must cover the selected overlay width");
  assert.equal(geometryVideo.vbxeRgb[legacyBase - 1], 0,
    "attribute map must not paint before the selected overlay boundary");
  assert.equal(geometryVideo.vbxeRgb[legacyBase + geometry.width], 0,
    "attribute map must not paint past the selected overlay width");
  const nativeBase = (scanline - 8) * 672 + geometry.nativeStart;
  assert.equal(geometryVideo.vbxeHiresRgb[nativeBase], 0xff332211,
    "native attribute map must share the overlay boundary");
  assert.equal(geometryVideo.vbxeHiresRgb[nativeBase + geometry.width * 2 - 1], 0xff332211,
    "native attribute map must cover two samples per standard pixel");
}
// GTIA register writes after the line starts are replayed as map spans. The
// first span uses the line-start PF3, while the later span uses the updated
// PF3 in both the legacy and native presentation planes.
const spanState = vbxe.createState("fx1.26");
spanState.videoControlActive = 0x07;
spanState.palette.set([0x11, 0x22, 0x33], 0x12 * 3);
spanState.palette.set([0x44, 0x55, 0x66], 0x34 * 3);
for (let cell = 0; cell < 43; cell++) {
  spanState.vram.set([0x80, 0x00, 0x00, 0x00], 0x3100 + cell * 4);
}
const spanVideo = {
  vbxeRgb: new Uint32Array(456 * 16),
  vbxeHiresRgb: new Uint32Array(672 * 16),
  vbxeHiresWidth: 672,
  pixels: new Uint8Array(456 * 16),
  priority: new Uint16Array(456 * 16),
};
spanVideo.priority.fill(0x04, 9 * 456 + 96, 9 * 456 + 416);
vbxe.applyGtiaSpans(spanState, spanVideo, 9, {
  mode: "off", overlayEnabled: false, overlayWidth: 1,
  attributeMapEnabled: true, attributeAddress: 0x3100,
  attributeStride: 0, attributeScrollX: 0, attributeScrollY: 0,
  attributeCellWidth: 8, attributeCellHeight: 8, attributeRow: 0,
  anticMode: 0x0f, anticPf3: 0x12, anticGtiaMode: 0,
}, {
  gtiaEventOverflow: false,
  gtiaEventCount: 1,
  gtiaInitialRegisters: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0x12, 0, 0]),
  gtiaEventRegisters: new Uint8Array([7]),
  gtiaEventValues: new Uint8Array([0x34]),
  gtiaEventCycles: new Uint8Array([30]),
});
assert.equal(spanVideo.vbxeRgb[9 * 456 + 96], 0xff332211,
  "map span before PF3 write must use the line-start color");
assert.equal(spanVideo.vbxeRgb[9 * 456 + 144], 0xff665544,
  "map span after PF3 write must use the updated color");
assert.equal(spanVideo.vbxeHiresRgb[1 * 672 + 16], 0xff332211,
  "native map span before PF3 write must use the line-start color");
assert.equal(spanVideo.vbxeHiresRgb[1 * 672 + 16 + 96], 0xff665544,
  "native map span after PF3 write must use the updated color");
// Replay also replaces the initial line's VBXE collision contribution. A
// mid-line PRIOR write into GTIA mode 10 must therefore change the collision
// group for the later span instead of leaving the first render's bit set.
const collisionSpanState = vbxe.createState("fx1.26");
collisionSpanState.videoControlActive = 0x07;
collisionSpanState.collisionMask = 0xff;
collisionSpanState.vram[0x3200] = 0x20;
const collisionSpanVideo = {
  vbxeRgb: new Uint32Array(456 * 16),
  vbxeHiresRgb: new Uint32Array(672 * 16),
  vbxeHiresWidth: 672,
  pixels: new Uint8Array(456 * 16),
  priority: new Uint16Array(456 * 16),
};
collisionSpanVideo.priority.fill(0x01, 9 * 456 + 96, 9 * 456 + 416);
const collisionSpanLine = {
  mode: "standard", overlayEnabled: true, address: 0x3200,
  overlayWidth: 1, overlayPalette: 1, priority: 0xff,
  anticGtiaMode: 0,
};
vbxe.renderXdlLine(collisionSpanState, collisionSpanVideo, 9, collisionSpanLine);
assert.equal(collisionSpanState.collisionDetect, 0x10,
  "the initial line render records the ordinary PF0 collision group");
vbxe.applyGtiaSpans(collisionSpanState, collisionSpanVideo, 9, collisionSpanLine, {
  gtiaEventOverflow: false,
  gtiaEventCount: 1,
  gtiaInitialRegisters: new Uint8Array(10),
  gtiaEventRegisters: new Uint8Array([9]),
  gtiaEventValues: new Uint8Array([0x80]),
  gtiaEventCycles: new Uint8Array([30]),
});
assert.equal(collisionSpanState.collisionDetect, 0x7f,
  "replayed GTIA mode 10 must replace the initial collision group");
// In ANTIC Graphics 8 (mode F), byte 0 is a PF3 bitmap rather than a PF0
// override. A set bit replaces a visible PF2 source; its palette remains the
// playfield palette selected by the cell.
state.vram.set([0x80, 0x00, 0x56, 0xc0], 0x2040);
state.palette.set([0x11, 0x22, 0x33], (3 * 256 + 0x56) * 3);
state.palette.set([0x44, 0x55, 0x66], (3 * 256 + 0x78) * 3);
video.vbxeRgb.fill(0);
video.priority.fill(0);
video.priority[9 * 456 + 96] = 0x04;
video.priority[9 * 456 + 97] = 0x04;
state.videoControlActive = 0x07;
vbxe.applyPlayfieldAttributes(state, video, 9, {
  anticMode: 0x0f, anticPf3: 0x78,
  attributeMapEnabled: true, attributeAddress: 0x2040, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 8,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.equal(video.vbxeRgb[9 * 456 + 96], 0xff665544);
assert.equal(video.vbxeRgb[9 * 456 + 97], 0xff332211);
// AHRM 12.4 defines the same PF3-mask byte for all ANTIC hires sources,
// including character modes 2 and 3, not only Graphics 8 / mode F.
video.vbxeRgb.fill(0);
video.priority.fill(0);
video.priority[9 * 456 + 96] = 0x04;
video.priority[9 * 456 + 97] = 0x04;
vbxe.applyPlayfieldAttributes(state, video, 9, {
  anticMode: 0x02, anticPf3: 0x78,
  attributeMapEnabled: true, attributeAddress: 0x2040, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 8,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.equal(video.vbxeRgb[9 * 456 + 96], 0xff665544,
  "mode-2 PF3 mask bit must replace PF2");
assert.equal(video.vbxeRgb[9 * 456 + 97], 0xff332211,
  "mode-2 cleared PF3 mask bit must retain PF2");
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
const reverseBase = 9 * 456 + 96;
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
// Tall hires character mode 3 supplies the same raw bit pairs. Its focused
// Altirra GTIA-9 differential has the same opaque palette-0 result.
video.vbxeRgb.fill(0);
vbxe.applyPlayfieldAttributes(state, video, 9, {
  anticMode: 0x03, anticGtiaMode: 1, anticPf3: 0x78,
  attributeMapEnabled: true, attributeAddress: 0x2050, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 32,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.deepEqual(Array.from(video.vbxeRgb.slice(reverseBase, reverseBase + 8)),
  [0xff000000, 0xff000000, 0xff000000, 0xff000000,
    0xff000000, 0xff000000, 0xff000000, 0xff000000]);
video.vbxeRgb.fill(0);
vbxe.applyPlayfieldAttributes(state, video, 9, {
  anticMode: 0x03, anticGtiaMode: 3, anticPf3: 0x78,
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
video.vbxeRgb.fill(0);
vbxe.applyPlayfieldAttributes(state, video, 9, {
  anticMode: 0x06, anticGtiaMode: 1,
  attributeMapEnabled: true, attributeAddress: 0x2060, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 32,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.deepEqual(Array.from(video.vbxeRgb.slice(reverseBase, reverseBase + 8)),
  new Array(8).fill(0xff000000),
  "validated GTIA-9 mode-6 Rev field is opaque palette color 0");
video.vbxeRgb.fill(0);
vbxe.applyPlayfieldAttributes(state, video, 9, {
  anticMode: 0x06, anticGtiaMode: 3,
  attributeMapEnabled: true, attributeAddress: 0x2060, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 32,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.deepEqual(Array.from(video.vbxeRgb.slice(reverseBase, reverseBase + 8)),
  new Array(8).fill(0xff000000),
  "validated GTIA-11 mode-6 Rev field is opaque palette color 0");
video.vbxeRgb.fill(0);
vbxe.applyPlayfieldAttributes(state, video, 9, {
  anticMode: 0x07, anticGtiaMode: 1,
  attributeMapEnabled: true, attributeAddress: 0x2060, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 32,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.deepEqual(Array.from(video.vbxeRgb.slice(reverseBase, reverseBase + 8)),
  new Array(8).fill(0xff000000),
  "validated GTIA-9 mode-7 Rev field is opaque palette color 0");
video.vbxeRgb.fill(0);
vbxe.applyPlayfieldAttributes(state, video, 9, {
  anticMode: 0x07, anticGtiaMode: 3,
  attributeMapEnabled: true, attributeAddress: 0x2060, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 32,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.deepEqual(Array.from(video.vbxeRgb.slice(reverseBase, reverseBase + 8)),
  new Array(8).fill(0xff000000),
  "validated GTIA-11 mode-7 Rev field is opaque palette color 0");
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
video.priority.fill(0x01, 9 * 456 + 96, 10 * 456 + 96);
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
video.priority.fill(0x01, 10 * 456 + 96, 11 * 456 + 96);
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
state.videoControlActive = 0x01;
state.vram[0x1000] = 0;
video.vbxeRgb[10 * 456 + 96] = 0x12345678;
vbxe.renderXdlLine(state, video, 10, { mode: "standard", address: 0x1000 });
assert.equal(video.vbxeRgb[10 * 456 + 96], 0);
video.vbxeRgb[10 * 456 + 96] = 0x12345678;
video.vbxeHiresRgb[2 * 672 + 16] = 0x12345678;
vbxe.renderXdlLine(state, video, 10, null);
assert.equal(video.vbxeRgb[10 * 456 + 96], 0,
  "disabling XDL must clear the legacy overlay plane for this scanline");
assert.equal(video.vbxeHiresRgb[2 * 672 + 16], 0,
  "disabling XDL must clear the attribute-map presentation plane for this scanline");
state.videoControlActive = 0x09;
state.vram[0x1000] = 0x2f;
video.vbxeRgb[10 * 456 + 96] = 0x12345678;
vbxe.renderXdlLine(state, video, 10, { mode: "standard", address: 0x1000 });
assert.equal(video.vbxeRgb[10 * 456 + 96], 0);
video.priority = new Uint16Array(456 * 16);
state.vram[0x1001] = 2;
video.priority[11 * 456 + 96] = 0x01;
vbxe.renderXdlLine(state, video, 11, { mode: "standard", address: 0x1001, priority: 0x00 });
assert.equal(video.vbxeRgb[11 * 456 + 96], 0);
vbxe.renderXdlLine(state, video, 11, { mode: "standard", address: 0x1001, priority: 0x10 });
assert.equal(video.vbxeRgb[11 * 456 + 96], 0xff563412);
// Before FX 1.26, $00 remains visible over the background and only PF2 and
// PF3/P5 are addressable by priority bits 6 and 7 (AHRM table 109).
assert.equal(vbxe.overlayWinsPriority("fx1.24", 0, 0x00), true);
assert.equal(vbxe.overlayWinsPriority("fx1.24", 0x0004, 0x00), false);
assert.equal(vbxe.overlayWinsPriority("fx1.24", 0x0004, 0x40), true);
assert.equal(vbxe.overlayWinsPriority("fx1.24", 0x0008, 0x40), false);
assert.equal(vbxe.overlayWinsPriority("fx1.24", 0x0008, 0x80), true);
assert.equal(vbxe.overlayWinsPriority("fx1.24", 0x0010, 0xff), false);
assert.equal(vbxe.overlayWinsPriority("fx1.26", 0, 0x00), false);

// Overlay collisions use the source-byte COLMASK groups and GTIA layer
// metadata. They do not depend on whether the XDL priority lets the overlay
// remain visible. The values below represent PF0, PF2, P1, and GTIA-mode-10
// P3 respectively.
assert.equal(vbxe.collisionBitsForPriority(0x0001 | 0x0004 | 0x0020 | 0x0800), 0x5a);
state.videoControlActive = 0x05;
state.collisionDetect = 0;
vbxe.access(state, 0xd649, 0x02); // $20-$3F source-byte group only.
state.vram[0x1002] = 0x22;
state.palette.set([0x12, 0x34, 0x56], (256 + 0x22) * 3);
video.priority[12 * 456 + 96] = 0x0001 | 0x0004 | 0x0020 | 0x0800;
vbxe.renderXdlLine(state, video, 12, { mode: "standard", address: 0x1002, priority: 0x00 });
assert.equal(video.vbxeRgb[12 * 456 + 96], 0);
assert.equal(vbxe.access(state, 0xd64a), 0x5a);
vbxe.access(state, 0xd64a, 0xff);
assert.equal(vbxe.access(state, 0xd64a), 0);
video.vbxeCollisionPriority = new Uint16Array(456 * 16);
video.priority[12 * 456 + 96] = 0x11; // PF0 plus an active, hidden P0.
video.vbxeCollisionPriority[12 * 456 + 96] = 0x8001; // PF0 alone contributes.
vbxe.renderXdlLine(state, video, 12, { mode: "standard", address: 0x1002, priority: 0x01 });
assert.equal(video.vbxeRgb[12 * 456 + 96], 0);
vbxe.renderXdlLine(state, video, 12, { mode: "standard", address: 0x1002, priority: 0x10 });
assert.equal(video.vbxeRgb[12 * 456 + 96], 0xff563412);
vbxe.renderXdlLine(state, video, 12, { mode: "standard", address: 0x1002 });
assert.equal(vbxe.access(state, 0xd64a), 0x10);
vbxe.access(state, 0xd64a, 0xff);
vbxe.access(state, 0xd649, 0x01);
vbxe.renderXdlLine(state, video, 12, { mode: "standard", address: 0x1002 });
assert.equal(vbxe.access(state, 0xd64a), 0);
// Altirra FX 1.26 identifies a text overlay collision by the cell attribute
// byte, not its character code or the fetched glyph byte.
state.videoControlActive = 0x05;
state.vram[0x1210] = 0x21;
state.vram[0x1211] = 0x41;
state.vram[0x1008] = 0xff;
video.priority.fill(0);
video.vbxeCollisionPriority.fill(0);
video.priority[12 * 456 + 96] = 0x40;
vbxe.access(state, 0xd649, 0x04); // $40-$5F: attribute $41.
vbxe.access(state, 0xd64a, 0xff);
vbxe.renderXdlLine(state, video, 12, {
  mode: "text", address: 0x1210, characterBase: 0x0f00, textRow: 0,
});
assert.notEqual(vbxe.access(state, 0xd64a), 0,
  "text attribute byte must select a collision range");
vbxe.access(state, 0xd649, 0x02); // $20-$3F: character $21.
vbxe.access(state, 0xd64a, 0xff);
vbxe.renderXdlLine(state, video, 12, {
  mode: "text", address: 0x1210, characterBase: 0x0f00, textRow: 0,
});
assert.equal(vbxe.access(state, 0xd64a), 0);
state.videoControlActive = 0x01; // Color zero transparent (D2 clear).
state.vram[0x1002] = 0;
vbxe.access(state, 0xd649, 0x01);
vbxe.renderXdlLine(state, video, 12, { mode: "standard", address: 0x1002 });
assert.equal(vbxe.access(state, 0xd64a), 0);
state.videoControlActive = 0x09; // Color 0 and 15 transparent (D2 clear, D3 set).
state.vram[0x1002] = 0xf5;
video.priority[12 * 456 + 96] = 0x0001;
vbxe.access(state, 0xd649, 0x20); // $A0-$BF source-byte group.
vbxe.renderXdlLine(state, video, 12, { mode: "hires", address: 0x1002 });
assert.equal(video.vbxeRgb[12 * 456 + 128], 0);
assert.equal(vbxe.access(state, 0xd64a), 0);
state.vram[0x1002] = 0x2f;
vbxe.access(state, 0xd649, 0x02); // $20-$3F source-byte group.
vbxe.renderXdlLine(state, video, 12, { mode: "standard", address: 0x1002 });
assert.equal(vbxe.access(state, 0xd64a), 0);
state.videoControlActive = 0x05;
state.vram[0x1002] = 0xa5;
vbxe.access(state, 0xd649, 0x20);
vbxe.renderXdlLine(state, video, 12, { mode: "hires", address: 0x1002 });
assert.equal(vbxe.access(state, 0xd64a), 0x10);

// GTIA 9/11's opaque palette-0 Reverse result is externally established for
// graphics C-E, plus every graphics mode 8-E in GTIA 9 and Graphics 8 in
// GTIA 11. The complete graphics 8-E source family is now externally
// validated for both GTIA 9 and 11.
// their Altirra observations are recorded.
state.vram.set([0x00, 0x00, 0x00, 0x04], 0x2070);
state.palette.set([0xaa, 0xbb, 0xcc], 0);
video.vbxeRgb.fill(0);
vbxe.applyPlayfieldAttributes(state, video, 9, {
  anticMode: 0x08, anticGtiaMode: 1,
  attributeMapEnabled: true, attributeAddress: 0x2070, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 32,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.equal(video.vbxeRgb[reverseBase], 0xffccbbaa,
  "validated GTIA-9 graphics 8 uses opaque palette color 0");
video.vbxeRgb.fill(0);
vbxe.applyPlayfieldAttributes(state, video, 9, {
  anticMode: 0x08, anticGtiaMode: 3,
  attributeMapEnabled: true, attributeAddress: 0x2070, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 32,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.equal(video.vbxeRgb[reverseBase], 0xffccbbaa,
  "validated GTIA-11 graphics 8 uses opaque palette color 0");
video.vbxeRgb.fill(0);
vbxe.applyPlayfieldAttributes(state, video, 9, {
  anticMode: 0x0a, anticGtiaMode: 3,
  attributeMapEnabled: true, attributeAddress: 0x2070, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 32,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.equal(video.vbxeRgb[reverseBase], 0xffccbbaa,
  "validated GTIA-11 graphics A uses opaque palette color 0");
video.vbxeRgb.fill(0);
vbxe.applyPlayfieldAttributes(state, video, 9, {
  anticMode: 0x0b, anticGtiaMode: 3,
  attributeMapEnabled: true, attributeAddress: 0x2070, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 32,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.equal(video.vbxeRgb[reverseBase], 0xffccbbaa,
  "validated GTIA-11 graphics B uses opaque palette color 0");
video.vbxeRgb.fill(0);
vbxe.applyPlayfieldAttributes(state, video, 9, {
  anticMode: 0x0a, anticGtiaMode: 1,
  attributeMapEnabled: true, attributeAddress: 0x2070, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 32,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.equal(video.vbxeRgb[reverseBase], 0xffccbbaa,
  "validated GTIA-9 graphics A uses opaque palette color 0");
video.vbxeRgb.fill(0);
vbxe.applyPlayfieldAttributes(state, video, 9, {
  anticMode: 0x0b, anticGtiaMode: 1,
  attributeMapEnabled: true, attributeAddress: 0x2070, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 32,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.equal(video.vbxeRgb[reverseBase], 0xffccbbaa,
  "validated GTIA-9 graphics B uses opaque palette color 0");
video.vbxeRgb.fill(0);
vbxe.applyPlayfieldAttributes(state, video, 9, {
  anticMode: 0x0c, anticGtiaMode: 1,
  attributeMapEnabled: true, attributeAddress: 0x2070, attributeStride: 0,
  attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 32,
  attributeCellHeight: 8, attributeRow: 0,
});
assert.equal(video.vbxeRgb[reverseBase], 0xffccbbaa,
  "validated GTIA-9 graphics C uses opaque palette color 0");

state.priority[0] = 0x5a;
state.blitCollisionCode = 0xa5;
state.collisionDetect = 0x3c;
state.xdlAddressPending = 0x61234;
state.xdlAddressActive = 0x51234;
state.memacBControl = 0xdf;
state.memacControl = 0x9f;
state.memacBankSelect = 0xe7;
state.configLatch = 0x07;
vbxe.softReset(state);
assert.equal(state.videoControlPending, 0);
assert.equal(state.xdlAddressPending, 0x61234);
assert.equal(state.xdlAddressActive, 0x51234);
assert.equal(state.collisionDetect, 0x3c);
assert.equal(state.memacBControl, 0x1f);
assert.equal(state.memacControl, 0x93);
assert.equal(state.memacBankSelect, 0x67);
assert.equal(state.blitCollisionCode, 0, "soft reset clears the blit collision code");
assert.equal(state.priority[0], 0x5a, "the configured priority latch survives reset");
assert.equal(state.configLatch, 0x07, "warm reset preserves configuration pins");
assert.equal(state.vram[0x1234], 0x5a);
vbxe.powerCycle(state);
assert.equal(state.xdlAddressPending, 0);
assert.equal(state.memacControl, 0);
assert.equal(state.collisionDetect, 0);
assert.equal(state.configLatch, 0, "cold reset clears configuration pins");
assert.equal(state.vram[0x1234], 0);

console.log("vbxe_device_state.test.js passed");
