/* global __dirname, console, process, require */

"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createHeadlessAutomation } = require("../headless");

async function main() {
  const root = path.resolve(__dirname, "../..");
  const romDir = path.join(root, "A8E", "build");
  const textmode = path.join(root, "build", "Altirra-4.40-bin", "Textmode Test (2009, KMK).xex");
  assert.ok(fs.existsSync(textmode), "Textmode Test XEX must be present for this compatibility test");
  for (const mode of ["1", "2", "3", "4"]) {
    const runtime = await createHeadlessAutomation({
      turbo: true,
      skipRendering: false,
      roms: { os: path.join(romDir, "ATARIXL.ROM"), basic: path.join(romDir, "ATARIBAS.ROM") },
    });
    try {
      runtime.app.reset({ vbxe: "fx1.26" });
      let ctx = null;
      runtime.app.setMemoryAccessHook(function () { ctx = arguments[arguments.length - 1]; });
      await runtime.api.dev.writeHostFile("TEXTMODE.XEX", { bytes: fs.readFileSync(textmode) });
      const launch = await runtime.api.dev.runXex({ hostFile: "TEXTMODE.XEX", awaitEntry: false });
      assert.ok(launch.ok, launch.phase);
      await runtime.api.system.waitForCycles({ count: 2000000, timeoutMs: 30000 });
      const menu = await runtime.api.captureScreenshot({ encoding: "bytes" });
      const keyBefore = ctx.ram[0xd209];
      await runtime.api.input.keyDown({ key: mode, code: "Digit" + mode });
      assert.notEqual(ctx.ram[0xd209], keyBefore, "Textmode Test mode " + mode + " key was not delivered");
      await runtime.api.system.waitForCycles({ count: 20000, timeoutMs: 30000 });
      await runtime.api.input.keyUp({ key: mode, code: "Digit" + mode });
      await runtime.api.system.waitForCycles({ count: 2000000, timeoutMs: 30000 });
      await runtime.api.system.pause();
      const selected = await runtime.api.captureScreenshot({ encoding: "bytes" });
      assert.ok(ctx, "Textmode Test should execute on the machine");
      assert.equal(ctx.ioData.vbxe.enabled, true, "Textmode Test requires active VBXE FX1.26");
      assert.ok(ctx.cycleCounter >= 4000000, "Textmode Test selection must advance the machine clock");
      assert.deepEqual([selected.width, selected.height], [menu.width, menu.height]);
      const menuDigest = crypto.createHash("sha256").update(Buffer.from(menu.bytes)).digest("hex");
      const selectedDigest = crypto.createHash("sha256").update(Buffer.from(selected.bytes)).digest("hex");
      assert.notEqual(selectedDigest, menuDigest, "Textmode Test mode " + mode + " did not change the rendered output");
    } finally {
      await runtime.dispose();
    }
  }
  console.log("vbxe_textmode_test_boot: all four Textmode Test modes executed with FX1.26.");
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
