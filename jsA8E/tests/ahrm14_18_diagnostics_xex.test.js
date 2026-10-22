/* global __dirname, require */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadAssembler() {
  const rootDir = path.resolve(__dirname, "..");
  const context = vm.createContext({});
  context.window = context;
  context.self = context;
  context.globalThis = context;
  for (const rel of [
    "js/core/cpu_tables.js",
    "js/core/assembler/shared.js",
    "js/core/assembler/lexer.js",
    "js/core/assembler/preprocessor.js",
    "js/core/assembler/parser.js",
    "js/core/assembler/object_writer.js",
    "js/core/assembler/assembler.js",
    "js/core/assembler_core.js",
  ]) {
    vm.runInContext(fs.readFileSync(path.join(rootDir, rel), "utf8"), context, {
      filename: rel,
    });
  }
  return context.A8EAssemblerCore;
}

const rootDir = path.resolve(__dirname, "../..");
const assembler = loadAssembler();
for (const name of [
  "AHRM14_PMG_DMA_EDGE_TEST",
  "AHRM15_CPU_DMA_CONTENTION_TEST",
  "AHRM16_PIA_CONSOL_INPUT_TEST",
  "AHRM17_VIDEO_TIMING_TEST",
  "AHRM18_POKEY_RANDOM_TIMER_TEST",
]) {
  const sourcePath = path.join(rootDir, "implementation", "AHRM", `${name}.asm`);
  const artifactPath = path.join(rootDir, "implementation", "AHRM", `${name}.XEX`);
  const result = assembler.assembleToXex(fs.readFileSync(sourcePath, "utf8"));
  assert.ok(result.ok, `${name} should assemble: ${result.error || ""}`);
  assert.deepEqual(
    Buffer.from(result.bytes),
    fs.readFileSync(artifactPath),
    `${name}.XEX should be reproducible from its source`,
  );
}

console.log("ahrm14_18_diagnostics_xex: all tests passed.");
