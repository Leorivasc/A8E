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
      "VBXE_BLITTER_TIMING_TEST.asm"), "utf8");
    const build = await runtime.api.dev.assembleSource({ name: "BLITTIME.ASM", text: source });
    assert.ok(build.ok, build.error);
    await runtime.api.dev.writeHostFile("BLITTIME.XEX", { bytes: build.bytes });
    await runtime.api.debug.setBreakpoints(build.symbols.READY);
    const launch = await runtime.api.dev.runXex({ hostFile: "BLITTIME.XEX", awaitEntry: false });
    assert.ok(launch.ok, launch.phase);
    await runtime.api.debug.waitForBreakpoint({ timeoutMs: 30000 });
    assert.ok(ctx, "XEX execution should expose its machine context");

    const state = ctx.ioData.vbxe;
    const rows = Math.min(192, ctx.ram[0x82]);
    assert.equal(state.blitterBusy, 0, "the timing probe blit should finish before READY");
    assert.equal(state.irqStatus, 0, "the timing IRQ handler should acknowledge completion");
    assert.ok(rows > 0, "a frame-synchronised probe should record a non-zero VCOUNT");
    for (let y = 0; y < 192; y++) {
      const expected = y < rows ? 0 : 0xff;
      for (let x = 0; x < 40; x++) {
        assert.equal(state.vram[y * 40 + x], expected,
          "timing marker byte at row " + y + ", column " + x);
      }
    }
    console.log("vbxe_blitter_timing_boot: completion IRQ VCOUNT marker verified.");
  } finally {
    await runtime.dispose();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
