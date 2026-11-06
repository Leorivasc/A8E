/* global __dirname, console, process, require */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHeadlessAutomation } = require("../headless");

const SOFTWARE = [
  { label: "Celeste", file: "celeste1.3.xex" },
  { label: "D600 demo", file: "demoD600.xex" },
  { label: "Falcon", file: "falcon1.xex" },
  { label: "Phoenix", file: "phoenix-vbxe.xex" },
];

async function runSoftware(root, entry) {
  const romDir = path.join(root, "A8E", "build");
  const image = path.join(root, "build", "Altirra-4.40-bin", entry.file);
  assert.ok(fs.existsSync(image), entry.label + " XEX must be present for this compatibility test");
  const runtime = await createHeadlessAutomation({
    turbo: true,
    skipRendering: true,
    roms: { os: path.join(romDir, "ATARIXL.ROM"), basic: path.join(romDir, "ATARIBAS.ROM") },
  });
  try {
    runtime.app.reset({ vbxe: "fx1.26" });
    let ctx = null;
    runtime.app.setMemoryAccessHook(function () { ctx = arguments[arguments.length - 1]; });
    await runtime.api.dev.writeHostFile(entry.file, { bytes: fs.readFileSync(image) });
    const launch = await runtime.api.dev.runXex({ hostFile: entry.file, awaitEntry: false });
    assert.ok(launch.ok, entry.label + " failed to launch: " + launch.phase);
    await runtime.api.system.waitForCycles({ count: 400000, timeoutMs: 30000 });
    await runtime.api.system.pause();
    assert.ok(ctx, entry.label + " should execute on the machine");
    assert.equal(ctx.ioData.vbxe.enabled, true, entry.label + " requires active VBXE FX1.26");
    assert.ok(ctx.cycleCounter >= 400000, entry.label + " boot must advance the machine clock");
  } finally {
    await runtime.dispose();
  }
}

async function main() {
  const root = path.resolve(__dirname, "../..");
  for (const entry of SOFTWARE) {
    await runSoftware(root, entry);
  }
  console.log("vbxe_additional_software_boot: Celeste, D600 demo, Falcon, and Phoenix executed with FX1.26.");
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
