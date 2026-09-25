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

function readSegments(bytes) {
  const segments = [];
  let offset = 0;
  while (offset < bytes.length) {
    assert.equal(bytes[offset], 0xff, "XEX segment magic low byte");
    assert.equal(bytes[offset + 1], 0xff, "XEX segment magic high byte");
    const start = bytes[offset + 2] | (bytes[offset + 3] << 8);
    const end = bytes[offset + 4] | (bytes[offset + 5] << 8);
    const length = end - start + 1;
    segments.push({ start, end, length });
    offset += 6 + length;
  }
  assert.equal(offset, bytes.length, "XEX should contain complete segments");
  return segments;
}

const sourcePath = path.resolve(__dirname, "../../implementation/AHRM07_PMG_TEST.asm");
const artifactPath = path.resolve(__dirname, "../../implementation/AHRM07_PMG_TEST.XEX");
const result = loadAssembler().assembleToXex(fs.readFileSync(sourcePath, "utf8"));
assert.ok(result.ok, "AHRM-07 XEX should assemble: " + (result.error || ""));

const artifact = fs.readFileSync(artifactPath);
assert.deepEqual(
  Buffer.from(result.bytes),
  artifact,
  "checked-in AHRM-07 XEX should be reproducible from its source",
);

const segments = readSegments(artifact);
assert.deepEqual(
  segments.map((segment) => [segment.start, segment.end]),
  [
    [0x2000, 0x224b],
    [0x3000, 0x3020],
    [0x4000, 0x43ff],
    [0x5000, 0x53bf],
    [0x8000, 0x83ff],
    [0x02e0, 0x02e1],
  ],
  "AHRM-07 XEX should preserve its PMG, screen, and RUNAD segments",
);

console.log("ahrm07_pmg_xex: all tests passed.");
