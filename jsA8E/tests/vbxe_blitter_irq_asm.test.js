"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const rootDir = path.resolve(__dirname, "../..");
const context = vm.createContext({});
context.window = context;
context.self = context;
context.globalThis = context;
for (const rel of [
  "js/core/cpu_tables.js", "js/core/assembler/shared.js", "js/core/assembler/lexer.js",
  "js/core/assembler/preprocessor.js", "js/core/assembler/parser.js",
  "js/core/assembler/object_writer.js", "js/core/assembler/assembler.js",
  "js/core/assembler_core.js",
]) {
  vm.runInContext(fs.readFileSync(path.join(rootDir, "jsA8E", rel), "utf8"), context,
    { filename: rel });
}
const sourcePath = path.join(rootDir, "implementation", "AHRM Validation", "VBXE_BLITTER_IRQ_TEST.asm");
const artifactPath = sourcePath.replace(/\.asm$/, ".XEX");
const result = context.A8EAssemblerCore.assembleToXex(fs.readFileSync(sourcePath, "utf8"));
assert.ok(result.ok, result.error || "VBXE blitter IRQ diagnostic should assemble");
assert.deepEqual(Buffer.from(result.bytes), fs.readFileSync(artifactPath));
console.log("vbxe_blitter_irq_asm.test.js passed");
