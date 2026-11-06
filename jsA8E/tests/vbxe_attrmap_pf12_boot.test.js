/* global __dirname, console, process, require */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHeadlessAutomation } = require("../headless");

async function main() {
  const root = path.resolve(__dirname, "../..");
  const romDir = path.join(root, "A8E", "build");
  const runtime = await createHeadlessAutomation({
    turbo: true,
    skipRendering: true,
    roms: {
      os: path.join(romDir, "ATARIXL.ROM"),
      basic: path.join(romDir, "ATARIBAS.ROM"),
    },
  });

  try {
    runtime.app.reset({ vbxe: "fx1.26" });
    let ctx = null;
    runtime.app.setMemoryAccessHook(function () {
      ctx = arguments[arguments.length - 1];
    });
    const api = runtime.api;
    const source = fs.readFileSync(
      path.join(root, "implementation", "AHRM Validation", "VBXE_ATTRMAP_PF12_TEST.asm"),
      "utf8",
    );
    const build = await api.dev.assembleSource({ name: "PF12.ASM", text: source });
    assert.ok(build.ok, build.error);
    await api.dev.writeHostFile("PF12.XEX", { bytes: build.bytes });
    await api.debug.setBreakpoints(build.symbols.LOOP);
    const launch = await api.dev.runXex({ hostFile: "PF12.XEX", awaitEntry: false });
    assert.ok(launch.ok, launch.phase);
    await api.debug.waitForBreakpoint({ timeoutMs: 30000 });
    assert.ok(ctx, "XEX execution should expose its machine context");

    const displayList = ctx.ram.slice(0x3000, 0x30c5);
    assert.equal(
      displayList.filter(function (byte) { return byte === 0x0f; }).length,
      191,
      "the mode-F display list must contain all 191 non-LMS rows",
    );
    assert.deepEqual(Array.from(displayList.slice(0x0c2, 0x0c5)), [0x41, 0x00, 0x30]);

    await api.debug.setBreakpoints([]);
    await api.system.start();
    const run = await api.system.waitForCycles({ count: 500000, timeoutMs: 10000 });
    assert.ok(run.ok, "mode-F diagnostic should advance frames");
    await api.system.pause();

    const video = ctx.ioData.videoOut;
    for (let y = 8; y < 200; y++) {
      let colored = 0;
      for (let x = 96; x < 416; x++) {
        if (video.vbxeRgb[y * 456 + x] !== 0) colored++;
      }
      assert.equal(colored, 320, "attribute map should cover mode-F line " + y);
    }
    console.log("vbxe_attrmap_pf12_boot: 192-line PF1/PF2 field verified.");
  } finally {
    await runtime.dispose();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
