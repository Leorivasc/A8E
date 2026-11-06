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
const sourcePath = path.join(rootDir, "implementation", "AHRM Validation", "VBXE_XDL_HIRES_TEST.asm");
const artifactPath = path.join(rootDir, "implementation", "AHRM Validation", "VBXE_XDL_HIRES_TEST.XEX");
const result = loadAssembler().assembleToXex(fs.readFileSync(sourcePath, "utf8"));
assert.ok(result.ok, "VBXE hires XDL diagnostic should assemble: " + (result.error || ""));
assert.ok(result.bytes.length > 8, "VBXE hires XDL diagnostic should produce an XEX payload");
assert.deepEqual(
  Buffer.from(result.bytes),
  fs.readFileSync(artifactPath),
  "checked-in VBXE hires XDL XEX should be reproducible from its source",
);
console.log("vbxe_xdl_hires_asm: all tests passed.");
