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

for (const page of [0xd640, 0xd740]) {
  const state = vbxe.createState({ profile: "fx1.26", page: page });
  const at = (offset, value) => vbxe.access(state, page + offset, value);
  const read = (offset) => vbxe.access(state, page + offset);
  const configAt = (value) => vbxe.access(state, (page & 0xff00) | 0x00c0, value);
  const configRead = () => vbxe.access(state, (page & 0xff00) | 0x00c0);

  assert.equal(read(0x00), 0x10, "core revision readback at " + page.toString(16));
  assert.equal(read(0x01), 0x26, "minor revision readback at " + page.toString(16));
  assert.equal(read(0x09), 0xff, "COLMASK remains write-only at " + page.toString(16));
  assert.equal(read(0x0a), 0, "COLDETECT starts clear at " + page.toString(16));
  assert.equal(read(0x14), 0, "IRQ status starts clear at " + page.toString(16));
  assert.equal(read(0x1d), 0xff, "MEMAC B remains write-only at " + page.toString(16));

  at(0x00, 0xff);
  at(0x01, 0x34);
  at(0x02, 0x12);
  at(0x03, 0x07);
  assert.equal(state.videoControlPending, 0x0f, "VIDEO_CONTROL ignores upper bits");
  assert.equal(state.xdlAddressPending, 0x71234, "XDL address keeps only 19 bits");
  assert.equal(read(0x00), 0x10, "CORE_REVISION readback is unaffected by VIDEO_CONTROL writes");
  assert.equal(read(0x01), 0x26, "MINOR_REVISION readback is unaffected by XDL writes");
  vbxe.verticalSync(state);
  assert.equal(state.videoControlActive, 0x0f, "VIDEO_CONTROL latches at VSync");
  assert.equal(state.xdlAddressActive, 0x71234, "XDL address latches at VSync");

  at(0x1d, 0xc5);
  at(0x1e, 0x9f);
  at(0x1f, 0xe7);
  assert.equal(read(0x1e), 0x9f, "MEMAC A readback preserves programmed bits");
  assert.equal(read(0x1f), 0xe7, "MEMAC A bank readback preserves programmed bits");
  assert.equal(vbxe.memacAddress(state, 0x9000, false), 0x60000,
    "MEMAC A CPU mapping is active on both register pages");
  assert.equal(vbxe.memacAddress(state, 0x9000, true), 0x60000,
    "MEMAC A ANTIC mapping is active on both register pages");

  configAt(0xff);
  assert.equal(configRead(), 0x07, "configuration latch keeps only three input pins");
  const restored = vbxe.restoreState(Object.assign(vbxe.cloneState(state), {
    configLatch: 0xff,
  }));
  assert.equal(restored.configLatch, 0x07,
    "restoring a snapshot sanitizes impossible configuration-pin bits");
}

// A snapshot must preserve the in-flight XDL decoder and blitter, not just
// their programmed start addresses.
const active = vbxe.createState({ profile: "fx1.26", page: 0xd740 });
active.videoControlPending = 0x01;
active.xdlAddressPending = 0x100;
active.vram.set([0x62, 0x08, 0x00, 0x00, 0x10, 0x00, 0x40, 0x01], 0x100);
vbxe.verticalSync(active);
const activeLine = vbxe.nextXdlLine(active, 8);
assert.equal(activeLine.mode, "standard");
assert.equal(active.xdlSlots, 22, "snapshot fixture must capture the fixed XDL update cost");
active.vram.set(new Uint8Array(21), 0x200);
active.vram[0x20f] = 0xff;
vbxe.access(active, 0xd750, 0x00);
vbxe.access(active, 0xd751, 0x02);
vbxe.access(active, 0xd752, 0x00);
vbxe.access(active, 0xd753, 0x01);
assert.equal(active.blitterBusy, 0x01, "snapshot fixture must capture BCB loading");
active.memacSlots = 17;
active.collisionDetect = 0x52;
const snapshot = vbxe.cloneState(active);
const resumed = vbxe.restoreState(snapshot);
assert.equal(resumed.page, 0xd740);
assert.equal(resumed.xdl.overlayAddress, active.xdl.overlayAddress);
assert.equal(resumed.xdlAddressActive, active.xdlAddressActive);
assert.equal(resumed.xdlSlots, 22);
assert.equal(resumed.blitterBusy, active.blitterBusy);
assert.equal(resumed.blitter.blockAddress, active.blitter.blockAddress);
assert.equal(resumed.memacSlots, 17);
assert.equal(resumed.collisionDetect, 0x52);
assert.equal(resumed.vram[0x100], 0x62);

console.log("vbxe_register_snapshot: register edges, reset banks, MEMAC, XDL, and blitter snapshots verified.");
