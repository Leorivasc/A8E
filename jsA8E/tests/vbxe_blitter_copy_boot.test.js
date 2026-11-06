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
    const source = fs.readFileSync(path.join(root, "implementation", "AHRM Validation",
      "VBXE_BLITTER_COPY_TEST.asm"), "utf8");
    const build = await runtime.api.dev.assembleSource({ name: "BLITCOPY.ASM", text: source });
    assert.ok(build.ok, build.error);
    await runtime.api.dev.writeHostFile("BLITCOPY.XEX", { bytes: build.bytes });
    await runtime.api.debug.setBreakpoints(build.symbols.READY);
    const launch = await runtime.api.dev.runXex({ hostFile: "BLITCOPY.XEX", awaitEntry: false });
    assert.ok(launch.ok, launch.phase);
    await runtime.api.debug.waitForBreakpoint({ timeoutMs: 30000 });
    assert.ok(ctx, "XEX execution should expose its machine context");

    const state = ctx.ioData.vbxe;
    assert.equal(state.blitterBusy, 0, "the Graphics 8 blit should finish before READY");
    for (let offset = 0; offset < 40 * 192; offset++) {
      assert.equal(state.vram[offset], 0xff, "copied Graphics 8 byte at local $" +
        offset.toString(16));
    }
    console.log("vbxe_blitter_copy_boot: scheduled 40x192 mode-0 VRAM copy verified.");
  } finally {
    await runtime.dispose();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
