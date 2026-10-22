/* global console, require, __dirname, Uint8Array, ArrayBuffer */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadApi() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "js", "core", "disk_image.js"),
    "utf8",
  );
  const context = {
    Uint8Array: Uint8Array,
    ArrayBuffer: ArrayBuffer,
  };
  context.window = context;
  context.self = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "disk_image.js" });
  return context.window.A8EDiskImage;
}

function atrSector(bytes, sector, size) {
  if (sector <= 3) return bytes.subarray(16 + (sector - 1) * 128, 16 + sector * 128);
  const offset = 16 + 3 * 128 + (sector - 4) * size;
  return bytes.subarray(offset, offset + size);
}

function main() {
  const diskImage = loadApi();

  const rawSingle = new Uint8Array(720 * 128);
  rawSingle[0] = 0x4d;
  rawSingle[359 * 128] = 2;
  rawSingle[359 * 128 + 1] = 0xc3;
  rawSingle[359 * 128 + 2] = 0x02;
  const singleGeometry = diskImage.detect(rawSingle);
  assert.equal(singleGeometry.format, "raw");
  assert.equal(singleGeometry.sectorSize, 128);
  assert.equal(singleGeometry.totalSectors, 720);

  const single = diskImage.normalizeForEmulator(rawSingle);
  assert.equal(single.converted, true);
  assert.equal(single.bytes.length, 16 + 720 * 128);
  assert.deepEqual(Array.from(single.bytes.slice(0, 2)), [0x96, 0x02]);
  assert.equal(atrSector(single.bytes, 1, 128)[0], 0x4d);
  assert.equal(atrSector(single.bytes, 360, 128)[0], 2);
  assert.equal(
    atrSector(single.bytes, 360, 128)[1] |
      (atrSector(single.bytes, 360, 128)[2] << 8),
    707,
  );

  const rawDouble = new Uint8Array(720 * 256);
  rawDouble[0] = 0x11;
  rawDouble[256] = 0x22;
  rawDouble[512] = 0x33;
  rawDouble[768] = 0x44;
  rawDouble[768 + 255] = 0x55;
  const double = diskImage.normalizeForEmulator(rawDouble);
  assert.equal(double.geometry.sectorSize, 256);
  assert.equal(atrSector(double.bytes, 1, 256)[0], 0x11);
  assert.equal(atrSector(double.bytes, 2, 256)[0], 0x22);
  assert.equal(atrSector(double.bytes, 3, 256)[0], 0x33);
  assert.equal(atrSector(double.bytes, 4, 256)[0], 0x44);
  assert.equal(atrSector(double.bytes, 4, 256)[255], 0x55);

  const atr = new Uint8Array(16 + 720 * 128);
  atr[0] = 0x96;
  atr[1] = 0x02;
  atr[2] = (720 * 128 / 16) & 0xff;
  atr[3] = (720 * 128 / 16) >>> 8;
  atr[4] = 128;
  const unchanged = diskImage.normalizeForEmulator(atr);
  assert.equal(unchanged.converted, false);
  assert.equal(unchanged.sourceFormat, "atr");
  assert.deepEqual(Array.from(unchanged.bytes), Array.from(atr));

  console.log("disk_image.test.js passed");
}

main();
