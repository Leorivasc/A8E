"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "../..");
const context = vm.createContext({});
context.window = context; context.self = context; context.globalThis = context;
for (const rel of ["js/core/cpu_tables.js", "js/core/assembler/shared.js", "js/core/assembler/lexer.js", "js/core/assembler/preprocessor.js", "js/core/assembler/parser.js", "js/core/assembler/object_writer.js", "js/core/assembler/assembler.js", "js/core/assembler_core.js"])
  vm.runInContext(fs.readFileSync(path.join(root, "jsA8E", rel), "utf8"), context);
const source = path.join(root, "implementation", "AHRM Validation", "VBXE_XDL_GTIA_SPECIAL_COLLISION_PROBE.asm");
const build = context.A8EAssemblerCore.assembleToXex(fs.readFileSync(source, "utf8"));
assert.ok(build.ok, build.error);
assert.deepEqual(Buffer.from(build.bytes), fs.readFileSync(source.replace(/\.asm$/, ".XEX")));
console.log("vbxe_xdl_gtia_special_collision_probe_asm.test.js passed");
