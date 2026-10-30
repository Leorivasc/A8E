/* global __dirname, console, require */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const IO_COLBK = 0xd01a;
const IO_COLPF0 = 0xd016;
const IO_COLPF1 = 0xd017;
const IO_COLPF2 = 0xd018;
const IO_PRIOR = 0xd01b;

function loadMode8FApi(overrides) {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "js", "core", "playfield", "mode_8_f.js"),
    "utf8",
  );
  const context = {
    console: console,
    Uint8Array: Uint8Array,
    Math: Math,
    Number: Number,
    Object: Object,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "mode_8_f.js" });

  const defaults = {
    Util: {
      fixedAdd: function (value, mask, add) {
        return (value & ~mask) | ((value + add) & mask);
      },
    },
    IO_COLBK: IO_COLBK,
    IO_COLPF0: IO_COLPF0,
    IO_COLPF1: IO_COLPF1,
    IO_COLPF2: IO_COLPF2,
    IO_PRIOR: IO_PRIOR,
    PRIO_BKG: 0x00,
    PRIO_PF0: 0x01,
    PRIO_PF1: 0x02,
    PRIO_PF2: 0x04,
    PRIO_PF3: 0x08,
    PRIO_M10_PM0: 0x100,
    PRIO_M10_PM1: 0x200,
    PRIO_M10_PM2: 0x400,
    PRIO_M10_PM3: 0x800,
    SCRATCH_GTIA_COLOR_TABLE: new Uint8Array(16),
    SCRATCH_COLOR_TABLE_A: new Uint8Array(4),
    fillBkgPf012ColorTable: function () {},
    fillGtiaColorTable: function () {},
    PRIORITY_TABLE_BKG_PF012: new Uint8Array([0x00, 0x01, 0x02, 0x04]),
    clockAction: function () {},
    stealDma: function (ctx, cycles) {
      ctx.cycleCounter += cycles | 0;
    },
  };

  const cfg = Object.assign({}, defaults, overrides || {});
  return context.window.A8EPlayfieldMode8F.createApi(cfg);
}

function createCtx() {
  return {
    cycleCounter: 0,
    ram: new Uint8Array(0x10000),
    sram: new Uint8Array(0x10000),
    ioData: {
      firstRowScanline: false,
      drawLine: {
        bytesPerLine: 1,
        destIndex: 0,
        displayMemoryAddress: 0,
      },
      videoOut: {
        pixels: new Uint8Array(64),
        priority: new Uint16Array(64),
      },
    },
  };
}

function loadApiWithBitmapColors() {
  return loadMode8FApi({
    fillBkgPf012ColorTable: function (sram, table) {
      table[0] = sram[IO_COLBK] & 0xff;
      table[1] = sram[IO_COLPF0] & 0xff;
      table[2] = sram[IO_COLPF1] & 0xff;
      table[3] = sram[IO_COLPF2] & 0xff;
    },
  });
}

function setBitmapColors(ctx) {
  ctx.sram[IO_COLBK] = 0x10;
  ctx.sram[IO_COLPF0] = 0x21;
  ctx.sram[IO_COLPF1] = 0x32;
  ctx.sram[IO_COLPF2] = 0x43;
}

function testMode8RepeatsEachBitPairForEightPixels() {
  const api = loadApiWithBitmapColors();
  const ctx = createCtx();

  setBitmapColors(ctx);
  ctx.ram[0] = 0x1b; // 00, 01, 10, 11

  api.drawLineMode8(ctx);

  assert.equal(ctx.ioData.videoOut.pixels[0], 0x10);
  assert.equal(ctx.ioData.videoOut.pixels[7], 0x10);
  assert.equal(ctx.ioData.videoOut.pixels[8], 0x21);
  assert.equal(ctx.ioData.videoOut.pixels[15], 0x21);
  assert.equal(ctx.ioData.videoOut.pixels[16], 0x32);
  assert.equal(ctx.ioData.videoOut.pixels[23], 0x32);
  assert.equal(ctx.ioData.videoOut.pixels[24], 0x43);
  assert.equal(ctx.ioData.videoOut.pixels[31], 0x43);
}

function testModeAUsesAllFourBitPairs() {
  const api = loadApiWithBitmapColors();
  const ctx = createCtx();

  setBitmapColors(ctx);
  ctx.ram[0] = 0x1b; // 00, 01, 10, 11

  api.drawLineModeA(ctx);

  assert.equal(ctx.ioData.videoOut.pixels[0], 0x10);
  assert.equal(ctx.ioData.videoOut.pixels[3], 0x10);
  assert.equal(ctx.ioData.videoOut.pixels[4], 0x21);
  assert.equal(ctx.ioData.videoOut.pixels[7], 0x21);
  assert.equal(ctx.ioData.videoOut.pixels[8], 0x32);
  assert.equal(ctx.ioData.videoOut.pixels[11], 0x32);
  assert.equal(ctx.ioData.videoOut.pixels[12], 0x43);
  assert.equal(ctx.ioData.videoOut.pixels[15], 0x43);
}

