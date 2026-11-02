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
        "VBXE_ATTRMAP_REVERSE_CHAR_TEST.asm"),
      "utf8",
    );
    const build = await api.dev.assembleSource({ name: "REVERSECHAR.ASM", text: source });
    assert.ok(build.ok, build.error);
    await api.dev.writeHostFile("REVERSECHAR.XEX", { bytes: build.bytes });
    await api.debug.setBreakpoints(build.symbols.LOOP);
    const launch = await api.dev.runXex({ hostFile: "REVERSECHAR.XEX", awaitEntry: false });
    assert.ok(launch.ok, launch.phase);
    await api.debug.waitForBreakpoint({ timeoutMs: 30000 });
    assert.ok(ctx, "XEX execution should expose its machine context");

    await api.debug.setBreakpoints([]);
    await api.system.start();
    const run = await api.system.waitForCycles({ count: 500000, timeoutMs: 10000 });
    assert.ok(run.ok, "character reverse diagnostic should advance frames");
    await api.system.pause();

    const expected = [
      0xff0000ff, 0xff0000ff, 0xffff0000, 0xffff0000,
      0xff00ff00, 0xff00ff00, 0xffff00ff, 0xffff00ff,
    ];
    const video = ctx.ioData.videoOut;
    for (let y = 8; y < 200; y++) {
      const base = y * 456 + 128;
      assert.deepEqual(Array.from(video.vbxeRgb.slice(base, base + 8)), expected,
        "mode-2 reverse PF0-PF3 pattern at line " + y);
    }
    console.log("vbxe_attrmap_reverse_char_boot: 192-line mode-2 Rev field verified.");
  } finally {
    await runtime.dispose();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
