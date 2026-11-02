/* global __dirname, console, process, require */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHeadlessAutomation } = require("../headless");

async function main() {
  const root = path.resolve(__dirname, "../..");
  const romDir = path.join(root, "A8E", "build");
  const popeye = path.join(root, "build", "Altirra-4.40-bin", "popeye.xex");
  assert.ok(fs.existsSync(popeye), "Popeye VBXE XEX must be present for this compatibility test");
  const runtime = await createHeadlessAutomation({
    turbo: true,
    skipRendering: true,
    roms: { os: path.join(romDir, "ATARIXL.ROM"), basic: path.join(romDir, "ATARIBAS.ROM") },
  });
  try {
    runtime.app.reset({ vbxe: "fx1.26" });
    let ctx = null;
    runtime.app.setMemoryAccessHook(function () { ctx = arguments[arguments.length - 1]; });
    await runtime.api.dev.writeHostFile("POPEYE.XEX", { bytes: fs.readFileSync(popeye) });
    const launch = await runtime.api.dev.runXex({ hostFile: "POPEYE.XEX", awaitEntry: false });
    assert.ok(launch.ok, launch.phase);
    await runtime.api.system.waitForCycles({ count: 200000, timeoutMs: 30000 });
    await runtime.api.system.pause();
    assert.ok(ctx, "Popeye should execute on the machine");
    assert.equal(ctx.ioData.vbxe.enabled, true, "Popeye requires active VBXE FX1.26");
    assert.ok(ctx.cycleCounter >= 200000, "Popeye boot must advance the machine clock");
    console.log("vbxe_popeye_boot: Popeye VBXE XEX executed with FX1.26.");
  } finally {
    await runtime.dispose();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
