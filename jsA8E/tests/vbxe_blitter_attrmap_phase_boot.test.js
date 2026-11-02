/* global __dirname, console, process, require */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHeadlessAutomation } = require("../headless");

function loadAssembler(root) {
  const context = vm.createContext({});
  context.window = context;
  context.self = context;
  context.globalThis = context;
  for (const rel of ["js/core/cpu_tables.js", "js/core/assembler/shared.js",
    "js/core/assembler/lexer.js", "js/core/assembler/preprocessor.js",
    "js/core/assembler/parser.js", "js/core/assembler/object_writer.js",
    "js/core/assembler/assembler.js", "js/core/assembler_core.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), "utf8"), context);
  }
  return context.A8EAssemblerCore;
}

async function main() {
  const root = path.resolve(__dirname, "../..");
  const sourceDir = path.join(root, "implementation", "AHRM Validation");
  const assembler = loadAssembler(path.join(root, "jsA8E"));
  const runtime = await createHeadlessAutomation({
    turbo: true,
    skipRendering: true,
    roms: {
      os: path.join(root, "A8E", "build", "ATARIXL.ROM"),
      basic: path.join(root, "A8E", "build", "ATARIBAS.ROM"),
    },
  });

  try {
    for (const name of ["VBXE_BLITTER_ATTRMAP_PHASE_CONTINUOUS_TEST",
      "VBXE_BLITTER_ATTRMAP_PHASE_RESTART_TEST"]) {
      const build = assembler.assembleToXex(fs.readFileSync(path.join(sourceDir, name + ".asm"), "utf8"), {
        sourceName: name + ".asm",
        includeResolver: function (includeName) {
          return fs.readFileSync(path.join(sourceDir, includeName), "utf8");
        },
      });
      assert.ok(build.ok, build.error);
      runtime.app.reset({ vbxe: "fx1.26" });
      let ctx = null;
      runtime.app.setMemoryAccessHook(function () {
        ctx = arguments[arguments.length - 1];
      });
      await runtime.api.system.start();
      await runtime.api.system.waitForCycles({ count: 100, timeoutMs: 2000 });
      await runtime.api.system.pause();
      assert.ok(ctx, "headless runtime should expose its machine context");
      ctx.ioData.vbxe.vram.fill(0xa5);
      await runtime.api.dev.writeHostFile(name + ".XEX", { bytes: build.bytes });
      await runtime.api.debug.setBreakpoints(build.symbols.READY);
      const launch = await runtime.api.dev.runXex({ hostFile: name + ".XEX", awaitEntry: false });
      assert.ok(launch.ok, launch.phase);
      await runtime.api.debug.waitForBreakpoint({ timeoutMs: 30000 });
      assert.ok(ctx, "phase probe should expose its machine context");

      const vram = ctx.ioData.vbxe.vram;
      assert.equal(ctx.ram[0x86], 1, name + " should complete its first frame-synchronised blit");
      assert.equal(ctx.ram[0x84], 1, name + " should observe blitter idle through polling");
      assert.equal(ctx.ram[0x83], 1, name + " should latch its completion IRQ for the DLI marker");
      const displayBytes = vram.slice(0, 30 * 256);
      const firstDisplayDifference = displayBytes.findIndex(function (value) { return value !== 0xff; });
      assert.equal(firstDisplayDifference, -1,
        name + " should initialise its complete Graphics-8 source; first difference at " +
        firstDisplayDifference + " is $" + (firstDisplayDifference < 0 ? "ff" :
          displayBytes[firstDisplayDifference].toString(16).padStart(2, "0")));
      assert.ok(vram.slice(0x22000, 0x23000).every(function (value) { return value === 0; }),
        name + " should initialise every attribute-map byte reachable by its 24 rows");
    }
    console.log("vbxe_blitter_attrmap_phase_boot: phase-pair VRAM initialisation verified.");
  } finally {
    await runtime.dispose();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
