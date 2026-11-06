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

    runtime.app.reset({ vbxe: "fx1.26" });
    ctx = null;
    const modeCBuild = await runtime.api.dev.assembleSource({
      name: "LORESREVCM10.ASM",
      text: source
        .replace("LDA #$4E", "LDA #$4C")
        .replace("LDA #$0E", "LDA #$0C")
        .replace(" STA PRIOR", " LDA #$80\n STA PRIOR"),
    });
    assert.ok(modeCBuild.ok, modeCBuild.error);
    await runtime.api.dev.writeHostFile("LORESREVCM10.XEX", { bytes: modeCBuild.bytes });
    await runtime.api.debug.setBreakpoints(modeCBuild.symbols.LOOP);
    const modeCLaunch = await runtime.api.dev.runXex({
      hostFile: "LORESREVCM10.XEX",
      awaitEntry: false,
    });
    assert.ok(modeCLaunch.ok, modeCLaunch.phase);
    await runtime.api.debug.waitForBreakpoint({ timeoutMs: 30000 });
    assert.ok(ctx, "mode-C GTIA-mode-10 probe should expose its machine context");
    await runtime.api.debug.setBreakpoints([]);
    await runtime.api.system.start();
    const modeCRun = await runtime.api.system.waitForCycles({
      count: 500000,
      timeoutMs: 10000,
    });
    assert.ok(modeCRun.ok, "mode-C GTIA-mode-10 probe should advance frames");
    await runtime.api.system.pause();
    const modeCVideo = ctx.ioData.videoOut;
    for (let y = 8; y < 200; y++) {
      const base = y * 456 + 128;
      for (let x = 0; x < 256; x++) {
        assert.equal(modeCVideo.vbxeRgb[base + x], 0xff000000,
          "mode-C GTIA-10 Rev opaque pixel at line " + y + ", x " + x);
      }
    }

    // The external FX 1.26 mode-E/GTIA-10 probe makes every valid raw lores
    // source opaque palette color 0. This is separate from the mode-4/5
    // nibble path and is deliberately limited to graphics modes D/E.
    runtime.app.reset({ vbxe: "fx1.26" });
    ctx = null;
    const specialBuild = await runtime.api.dev.assembleSource({
      name: "LORESREVM10.ASM",
      text: source.replace(" STA PRIOR", " LDA #$80\n STA PRIOR"),
    });
    assert.ok(specialBuild.ok, specialBuild.error);
    await runtime.api.dev.writeHostFile("LORESREVM10.XEX", { bytes: specialBuild.bytes });
    await runtime.api.debug.setBreakpoints(specialBuild.symbols.LOOP);
    const specialLaunch = await runtime.api.dev.runXex({
      hostFile: "LORESREVM10.XEX",
      awaitEntry: false,
    });
    assert.ok(specialLaunch.ok, specialLaunch.phase);
    await runtime.api.debug.waitForBreakpoint({ timeoutMs: 30000 });
    assert.ok(ctx, "GTIA-mode-10 lores probe should expose its machine context");
    await runtime.api.debug.setBreakpoints([]);
    await runtime.api.system.start();
    const specialRun = await runtime.api.system.waitForCycles({
      count: 500000,
      timeoutMs: 10000,
    });
    assert.ok(specialRun.ok, "GTIA-mode-10 lores probe should advance frames");
    await runtime.api.system.pause();
    const specialVideo = ctx.ioData.videoOut;
    for (let y = 8; y < 200; y++) {
      const base = y * 456 + 128;
      for (let x = 0; x < 256; x++) {
        assert.equal(specialVideo.vbxeRgb[base + x], 0xff000000,
          "mode-E GTIA-10 Rev opaque pixel at line " + y + ", x " + x);
      }
    }

    runtime.app.reset({ vbxe: "fx1.26" });
    ctx = null;
    const modeDBuild = await runtime.api.dev.assembleSource({
      name: "LORESREVDM10.ASM",
      text: source
        .replace("LDA #$4E", "LDA #$4D")
        .replace("LDA #$0E", "LDA #$0D")
        .replace("LDX #191", "LDX #95")
        .replace("STA $30C2", "STA $3062")
        .replace("STA $30C3", "STA $3063")
        .replace("STA $30C4", "STA $3064")
        .replace(" STA PRIOR", " LDA #$80\n STA PRIOR"),
    });
    assert.ok(modeDBuild.ok, modeDBuild.error);
    await runtime.api.dev.writeHostFile("LORESREVDM10.XEX", { bytes: modeDBuild.bytes });
    await runtime.api.debug.setBreakpoints(modeDBuild.symbols.LOOP);
    const modeDLaunch = await runtime.api.dev.runXex({
      hostFile: "LORESREVDM10.XEX",
      awaitEntry: false,
    });
    assert.ok(modeDLaunch.ok, modeDLaunch.phase);
    await runtime.api.debug.waitForBreakpoint({ timeoutMs: 30000 });
    assert.ok(ctx, "mode-D GTIA-mode-10 probe should expose its machine context");
    await runtime.api.debug.setBreakpoints([]);
    await runtime.api.system.start();
    const modeDRun = await runtime.api.system.waitForCycles({
      count: 500000,
      timeoutMs: 10000,
    });
    assert.ok(modeDRun.ok, "mode-D GTIA-mode-10 probe should advance frames");
    await runtime.api.system.pause();
    const modeDVideo = ctx.ioData.videoOut;
    for (let y = 8; y < 200; y++) {
      const base = y * 456 + 128;
      for (let x = 0; x < 256; x++) {
        assert.equal(modeDVideo.vbxeRgb[base + x], 0xff000000,
          "mode-D GTIA-10 Rev opaque pixel at line " + y + ", x " + x);
      }
    }
    runtime.app.reset({ vbxe: "fx1.26" });
    ctx = null;
    const modeBBuild = await runtime.api.dev.assembleSource({
      name: "LORESREVBM10.ASM",
      text: source
        .replace("LDA #$4E", "LDA #$4B")
        .replace("LDA #$0E", "LDA #$0B")
        .replace("LDX #191", "LDX #95")
        .replace("STA $30C2", "STA $3062")
        .replace("STA $30C3", "STA $3063")
        .replace("STA $30C4", "STA $3064")
        .replace(" STA PRIOR", " LDA #$80\n STA PRIOR"),
    });
    assert.ok(modeBBuild.ok, modeBBuild.error);
    await runtime.api.dev.writeHostFile("LORESREVBM10.XEX", { bytes: modeBBuild.bytes });
    await runtime.api.debug.setBreakpoints(modeBBuild.symbols.LOOP);
    const modeBLaunch = await runtime.api.dev.runXex({
      hostFile: "LORESREVBM10.XEX",
      awaitEntry: false,
    });
    assert.ok(modeBLaunch.ok, modeBLaunch.phase);
    await runtime.api.debug.waitForBreakpoint({ timeoutMs: 30000 });
    assert.ok(ctx, "mode-B GTIA-mode-10 probe should expose its machine context");
    await runtime.api.debug.setBreakpoints([]);
    await runtime.api.system.start();
    const modeBRun = await runtime.api.system.waitForCycles({ count: 500000, timeoutMs: 10000 });
    assert.ok(modeBRun.ok, "mode-B GTIA-mode-10 probe should advance frames");
    await runtime.api.system.pause();
    const modeBVideo = ctx.ioData.videoOut;
    for (let y = 8; y < 200; y++) {
      const base = y * 456 + 128;
      for (let x = 0; x < 256; x++) {
        assert.equal(modeBVideo.vbxeRgb[base + x], 0xff000000,
          "mode-B GTIA-10 Rev opaque pixel at line " + y + ", x " + x);
      }
    }
    console.log("vbxe_attrmap_reverse_lores_boot: normal D/E and GTIA-10 mode-B/C/D/E Rev fields verified.");
  } finally {
    await runtime.dispose();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
