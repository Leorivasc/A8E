/* global __dirname, console, process, require */

"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { createHeadlessAutomation } = require("../headless");

async function main() {
  const root = path.resolve(__dirname, "../..");
  const romDir = path.join(root, "A8E", "build");
  const runtime = await createHeadlessAutomation({
    turbo: false,
    sioTurbo: false,
    skipRendering: true,
    memoryExpansion: "rambo-1088k",
    roms: {
      os: path.join(romDir, "ATARIXL.ROM"),
      basic: path.join(romDir, "ATARIBAS.ROM"),
    },
  });
  try {
    const build = await runtime.api.dev.assembleSource({
      name: "VBXE_SCENE_MARKER.ASM",
      text: [
        ".ORG $2000",
        "START:",
        "  LDA #$A5",
        "  STA $0600",
        "  LDA #$5A",
        "  STA $0601",
        "LOOP:",
        "  JMP LOOP",
        "  .RUN START",
      ].join("\n"),
    });
    assert.equal(build.ok, true, build.error);
    runtime.app.reset({ vbxe: "fx1.26", memoryExpansion: "rambo-1088k" });
    const launch = await runtime.api.dev.runXex({
      build,
      awaitEntry: false,
    });
    assert.equal(launch.ok, true, launch.phase);
    assert.equal(launch.xexPreflight.runAddress, build.symbols.START);
    const marker = await runtime.api.debug.waitForMemory({
      address: 0x0601,
      expected: 0x5a,
      timeoutMs: 5000,
    });
    assert.equal(marker.ok, true, "the XEX must execute its scene marker");
    console.log("vbxe_xex_scene_marker: direct XEX entry and RAM marker verified.");
  } finally {
    await runtime.dispose();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
