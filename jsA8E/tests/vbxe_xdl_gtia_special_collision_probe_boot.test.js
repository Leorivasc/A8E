/* global __dirname, console, process, require */
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
    runtime.app.reset({ vbxe: "fx1.26" });
    let ctx = null;
    runtime.app.setMemoryAccessHook(function () { ctx = arguments[arguments.length - 1]; });
    const source = fs.readFileSync(path.join(root, "implementation", "AHRM Validation", "VBXE_XDL_GTIA_SPECIAL_COLLISION_PROBE.asm"), "utf8");
    const build = await runtime.api.dev.assembleSource({ name: "GTIASPC.ASM", text: source });
    assert.ok(build.ok, build.error);
    await runtime.api.dev.writeHostFile("GTIASPC.XEX", { bytes: build.bytes });
    await runtime.api.debug.setBreakpoints(build.symbols.READY);
    const launch = await runtime.api.dev.runXex({ hostFile: "GTIASPC.XEX", awaitEntry: false });
    assert.ok(launch.ok, launch.phase);
    const hit = await runtime.api.debug.waitForBreakpoint({ timeoutMs: 30000 });
    assert.equal(hit.debugState.pc, build.symbols.READY);
    assert.ok(ctx);
    const results = Array.from(ctx.ram.slice(0x82, 0x88));
    assert.deepEqual(results, [0x03, 0x7f, 0x03, 0x40, 0x7f, 0x40],
      "GTIA-special final-input collision groups must match Altirra");
    console.log("vbxe_xdl_gtia_special_collision_probe_boot: " +
      "P0+P1=$03,$7F,$03 P5=$40,$7F,$40.");
  } finally { await runtime.dispose(); }
}
main().catch(function (error) { console.error(error && error.stack ? error.stack : error); process.exitCode = 1; });