function testMode8AndModeAPreserveLoresPairsForVbxeReverse() {
  const api = loadApiWithBitmapColors();

  const mode8 = createCtx();
  mode8.ioData.videoOut.anticSourceLores = new Uint8Array(64);
  mode8.ioData.videoOut.anticSourceLores.fill(0xff);
  mode8.ram[0] = 0x1b;
  api.drawLineMode8(mode8);
  assert.deepEqual(
    Array.from(mode8.ioData.videoOut.anticSourceLores.slice(0, 32)),
    [0, 0, 0, 0, 0, 0, 0, 0,
      1, 1, 1, 1, 1, 1, 1, 1,
      2, 2, 2, 2, 2, 2, 2, 2,
      3, 3, 3, 3, 3, 3, 3, 3],
    "mode 8 must retain its repeated two-bit lores values",
  );

  const modeA = createCtx();
  modeA.ioData.videoOut.anticSourceLores = new Uint8Array(64);
  modeA.ioData.videoOut.anticSourceLores.fill(0xff);
  modeA.ram[0] = 0x1b;
  api.drawLineModeA(modeA);
  assert.deepEqual(
    Array.from(modeA.ioData.videoOut.anticSourceLores.slice(0, 16)),
    [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3],
    "mode A must retain all of its two-bit lores values",
  );
}

function testTwoColorLoresModesCollapseToHiresPairZero() {
  const api = loadApiWithBitmapColors();

  const mode9 = createCtx();
  mode9.ioData.videoOut.anticSourceLores = new Uint8Array(64);
  mode9.ioData.videoOut.anticSourceLores.fill(0xff);
  mode9.ram[0] = 0xff;
  api.drawLineMode9(mode9);
  assert.deepEqual(
    Array.from(mode9.ioData.videoOut.anticSourceLores.slice(0, 32)),
    new Array(32).fill(0),
    "mode 9 PF0 and background must both become hires pair 00",
  );

  const modeB = createCtx();
  modeB.ioData.videoOut.anticSourceLores = new Uint8Array(64);
  modeB.ioData.videoOut.anticSourceLores.fill(0xff);
  modeB.ram[0] = 0xff;
  api.drawLineModeB(modeB);
  assert.deepEqual(
    Array.from(modeB.ioData.videoOut.anticSourceLores.slice(0, 16)),
    new Array(16).fill(0),
    "mode B PF0 and background must both become hires pair 00",
  );
}

function testModeFPreservesHiresBitsInGtiaSpecialMode() {
  const api = loadMode8FApi({
    fillGtiaColorTable: function (sram, table) {
      for (let i = 0; i < table.length; i++) table[i] = i;
    },
  });
  const ctx = createCtx();
  ctx.sram[IO_PRIOR] = 0x80;
  ctx.ioData.videoOut.anticSourceBits = new Uint8Array(64);
  ctx.ioData.videoOut.anticSourceBits.fill(0xff);
  ctx.ram[0] = 0x1b;

  api.drawLineModeF(ctx);

  assert.deepEqual(
    Array.from(ctx.ioData.videoOut.anticSourceBits.slice(0, 8)),
    [0, 0, 0, 1, 1, 0, 1, 1],
    "mode F special output must retain its original hires source bits",
  );
}

function testModeFPriorMode0WidthIsNotDoubled() {
  const api = loadMode8FApi();
  const ctx = createCtx();

  ctx.sram[IO_PRIOR] = 0x00;
  ctx.sram[IO_COLPF1] = 0x0b;
  ctx.sram[IO_COLPF2] = 0xa0;
  ctx.ram[0] = 0x00;
  ctx.ioData.videoOut.pixels.fill(0xee);
  ctx.ioData.videoOut.priority.fill(0xeeee);

  api.drawLineModeF(ctx);

  assert.equal(ctx.ioData.videoOut.pixels[8], 0xee);
  assert.equal(ctx.ioData.videoOut.priority[8], 0xeeee);
}

function testModeFDmaOnlyOccursOnFirstScanline() {
  const api = loadMode8FApi();

  const ctxRepeated = createCtx();
  ctxRepeated.sram[IO_PRIOR] = 0x00;
  ctxRepeated.ram[0] = 0xff;
  ctxRepeated.ioData.firstRowScanline = false;

  api.drawLineModeF(ctxRepeated);
  assert.equal(ctxRepeated.cycleCounter, 0);

  const ctxFirst = createCtx();
  ctxFirst.sram[IO_PRIOR] = 0x00;
  ctxFirst.ram[0] = 0xff;
  ctxFirst.ioData.firstRowScanline = true;

  api.drawLineModeF(ctxFirst);
  assert.equal(ctxFirst.cycleCounter, 1);
}

testMode8RepeatsEachBitPairForEightPixels();
testModeAUsesAllFourBitPairs();
testMode8AndModeAPreserveLoresPairsForVbxeReverse();
testTwoColorLoresModesCollapseToHiresPairZero();
testModeFPreservesHiresBitsInGtiaSpecialMode();
testModeFPriorMode0WidthIsNotDoubled();
testModeFDmaOnlyOccursOnFirstScanline();
console.log("playfield_mode_8_f_rendering tests passed");
