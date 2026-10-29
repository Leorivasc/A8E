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
state.vram[0x1000] = 0x02;
state.palette.set([0x12, 0x34, 0x56], (256 + 2) * 3);
const video = { vbxeRgb: new Uint32Array(456 * 16) };
vbxe.renderXdlLine(state, video, 8, { mode: "standard", address: 0x1000 });
assert.equal(video.vbxeRgb[8 * 456 + 128], 0xff563412);
vbxe.renderXdlLine(state, video, 9, { mode: "lores", address: 0x1000 });
assert.equal(video.vbxeRgb[9 * 456 + 128], 0xff563412);
assert.equal(video.vbxeRgb[9 * 456 + 129], 0xff563412);
state.videoControlActive = 0x05;
state.vram[0x1000] = 0;
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

vbxe.softReset(state);
assert.equal(state.videoControlPending, 0);
assert.equal(state.memacControl, 0);
assert.equal(state.vram[0x1234], 0x5a);
vbxe.powerCycle(state);
assert.equal(state.vram[0x1234], 0);

console.log("vbxe_device_state.test.js passed");
