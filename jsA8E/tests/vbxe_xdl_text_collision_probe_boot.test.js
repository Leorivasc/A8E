/* global __dirname, console, process, require */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHeadlessAutomation } = require("../headless");

async function main() {
  const root = path.resolve(__dirname, "../..");
  const runtime = await createHeadlessAutomation({
    turbo: true,
    skipRendering: true,
    roms: {
      os: path.join(root, "A8E", "build", "ATARIXL.ROM"),
      basic: path.join(root, "A8E", "build", "ATARIBAS.ROM"),
    },
  });
  try {
    runtime.app.reset({ vbxe: "fx1.26" });
    let ctx = null;
    runtime.app.setMemoryAccessHook(function () {
      ctx = arguments[arguments.length - 1];
    });
    const source = fs.readFileSync(path.join(root, "implementation", "AHRM Validation",
      "VBXE_XDL_TEXT_COLLISION_PROBE.asm"), "utf8");
    const build = await runtime.api.dev.assembleSource({ name: "TXTCOLL.ASM", text: source });
    assert.ok(build.ok, build.error);
    await runtime.api.dev.writeHostFile("TXTCOLL.XEX", { bytes: build.bytes });
    await runtime.api.debug.setBreakpoints(build.symbols.READY);
    const launch = await runtime.api.dev.runXex({ hostFile: "TXTCOLL.XEX", awaitEntry: false });
    assert.ok(launch.ok, launch.phase);
    const hit = await runtime.api.debug.waitForBreakpoint({ timeoutMs: 30000 });
    assert.equal(hit.debugState.pc, build.symbols.READY,
      "text collision probe should reach READY");
    assert.ok(ctx, "text collision probe should expose its machine context");
    const results = Array.from(ctx.ram.slice(0x82, 0x85));
    assert.equal(results[0], 0, "character byte must not select text COLMASK");
    assert.notEqual(results[1], 0, "attribute byte must select text COLMASK");
    assert.equal(results[2], 0, "glyph byte must not select text COLMASK");
    console.log("vbxe_xdl_text_collision_probe_boot: attribute-byte collision verified.");
  } finally {
    await runtime.dispose();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
