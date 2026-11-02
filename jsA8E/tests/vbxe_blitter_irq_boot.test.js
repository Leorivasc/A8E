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
      "VBXE_BLITTER_IRQ_TEST.asm"), "utf8");
    const build = await runtime.api.dev.assembleSource({ name: "BLITIRQ.ASM", text: source });
    assert.ok(build.ok, build.error);
    await runtime.api.dev.writeHostFile("BLITIRQ.XEX", { bytes: build.bytes });
    await runtime.api.debug.setBreakpoints(build.symbols.READY);
    const launch = await runtime.api.dev.runXex({ hostFile: "BLITIRQ.XEX", awaitEntry: false });
    assert.ok(launch.ok, launch.phase);
    await runtime.api.debug.waitForBreakpoint({ timeoutMs: 30000 });
    assert.ok(ctx, "XEX execution should expose its machine context");

    const state = ctx.ioData.vbxe;
    assert.equal(state.blitterBusy, 0, "the IRQ probe blit should finish");
    assert.equal(ctx.ram[0x82], 1,
      "the enabled completion IRQ should enter the guest IRQ handler once");
    assert.equal(state.irqStatus, 0, "IRQ_CONTROL in the handler should acknowledge completion");
    for (let offset = 0; offset < 40 * 192; offset += 2) {
      assert.equal(state.vram[offset], 0,
        "IRQ result marker should clear each second Graphics 8 byte");
    }
    console.log("vbxe_blitter_irq_boot: CPU delivery and IRQ_CONTROL acknowledgement verified.");
  } finally {
    await runtime.dispose();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
