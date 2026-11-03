"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHeadlessAutomation } = require("../headless");

async function main() {
  const root = path.resolve(__dirname, "../..");
  const runtime = await createHeadlessAutomation({ turbo: true, skipRendering: true,
    roms: { os: path.join(root, "A8E/build/ATARIXL.ROM"), basic: path.join(root, "A8E/build/ATARIBAS.ROM") } });
  try {
    runtime.app.reset({ vbxe: "fx1.24" });
    let ctx = null;
    runtime.app.setMemoryAccessHook(function () { ctx = arguments[arguments.length - 1]; });
    const source = fs.readFileSync(path.join(root, "implementation", "AHRM Validation", "VBXE_FX124_PRIORITY_PROBE.asm"), "utf8");
    const build = await runtime.api.dev.assembleSource({ name: "FX124PRI.ASM", text: source });
    assert.ok(build.ok, build.error);
    await runtime.api.dev.writeHostFile("FX124PRI.XEX", { bytes: build.bytes });
    await runtime.api.debug.setBreakpoints(build.symbols.READY);
    const launch = await runtime.api.dev.runXex({ hostFile: "FX124PRI.XEX", awaitEntry: false });
    assert.ok(launch.ok, launch.phase);
    const hit = await runtime.api.debug.waitForBreakpoint({ timeoutMs: 30000 });
    assert.equal(hit.debugState.pc, build.symbols.READY);
    assert.ok(ctx);
    assert.deepEqual(Array.from(ctx.ram.slice(0x82, 0x84)), [0x10, 0x24]);
    await runtime.api.debug.setBreakpoints([]);
    await runtime.api.system.start();
    const run = await runtime.api.system.waitForCycles({ count: 500000, timeoutMs: 10000 });
    assert.ok(run.ok, "FX 1.24 priority probe should advance frames");
    await runtime.api.system.pause();
    const video = ctx.ioData.videoOut;
    const x = 128;
    assert.equal(video.vbxeRgb[16 * 456 + x], 0xff00ff00,
      "legacy $00 priority must win over the blank/background band");
    assert.equal(video.vbxeRgb[80 * 456 + x], 0,
      "legacy $00 priority must remain below PF2");
    assert.equal(video.vbxeRgb[144 * 456 + x], 0xff00ff00,
      "legacy bit 6 must win over PF2");
    console.log("vbxe_fx124_priority_probe_boot: revision $10/$24 verified.");
  } finally { await runtime.dispose(); }
}
main().catch(function (error) { console.error(error && error.stack ? error.stack : error); process.exitCode = 1; });
