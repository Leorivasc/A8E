/* global __dirname, console, process, require */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHeadlessAutomation } = require("../headless");

async function main() {
  const root = path.resolve(__dirname, "../..");
  const romDir = path.join(root, "A8E", "build");
  const dactest = path.join(root, "build", "Altirra-4.40-bin", "DACTest (2009, KMK).xex");
  assert.ok(fs.existsSync(dactest), "DACTest XEX must be present for this compatibility test");
  const runtime = await createHeadlessAutomation({
    turbo: true,
    skipRendering: true,
    roms: { os: path.join(romDir, "ATARIXL.ROM"), basic: path.join(romDir, "ATARIBAS.ROM") },
  });
  try {
    runtime.app.reset({ vbxe: "fx1.26" });
    let ctx = null;
    runtime.app.setMemoryAccessHook(function () { ctx = arguments[arguments.length - 1]; });
    await runtime.api.dev.writeHostFile("DACTEST.XEX", { bytes: fs.readFileSync(dactest) });
    const launch = await runtime.api.dev.runXex({ hostFile: "DACTEST.XEX", awaitEntry: false });
    assert.ok(launch.ok, launch.phase);
    await runtime.api.system.waitForCycles({ count: 200000, timeoutMs: 30000 });
    await runtime.api.system.pause();
    assert.ok(ctx, "DACTest should execute on the machine");
    assert.ok(ctx.cycleCounter >= 200000, "DACTest boot must advance the machine clock");
    console.log("vbxe_dactest_boot: DACTest XEX executed with FX1.26 enabled.");
  } finally {
    await runtime.dispose();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
