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
      path.join(root, "implementation", "AHRM Validation",
        "VBXE_ATTRMAP_REVERSE_LORES_CHAR_TEST.asm"),
      "utf8",
    );
    const build = await api.dev.assembleSource({ name: "REVERSELORESCHAR.ASM", text: source });
    assert.ok(build.ok, build.error);
    await api.dev.writeHostFile("REVERSELORESCHAR.XEX", { bytes: build.bytes });
    await api.debug.setBreakpoints(build.symbols.LOOP);
    const launch = await api.dev.runXex({ hostFile: "REVERSELORESCHAR.XEX", awaitEntry: false });
    assert.ok(launch.ok, launch.phase);
    await api.debug.waitForBreakpoint({ timeoutMs: 30000 });
    assert.ok(ctx, "XEX execution should expose its machine context");

    await api.debug.setBreakpoints([]);
    await api.system.start();
    const run = await api.system.waitForCycles({ count: 500000, timeoutMs: 10000 });
    assert.ok(run.ok, "lores character reverse diagnostic should advance frames");
    await api.system.pause();

    const expected = [
      0xff00fe00, 0xff00fe00, 0xff00fe00, 0xfffe0000,
      0xfffe0000, 0xff00fe00, 0xfffe0000, 0xfffe0000,
    ];
    const video = ctx.ioData.videoOut;
    for (let y = 8; y < 200; y++) {
      const base = y * 456 + 128;
      assert.deepEqual(Array.from(video.vbxeRgb.slice(base, base + 8)), expected,
        "mode-4 lores reverse pattern at line " + y);
    }

    // The GTIA-10 mode-4 differential is deliberately separate from the
    // ordinary lores rule: raw pairs 00/01 form nibble 1 and select map PF0;
    // the following 10/11 pair forms $B and is palette color 0.
    runtime.app.reset({ vbxe: "fx1.26" });
    ctx = null;
    const specialBuild = await api.dev.assembleSource({
      name: "REVERSELORESM10.ASM",
      text: source.replace(".define GTIA_MODE $00", ".define GTIA_MODE $80"),
    });
    assert.ok(specialBuild.ok, specialBuild.error);
    await api.dev.writeHostFile("REVERSELORESM10.XEX", { bytes: specialBuild.bytes });
    await api.debug.setBreakpoints(specialBuild.symbols.LOOP);
    const specialLaunch = await api.dev.runXex({ hostFile: "REVERSELORESM10.XEX", awaitEntry: false });
    assert.ok(specialLaunch.ok, specialLaunch.phase);
    await api.debug.waitForBreakpoint({ timeoutMs: 30000 });
    assert.ok(ctx, "GTIA-mode-10 lores diagnostic should expose its machine context");
    await api.debug.setBreakpoints([]);
    await api.system.start();
    const specialRun = await api.system.waitForCycles({ count: 500000, timeoutMs: 10000 });
    assert.ok(specialRun.ok, "GTIA-mode-10 lores reverse diagnostic should advance frames");
    await api.system.pause();

    const specialVideo = ctx.ioData.videoOut;
    const width = specialVideo.vbxeHiresWidth | 0;
    const offset = (width - 640) >> 1;
    const specialExpected = [
      0xff2c00ae, 0xff2c00ae, 0xff2c00ae, 0xff2c00ae,
      0xff2c00ae, 0xff2c00ae, 0xff2c00ae, 0xff2c00ae,
      0xff000000, 0xff000000, 0xff000000, 0xff000000,
      0xff000000, 0xff000000, 0xff000000, 0xff000000,
    ];
    for (let y = 0; y < 192; y++) {
      const base = y * width + offset;
      assert.deepEqual(
        Array.from(specialVideo.vbxeHiresRgb.slice(base, base + 16)),
        specialExpected,
        "mode-4 GTIA-10 Rev PF0/color-0 sequence at line " + (y + 8),
      );
    }

    runtime.app.reset({ vbxe: "fx1.26" });
    ctx = null;
    const tallBuild = await api.dev.assembleSource({
      name: "REVERSELORESM10TALL.ASM",
      text: source
        .replace(".define GTIA_MODE $00", ".define GTIA_MODE $80")
        .replace(".define ANTIC_MODE $04", ".define ANTIC_MODE $05")
        .replace(".define DISPLAY_ROWS 24", ".define DISPLAY_ROWS 12"),
    });
    assert.ok(tallBuild.ok, tallBuild.error);
    await api.dev.writeHostFile("REVERSELORESM10TALL.XEX", { bytes: tallBuild.bytes });
    await api.debug.setBreakpoints(tallBuild.symbols.LOOP);
    const tallLaunch = await api.dev.runXex({ hostFile: "REVERSELORESM10TALL.XEX", awaitEntry: false });
    assert.ok(tallLaunch.ok, tallLaunch.phase);
    await api.debug.waitForBreakpoint({ timeoutMs: 30000 });
    assert.ok(ctx, "tall GTIA-mode-10 lores diagnostic should expose its machine context");
    await api.debug.setBreakpoints([]);
    await api.system.start();
    const tallRun = await api.system.waitForCycles({ count: 500000, timeoutMs: 10000 });
    assert.ok(tallRun.ok, "tall GTIA-mode-10 lores reverse diagnostic should advance frames");
    await api.system.pause();

    const tallVideo = ctx.ioData.videoOut;
    const tallWidth = tallVideo.vbxeHiresWidth | 0;
    const tallOffset = (tallWidth - 640) >> 1;
    for (let y = 0; y < 192; y++) {
      const base = y * tallWidth + tallOffset;
      assert.deepEqual(
        Array.from(tallVideo.vbxeHiresRgb.slice(base, base + 16)),
        specialExpected,
        "mode-5 GTIA-10 Rev PF0/color-0 sequence at line " + (y + 8),
      );
    }

    runtime.app.reset({ vbxe: "fx1.26" });
    ctx = null;
    const mode6Build = await api.dev.assembleSource({
      name: "REVERSEMODE6M10.ASM",
      text: source
        .replace(".define GTIA_MODE $00", ".define GTIA_MODE $80")
        .replace(".define ANTIC_MODE $04", ".define ANTIC_MODE $06"),
    });
    assert.ok(mode6Build.ok, mode6Build.error);
    await api.dev.writeHostFile("REVERSEMODE6M10.XEX", { bytes: mode6Build.bytes });
    await api.debug.setBreakpoints(mode6Build.symbols.LOOP);
    const mode6Launch = await api.dev.runXex({ hostFile: "REVERSEMODE6M10.XEX", awaitEntry: false });
    assert.ok(mode6Launch.ok, mode6Launch.phase);
    await api.debug.waitForBreakpoint({ timeoutMs: 30000 });
    assert.ok(ctx, "mode-6 GTIA-mode-10 diagnostic should expose its machine context");
    await api.debug.setBreakpoints([]);
    await api.system.start();
    const mode6Run = await api.system.waitForCycles({ count: 500000, timeoutMs: 10000 });
    assert.ok(mode6Run.ok, "mode-6 GTIA-mode-10 reverse diagnostic should advance frames");
    await api.system.pause();
    const mode6Video = ctx.ioData.videoOut;
    const mode6Width = mode6Video.vbxeHiresWidth | 0;
    const mode6Offset = (mode6Width - 640) >> 1;
    for (let y = 0; y < 192; y++) {
      const base = y * mode6Width + mode6Offset;
      assert.deepEqual(
        Array.from(mode6Video.vbxeHiresRgb.slice(base, base + 16)),
        new Array(16).fill(0xff000000),
        "mode-6 GTIA-10 Rev opaque field at line " + (y + 8),
      );
    }

    for (const [name, gtiaMode] of [["GTIA mode 9", "$40"], ["GTIA mode 11", "$c0"]]) {
      runtime.app.reset({ vbxe: "fx1.26" });
      ctx = null;
      const opaqueBuild = await api.dev.assembleSource({
        name: "REVERSELORES.ASM",
        text: source.replace(".define GTIA_MODE $00", ".define GTIA_MODE " + gtiaMode),
      });
      assert.ok(opaqueBuild.ok, opaqueBuild.error);
      await api.dev.writeHostFile("REVERSELORES.XEX", { bytes: opaqueBuild.bytes });
      await api.debug.setBreakpoints(opaqueBuild.symbols.LOOP);
      const opaqueLaunch = await api.dev.runXex({ hostFile: "REVERSELORES.XEX", awaitEntry: false });
      assert.ok(opaqueLaunch.ok, opaqueLaunch.phase);
      await api.debug.waitForBreakpoint({ timeoutMs: 30000 });
      assert.ok(ctx, name + " lores diagnostic should expose its machine context");
      await api.debug.setBreakpoints([]);
      await api.system.start();
      const opaqueRun = await api.system.waitForCycles({ count: 500000, timeoutMs: 10000 });
      assert.ok(opaqueRun.ok, name + " lores reverse diagnostic should advance frames");
      await api.system.pause();

      const opaqueVideo = ctx.ioData.videoOut;
      const opaqueWidth = opaqueVideo.vbxeHiresWidth | 0;
      const opaqueOffset = (opaqueWidth - 640) >> 1;
      for (let y = 0; y < 192; y++) {
        const base = y * opaqueWidth + opaqueOffset;
        assert.deepEqual(
          Array.from(opaqueVideo.vbxeHiresRgb.slice(base, base + 16)),
          new Array(16).fill(0xff000000),
          name + " mode-4 Rev opaque field at line " + (y + 8),
        );
      }
    }
    console.log("vbxe_attrmap_reverse_lores_char_boot: normal and GTIA-mode-9/10/11 mode-4, GTIA-mode-10 mode-5, and GTIA-mode-10 mode-6 Rev fields verified.");
  } finally {
    await runtime.dispose();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
