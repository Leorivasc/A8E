/* global __dirname, console, process, require */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHeadlessAutomation } = require("../headless");

function rgbFromPalette(state, color) {
  const offset = (color & 0xff) * 3;
  return ((255 << 24) | (state.palette[offset + 2] << 16) |
    (state.palette[offset + 1] << 8) | state.palette[offset]) >>> 0;
}

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
    const source = fs.readFileSync(
      path.join(root, "implementation", "AHRM Validation",
        "VBXE_ATTRMAP_REVERSE_LORES_VERTICAL_PROBE.asm"),
      "utf8",
    );
    const build = await runtime.api.dev.assembleSource({
      name: "LORESREV.ASM",
      text: source,
    });
    assert.ok(build.ok, build.error);
    await runtime.api.dev.writeHostFile("LORESREV.XEX", { bytes: build.bytes });
    await runtime.api.debug.setBreakpoints(build.symbols.LOOP);
    const launch = await runtime.api.dev.runXex({
      hostFile: "LORESREV.XEX",
      awaitEntry: false,
    });
    assert.ok(launch.ok, launch.phase);
    await runtime.api.debug.waitForBreakpoint({ timeoutMs: 30000 });
    assert.ok(ctx, "XEX execution should expose its machine context");

    await runtime.api.debug.setBreakpoints([]);
    await runtime.api.system.start();
    const run = await runtime.api.system.waitForCycles({
      count: 500000,
      timeoutMs: 10000,
    });
    assert.ok(run.ok, "lores reverse diagnostic should advance frames");
    await runtime.api.system.pause();

    const state = ctx.ioData.vbxe;
    const video = ctx.ioData.videoOut;
    const pf2 = rgbFromPalette(state, 0x26);
    const pf2WithPf1Luma = rgbFromPalette(state, 0x24);
    for (let y = 8; y < 200; y++) {
      const sourceValue = Math.floor(((y - 8) & 0x7f) / 32) & 3;
      const base = y * 456 + 128;
      for (let x = 0; x < 256; x++) {
        const bit = (x & 1) === 0 ? (sourceValue >>> 1) & 1 : sourceValue & 1;
        assert.equal(
          video.vbxeRgb[base + x],
          bit ? pf2WithPf1Luma : pf2,
          "lores Rev pixel at line " + y + ", x " + x,
        );
      }
    }
    console.log("vbxe_attrmap_reverse_lores_boot: 192-line D/E Rev field verified.");
  } finally {
    await runtime.dispose();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
