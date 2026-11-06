/* global __dirname, console, process, require */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadAssembler(root) {
  const context = { window: null, self: null, globalThis: null };
  context.window = context;
  context.self = context;
  context.globalThis = context;
  vm.createContext(context);
  const files = ["cpu_tables.js", "assembler/shared.js", "assembler/lexer.js",
    "assembler/preprocessor.js", "assembler/parser.js", "assembler/object_writer.js",
    "assembler/assembler.js", "assembler_core.js"];
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(root, "jsA8E", "js", "core", file), "utf8"), context);
  }
  return context.A8EAssemblerCore;
}

function main() {
  const root = path.resolve(__dirname, "../..");
  const sourcePath = path.join(root, "implementation", "AHRM Validation",
    "VBXE_BLITTER_OVERLAY_TIMING_TEST.asm");
  const source = fs.readFileSync(sourcePath, "utf8");
  const build = loadAssembler(root).assembleToXex(source);
  assert.ok(build.ok, build.error);
  assert.deepEqual(Array.from(fs.readFileSync(sourcePath.replace(/\.asm$/, ".XEX"))),
    Array.from(build.bytes), "checked-in XEX must be reproducible from its source");
  console.log("vbxe_blitter_overlay_timing_asm.test.js passed");
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
