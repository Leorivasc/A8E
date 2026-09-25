/* global __dirname, console, require */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadAssembler() {
  const rootDir = path.join(__dirname, "..");
  const context = {
    console: console,
    Uint8Array: Uint8Array,
    Uint16Array: Uint16Array,
    Int32Array: Int32Array,
    Math: Math,
    Number: Number,
    Object: Object,
    String: String,
    RegExp: RegExp,
  };
  context.window = context;
  vm.createContext(context);
  const files = [
    "js/core/cpu_tables.js",
    "js/core/assembler/shared.js",
    "js/core/assembler/lexer.js",
    "js/core/assembler/preprocessor.js",
    "js/core/assembler/parser.js",
    "js/core/assembler/object_writer.js",
    "js/core/assembler/assembler.js",
    "js/core/assembler_core.js",
  ];
  for (const file of files) {
    vm.runInContext(
      fs.readFileSync(path.join(rootDir, file), "utf8"),
      context,
      { filename: file },
    );
  }
  return context.A8EAssemblerCore;
}

const rootDir = path.join(__dirname, "..", "..");
const sourcePath = path.join(
  rootDir,
  "implementation",
  "AHRM08_POKEY_STAGE2_TEST.asm",
);
const artifactPath = path.join(
  rootDir,
  "implementation",
  "AHRM08_POKEY_STAGE2_TEST.XEX",
);
const result = loadAssembler().assembleToXex(fs.readFileSync(sourcePath, "utf8"));
assert.ok(result.ok, "AHRM-08 Stage 2 XEX should assemble: " + (result.error || ""));
assert.equal(result.runAddr, 0x2000);
assert.deepEqual(
  Buffer.from(result.bytes),
  fs.readFileSync(artifactPath),
  "checked-in AHRM-08 Stage 2 XEX should be reproducible from its source",
);
console.log("ahrm08_pokey_stage2_xex: all tests passed.");
