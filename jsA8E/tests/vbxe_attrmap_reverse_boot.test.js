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
      path.join(root, "implementation", "AHRM Validation", "VBXE_ATTRMAP_REVERSE_TEST.asm"),
      "utf8",
    );
    const expected = [
      0xff0000ff, 0xff0000ff, 0xffff0000, 0xffff0000,
      0xff00ff00, 0xff00ff00, 0xffff00ff, 0xffff00ff,
    ];
    for (const [name, gtiaMode, expectedLine] of [
      ["normal", "$00", expected],
      ["GTIA mode 9", "$40", new Array(8).fill(0xff000000)],
      ["GTIA mode 10", "$80", new Array(8).fill(0xff000000)],
      ["GTIA mode 11", "$c0", new Array(8).fill(0xff000000)],
    ]) {
      ctx = null;
      runtime.app.reset({ vbxe: "fx1.26" });
      const build = await api.dev.assembleSource({
        name: "REVERSE.ASM",
        text: source.replace(".define GTIA_MODE $00", ".define GTIA_MODE " + gtiaMode),
      });
      assert.ok(build.ok, build.error);
      await api.dev.writeHostFile("REVERSE.XEX", { bytes: build.bytes });
      await api.debug.setBreakpoints(build.symbols.LOOP);
      const launch = await api.dev.runXex({ hostFile: "REVERSE.XEX", awaitEntry: false });
      assert.ok(launch.ok, launch.phase);
      await api.debug.waitForBreakpoint({ timeoutMs: 30000 });
      assert.ok(ctx, name + " XEX execution should expose its machine context");

      await api.debug.setBreakpoints([]);
      await api.system.start();
      const run = await api.system.waitForCycles({ count: 500000, timeoutMs: 10000 });
      assert.ok(run.ok, name + " reverse diagnostic should advance frames");
      await api.system.pause();

      const video = ctx.ioData.videoOut;
      for (let y = 8; y < 200; y++) {
        const base = y * 456 + 96;
        assert.deepEqual(Array.from(video.vbxeRgb.slice(base, base + 8)), expectedLine,
          name + " Rev output at line " + y);
      }
    }
    console.log("vbxe_attrmap_reverse_boot: normal and GTIA-mode-9/10/11 192-line Rev fields verified.");
  } finally {
    await runtime.dispose();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
