/* global console, Uint8Array, Uint16Array, Uint32Array, Int16Array, Number, Math, Object */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { createHeadlessAutomation } = require("../headless");

function testVideoStandardMatrix() {
  const sourcePath = path.join(__dirname, "..", "js", "core", "hw.js");
  const expected = {
    pal: { lines: 312, cpuHz: 1773447, vcount: 0x01 },
    ntsc: { lines: 262, cpuHz: 1789773, vcount: 0x0f },
  };
  for (const standard of ["pal", "ntsc"]) {
    // hw.js intentionally keeps one API instance, so each machine standard
    // gets an isolated context in this matrix.
    const context = {
      console: console,
      Uint8Array: Uint8Array,
      Uint16Array: Uint16Array,
      Uint32Array: Uint32Array,
      Int16Array: Int16Array,
      Number: Number,
      Math: Math,
      Object: Object,
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(sourcePath, "utf8"), context, {
      filename: sourcePath,
    });
    const hw = context.A8EHw.createApi({ videoStandard: standard });
    assert.equal(hw.VIDEO_STANDARD, standard);
    assert.equal(hw.LINES_PER_SCREEN_PAL, expected[standard].lines);
    assert.equal(hw.ATARI_CPU_HZ_PAL, expected[standard].cpuHz);
    const palDetect = hw.IO_INIT_VALUES.find(function (entry) {
      return entry.addr === hw.IO_COLPM2_PAL;
    });
    assert.equal(palDetect.read, expected[standard].vcount);
  }
}

async function testMemoryProfileMatrix() {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const buildDir = path.join(repoRoot, "A8E", "build");
  const romDir = fs.existsSync(path.join(repoRoot, "ATARIXL.ROM"))
    ? repoRoot
    : buildDir;
  const expected = [
    ["none", false, 0],
    ["130xe-128k", true, 4],
    ["rambo-192k", true, 8],
    ["rambo-320k", true, 16],
    ["compy-320k", true, 16],
    ["rambo-576k", true, 32],
    ["compy-576k", true, 32],
    ["rambo-1088k", true, 64],
    ["ultimate1mb", true, 64],
  ];

  for (const [profile, enabled, bankCount] of expected) {
    const runtime = await createHeadlessAutomation({
      roms: {
        os: path.join(romDir, "ATARIXL.ROM"),
        basic: path.join(romDir, "ATARIBAS.ROM"),
      },
      memoryExpansion: profile,
      skipRendering: true,
      frameDelayMs: 0,
    });
    try {
      await runtime.api.whenReady();
      const state = await runtime.api.getBankState();
      assert.equal(state.memoryExpansion.profile, profile);
      assert.equal(state.memoryExpansion.enabled, enabled);
      assert.equal(state.memoryExpansion.bankCount, bankCount);
    } finally {
      await runtime.dispose();
    }
  }
}

(async function () {
  testVideoStandardMatrix();
  await testMemoryProfileMatrix();
  console.log("ahrm_machine_matrix.test.js passed");
})().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
