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
      path.join(root, "implementation", "AHRM Validation", "VBXE_ATTRMAP_PF3_TEST.asm"),
      "utf8",
    );
    const build = await api.dev.assembleSource({ name: "PF3.ASM", text: source });
    assert.ok(build.ok, build.error);
    await api.dev.writeHostFile("PF3.XEX", { bytes: build.bytes });
    await api.debug.setBreakpoints(build.symbols.LOOP);
    const launch = await api.dev.runXex({ hostFile: "PF3.XEX", awaitEntry: false });
    assert.ok(launch.ok, launch.phase);
    await api.debug.waitForBreakpoint({ timeoutMs: 30000 });
    assert.ok(ctx, "XEX execution should expose its machine context");

    await api.debug.setBreakpoints([]);
    await api.system.start();
    const run = await api.system.waitForCycles({ count: 500000, timeoutMs: 10000 });
    assert.ok(run.ok, "PF3-mask diagnostic should advance frames");
    await api.system.pause();

    const video = ctx.ioData.videoOut;
    for (let y = 8; y < 200; y++) {
      const base = y * 456 + 128;
      assert.equal(video.vbxeRgb[base], 0xff00fe00,
        "PF3 mask bit 7 at line " + y + ": got 0x" + video.vbxeRgb[base].toString(16));
      assert.equal(video.vbxeRgb[base + 1], 0xfffe0000,
        "PF2 bit 6 at line " + y + ": got 0x" + video.vbxeRgb[base + 1].toString(16));
    }
    console.log("vbxe_attrmap_pf3_boot: 192-line PF3/PF2 mask field verified.");
  } finally {
    await runtime.dispose();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
