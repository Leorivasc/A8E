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
function assembleDiagnostic(name) {
  const directory = path.join(rootDir, "implementation", "AHRM Validation");
  const sourcePath = path.join(directory, name);
  return loadAssembler().assembleToXex(fs.readFileSync(sourcePath, "utf8"), {
    sourceName: name,
    includeResolver: function (includePath) {
      return fs.readFileSync(path.join(directory, includePath), "utf8");
    },
  });
}
for (const diagnostic of [
  ["ANTIC_MODE9_BASELINE_TEST.asm", ["ANTIC_MODE9_BASELINE_TEST.XEX"]],
  ["VBXE_XDL_ATTRMAP_TEST.asm", ["VBXE_XDL_ATTRMAP_TEST.XEX", "VBXE_XDL_ATTRMAP_V2_TEST.XEX"]],
  ["VBXE_XDL_ATTRMAP_VERTICAL_TEST.asm", ["VBXE_XDL_ATTRMAP_VERTICAL_TEST.XEX"]],
  ["VBXE_XDL_ATTRMAP_SCROLL_TEST.asm", ["VBXE_XDL_ATTRMAP_SCROLL_TEST.XEX"]],
  ["VBXE_XDL_ATTRMAP_OVERSCROLL_TEST.asm", ["VBXE_XDL_ATTRMAP_OVERSCROLL_TEST.XEX", "VBXE_XDL_ATTRMAP_OVERSCROLL12_TEST.XEX"]],
  ["VBXE_ATTRMAP_PF0_TEST.asm", ["VBXE_ATTRMAP_PF0_TEST.XEX", "VBXE_ATTRMAP_PF0_V2_TEST.XEX", "VBXE_ATTRMAP_PF0_V3_TEST.XEX", "VBXE_ATTRMAP_PF0_V4_TEST.XEX"]],
  ["VBXE_ATTRMAP_PF12_TEST.asm", ["VBXE_ATTRMAP_PF12_TEST.XEX"]],
  ["VBXE_ATTRMAP_PF3_TEST.asm", ["VBXE_ATTRMAP_PF3_TEST.XEX"]],
  ["VBXE_ATTRMAP_REVERSE_TEST.asm", ["VBXE_ATTRMAP_REVERSE_TEST.XEX"]],
  ["VBXE_ATTRMAP_REVERSE_CHAR_TEST.asm", ["VBXE_ATTRMAP_REVERSE_CHAR_TEST.XEX"]],
  ["VBXE_ATTRMAP_REVERSE_CHAR_GTIA9_TEST.asm", ["VBXE_ATTRMAP_REVERSE_CHAR_GTIA9_TEST.XEX"]],
  ["VBXE_ATTRMAP_REVERSE_CHAR_GTIA10_TEST.asm", ["VBXE_ATTRMAP_REVERSE_CHAR_GTIA10_TEST.XEX"]],
  ["VBXE_ATTRMAP_REVERSE_CHAR_GTIA11_TEST.asm", ["VBXE_ATTRMAP_REVERSE_CHAR_GTIA11_TEST.XEX"]],
  ["VBXE_ATTRMAP_REVERSE_CHAR3_GTIA10_TEST.asm", ["VBXE_ATTRMAP_REVERSE_CHAR3_GTIA10_TEST.XEX"]],
  ["VBXE_ATTRMAP_REVERSE_GTIA9_TEST.asm", ["VBXE_ATTRMAP_REVERSE_GTIA9_TEST.XEX"]],
  ["GTIA_MODE9_BASELINE_TEST.asm", ["GTIA_MODE9_BASELINE_TEST.XEX"]],
  ["GTIA_MODE10_BASELINE_TEST.asm", ["GTIA_MODE10_BASELINE_TEST.XEX"]],
  ["VBXE_ATTRMAP_REVERSE_GTIA10_TEST.asm", ["VBXE_ATTRMAP_REVERSE_GTIA10_TEST.XEX"]],
  ["GTIA_MODE11_BASELINE_TEST.asm", ["GTIA_MODE11_BASELINE_TEST.XEX"]],
  ["VBXE_ATTRMAP_REVERSE_GTIA11_TEST.asm", ["VBXE_ATTRMAP_REVERSE_GTIA11_TEST.XEX"]],
  ["VBXE_ATTRMAP_REVERSE_LORES_PROBE.asm", ["VBXE_ATTRMAP_REVERSE_LORES_PROBE.XEX"]],
  ["VBXE_ATTRMAP_REVERSE_LORES_CHAR_TEST.asm", ["VBXE_ATTRMAP_REVERSE_LORES_CHAR_TEST.XEX"]],
  ["VBXE_ATTRMAP_REVERSE_LORES_CHAR_GTIA9_TEST.asm", ["VBXE_ATTRMAP_REVERSE_LORES_CHAR_GTIA9_TEST.XEX"]],
  ["VBXE_ATTRMAP_REVERSE_LORES_CHAR_GTIA10_TEST.asm", ["VBXE_ATTRMAP_REVERSE_LORES_CHAR_GTIA10_TEST.XEX"]],
  ["VBXE_ATTRMAP_REVERSE_LORES_CHAR_GTIA10_COLOR1_TEST.asm", ["VBXE_ATTRMAP_REVERSE_LORES_CHAR_GTIA10_COLOR1_TEST.XEX"]],
  ["VBXE_ATTRMAP_REVERSE_LORES_CHAR_GTIA10_PF0BLUE_TEST.asm", ["VBXE_ATTRMAP_REVERSE_LORES_CHAR_GTIA10_PF0BLUE_TEST.XEX"]],
  ["VBXE_ATTRMAP_REVERSE_LORES_CHAR_GTIA10_23_TEST.asm", ["VBXE_ATTRMAP_REVERSE_LORES_CHAR_GTIA10_23_TEST.XEX"]],
  ["VBXE_ATTRMAP_REVERSE_LORES_CHAR_GTIA11_TEST.asm", ["VBXE_ATTRMAP_REVERSE_LORES_CHAR_GTIA11_TEST.XEX"]],
  ["VBXE_ATTRMAP_REVERSE_LORES_CHAR5_GTIA10_TEST.asm", ["VBXE_ATTRMAP_REVERSE_LORES_CHAR5_GTIA10_TEST.XEX"]],
  ["VBXE_ATTRMAP_REVERSE_LORES_CHAR5_GTIA9_TEST.asm", ["VBXE_ATTRMAP_REVERSE_LORES_CHAR5_GTIA9_TEST.XEX"]],
  ["VBXE_ATTRMAP_REVERSE_LORES_CHAR5_GTIA11_TEST.asm", ["VBXE_ATTRMAP_REVERSE_LORES_CHAR5_GTIA11_TEST.XEX"]],
  ["VBXE_ATTRMAP_REVERSE_CHAR6_GTIA10_TEST.asm", ["VBXE_ATTRMAP_REVERSE_CHAR6_GTIA10_TEST.XEX"]],
  ["VBXE_ATTRMAP_REVERSE_CHAR7_GTIA10_TEST.asm", ["VBXE_ATTRMAP_REVERSE_CHAR7_GTIA10_TEST.XEX"]],
  ["GTIA_MODE10_LORES_CHAR_BASELINE_TEST.asm", ["GTIA_MODE10_LORES_CHAR_BASELINE_TEST.XEX"]],
  ["VBXE_ATTRMAP_REVERSE_LORES_VERTICAL_PROBE.asm", ["VBXE_ATTRMAP_REVERSE_LORES_VERTICAL_PROBE.XEX"]],
  ["VBXE_ATTRMAP_XCOLOR_TEST.asm", ["VBXE_ATTRMAP_XCOLOR_TEST.XEX"]],
  ["VBXE_ATTRMAP_PF_PALETTE_TEST.asm", ["VBXE_ATTRMAP_PF_PALETTE_TEST.XEX"]],
]) {
  const result = assembleDiagnostic(diagnostic[0]);
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
