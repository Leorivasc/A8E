/* global __dirname, console, require, Uint8Array, ArrayBuffer, Set */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadApi() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "js", "core", "atr_inspector.js"),
    "utf8",
  );
  const context = {
    Uint8Array: Uint8Array,
    ArrayBuffer: ArrayBuffer,
    Set: Set,
  };
  context.window = context;
  context.self = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "atr_inspector.js" });
  return context.window.A8EAtrInspector;
}

function makeAtr() {
  const bytes = new Uint8Array(16 + 720 * 128);
  const paragraphs = 720 * 128 / 16;
  bytes[0] = 0x96;
  bytes[1] = 0x02;
  bytes[2] = paragraphs & 0xff;
  bytes[3] = (paragraphs >> 8) & 0xff;
  bytes[4] = 128;
  bytes[6] = (paragraphs >> 16) & 0xff;
  bytes[7] = (paragraphs >> 24) & 0xff;
  return bytes;
}

function sector(bytes, number) {
  return bytes.subarray(16 + (number - 1) * 128, 16 + number * 128);
}

async function main() {
  const inspector = loadApi();
  const atr = makeAtr();
  const vtoc = sector(atr, 360);
  vtoc[0] = 2;
  vtoc[1] = 707 & 0xff;
  vtoc[2] = 707 >> 8;
  vtoc[3] = 707 & 0xff;
  vtoc[4] = 707 >> 8;
  const directory = sector(atr, 361);
  directory[0] = 0x42;
  directory[1] = 1;
  directory[3] = 4;
  "HELLO   TXT".split("").forEach(function (character, index) {
    directory[5 + index] = character.charCodeAt(0);
  });
  const data = sector(atr, 4);
  "Hello\n".split("").forEach(function (character, index) {
    data[index] = character.charCodeAt(0);
  });
  data[127] = 6;

  const result = inspector.inspect(atr);
  assert.equal(result.valid, true);
  assert.equal(result.header.totalSectors, 720);
  assert.equal(result.filesystem.name, "DOS 2.x / MyDOS");
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].name, "HELLO   TXT");
  assert.deepEqual(
    Array.from(inspector.extractFile(atr, result, result.entries[0])),
    Array.from(new Uint8Array([72, 101, 108, 108, 111, 10])),
  );
  assert.equal(inspector.decodeAtascii(new Uint8Array([65, 0x9b, 66])), "A\nB");

  const unknownBytes = new Uint8Array(atr);
  unknownBytes[16 + (360 - 1) * 128] = 0;
  const unknown = inspector.inspect(unknownBytes);
  assert.equal(unknown.valid, true);
  assert.equal(unknown.filesystem, null);
  assert.equal(inspector.inspect(new Uint8Array([0, 1])).valid, false);
  console.log("atr_inspector.test.js passed");
}

main().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
