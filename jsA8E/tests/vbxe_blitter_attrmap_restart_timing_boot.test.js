/* global __dirname, console, process, require */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHeadlessAutomation } = require("../headless");

async function main() {
  const root = path.resolve(__dirname, "../..");
  const runtime = await createHeadlessAutomation({
    turbo: true,
    skipRendering: true,
    roms: {
      os: path.join(root, "A8E", "build", "ATARIXL.ROM"),
      basic: path.join(root, "A8E", "build", "ATARIBAS.ROM"),
    },
  });

  try {
    runtime.app.reset({ vbxe: "fx1.26" });
    let ctx = null;
    runtime.app.setMemoryAccessHook(function () {
      ctx = arguments[arguments.length - 1];
    });
    const source = fs.readFileSync(path.join(root, "implementation", "AHRM Validation",
      "VBXE_BLITTER_ATTRMAP_RESTART_TIMING_TEST.asm"), "utf8");
    const build = await runtime.api.dev.assembleSource({ name: "BLITRMAP.ASM", text: source });
    assert.ok(build.ok, build.error);
    await runtime.api.dev.writeHostFile("BLITRMAP.XEX", { bytes: build.bytes });
    await runtime.api.debug.setBreakpoints(build.symbols.READY);
    const launch = await runtime.api.dev.runXex({ hostFile: "BLITRMAP.XEX", awaitEntry: false });
    assert.ok(launch.ok, launch.phase);
    await runtime.api.debug.waitForBreakpoint({ timeoutMs: 30000 });
    assert.ok(ctx, "XEX execution should expose its machine context");

    const state = ctx.ioData.vbxe;
    const vcount = ctx.ram[0x82];
    assert.equal(state.blitterBusy, 0, "the restart timing blit should finish before READY");
    assert.equal(state.irqStatus, 0, "the completion handler should acknowledge VBXE IRQ");
    assert.ok(vcount > 0 && vcount < 131,
      "restart probe must capture a non-wrapped NTSC VCOUNT, got " + vcount);
    console.log("vbxe_blitter_attrmap_restart_timing_boot: VCOUNT " + vcount + " captured without wrap.");
  } finally {
    await runtime.dispose();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
