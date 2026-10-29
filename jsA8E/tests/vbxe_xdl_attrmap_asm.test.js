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
for (const diagnostic of [
  ["VBXE_XDL_ATTRMAP_TEST.asm", ["VBXE_XDL_ATTRMAP_TEST.XEX", "VBXE_XDL_ATTRMAP_V2_TEST.XEX"]],
  ["VBXE_XDL_ATTRMAP_VERTICAL_TEST.asm", ["VBXE_XDL_ATTRMAP_VERTICAL_TEST.XEX"]],
  ["VBXE_XDL_ATTRMAP_SCROLL_TEST.asm", ["VBXE_XDL_ATTRMAP_SCROLL_TEST.XEX"]],
  ["VBXE_XDL_ATTRMAP_OVERSCROLL_TEST.asm", ["VBXE_XDL_ATTRMAP_OVERSCROLL_TEST.XEX", "VBXE_XDL_ATTRMAP_OVERSCROLL12_TEST.XEX"]],
]) {
  const result = loadAssembler().assembleToXex(fs.readFileSync(
    path.join(rootDir, "implementation", "AHRM Validation", diagnostic[0]), "utf8"));
  assert.ok(result.ok, diagnostic[0] + " should assemble: " + (result.error || ""));
  for (const artifact of diagnostic[1]) {
    assert.deepEqual(
      Buffer.from(result.bytes),
      fs.readFileSync(path.join(rootDir, "implementation", "AHRM Validation", artifact)),
      "checked-in " + artifact + " should be reproducible from its source",
    );
  }
}
console.log("vbxe_xdl_attrmap_asm: all tests passed.");
