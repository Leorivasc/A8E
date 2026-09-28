/* global __dirname, console, require */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadGtiaApi() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "js", "core", "gtia.js"),
    "utf8",
  );
  const context = {
    console: console,
    Uint8Array: Uint8Array,
    Uint16Array: Uint16Array,
    Math: Math,
    Number: Number,
    Object: Object,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "gtia.js" });

  return context.window.A8EGtia.createApi({
    PIXELS_PER_LINE: 456,
    IO_COLPF3: 0xd019,
    IO_COLPM0_TRIG2: 0xd012,
    IO_COLPM1_TRIG3: 0xd013,
    IO_COLPM2_PAL: 0xd014,
    IO_COLPM3: 0xd015,
    IO_DMACTL: 0xd400,
    IO_GRACTL: 0xd01d,
    IO_GRAFM_TRIG1: 0xd011,
    IO_GRAFP0_P1PL: 0xd00d,
    IO_GRAFP1_P2PL: 0xd00e,
    IO_GRAFP2_P3PL: 0xd00f,
    IO_GRAFP3_TRIG0: 0xd010,
    IO_HPOSM0_P0PF: 0xd004,
    IO_HPOSM1_P1PF: 0xd005,
    IO_HPOSM2_P2PF: 0xd006,
    IO_HPOSM3_P3PF: 0xd007,
    IO_HPOSP0_M0PF: 0xd000,
    IO_HPOSP1_M1PF: 0xd001,
    IO_HPOSP2_M2PF: 0xd002,
    IO_HPOSP3_M3PF: 0xd003,
    IO_PMBASE: 0xd407,
    IO_PRIOR: 0xd01b,
    IO_SIZEM_P0PL: 0xd00c,
    IO_SIZEP0_M0PL: 0xd008,
    IO_SIZEP1_M1PL: 0xd009,
    IO_SIZEP2_M2PL: 0xd00a,
    IO_SIZEP3_M3PL: 0xd00b,
    IO_VDELAY: 0xd01c,
    PLAYFIELD_SCRATCH_VIEW_X: 64,
    PRIO_BKG: 0x00,
    PRIO_PF0: 0x01,
    PRIO_PF1: 0x02,
    PRIO_PF2: 0x04,
    PRIO_PF3: 0x08,
    PRIO_PM0: 0x10,
    PRIO_PM1: 0x20,
    PRIO_PM2: 0x40,
    PRIO_PM3: 0x80,
    PRIO_M10_PM0: 0x100,
    PRIO_M10_PM1: 0x200,
    PRIO_M10_PM2: 0x400,
    PRIO_M10_PM3: 0x800,
  });
}

function makeCtx() {
  return {
    ram: new Uint8Array(0x10000),
    sram: new Uint8Array(0x10000),
    ioData: {
      video: {
        currentDisplayLine: 0,
      },
      clock: 0,
      displayListFetchCycle: 0,
      currentDisplayListCommand: 0x00,
      drawLine: {
        playerMissileClockActive: true,
        playerMissileInterleaved: true,
        pmgFirstVisibleSpan: true,
        playerPmgShift: new Uint8Array(4),
        playerPmgState: new Uint8Array(4),
        missilePmgShift: new Uint8Array(4),
        missilePmgState: new Uint8Array(4),
      },
      videoOut: {
        pixels: new Uint8Array(456),
        priority: new Uint16Array(456),
      },
    },
  };
}

function enablePmgHistory(ctx) {
  const drawLine = ctx.ioData.drawLine;
  drawLine.pmgEventCount = 0;
  drawLine.pmgEventOverflow = false;
  drawLine.pmgInitialRegisters = new Uint8Array(18);
  drawLine.pmgReplayRegisters = new Uint8Array(18);
  drawLine.pmgEventRegisters = new Uint8Array(64);
  drawLine.pmgEventValues = new Uint8Array(64);
  drawLine.pmgEventCycles = new Uint8Array(64);
  ctx.ioData.inDrawLine = true;
  return drawLine;
}

function testVdelayMasksFetchesOnEvenScanlines() {
  const api = loadGtiaApi();
  const ctx = makeCtx();
  const drawLine = enablePmgHistory(ctx);

  ctx.sram[0xd400] = 0x08;
  ctx.sram[0xd01d] = 0x03;
  ctx.sram[0xd01c] = 0x1f;
  ctx.sram[0xd407] = 0x20;
  ctx.sram[0xd011] = 0x12;
  ctx.ram[0x2184] = 0x56;
  ctx.ram[0x2203] = 0x33;
  ctx.ram[0x2204] = 0x44;

  const firstFetch = api.fetchPmgDmaCycle(ctx, 2, 7);
  assert.equal(firstFetch, 1);
  assert.equal(ctx.sram[0xd00d], 0x33);

  const maskedMissileFetch = api.fetchPmgDmaCycle(ctx, 0, 8);
  assert.equal(maskedMissileFetch, 1);
  assert.equal(ctx.sram[0xd011], 0x12);

  const maskedFetch = api.fetchPmgDmaCycle(ctx, 2, 8);
  assert.equal(maskedFetch, 1);
  assert.equal(ctx.sram[0xd00d], 0x33);
  assert.equal(drawLine.pmgEventCount, 1);

  const secondFetch = api.fetchPmgDmaCycle(ctx, 2, 9);
  assert.equal(secondFetch, 1);
  assert.equal(ctx.sram[0xd00d], 0x44);

  ctx.sram[0xd01c] = 0x01;
  ctx.sram[0xd011] = 0x03;
  ctx.ram[0x2184] = 0xe4;
  const partiallyMaskedMissileFetch = api.fetchPmgDmaCycle(ctx, 0, 8);
  assert.equal(partiallyMaskedMissileFetch, 1);
  assert.equal(ctx.sram[0xd011], 0xe7);
}

function testPlayerDmaKeepsMissileSlotAlive() {
  const api = loadGtiaApi();
  const ctx = makeCtx();

  ctx.sram[0xd400] = 0x08;
  ctx.sram[0xd01d] = 0x01;
  ctx.sram[0xd407] = 0x20;
  ctx.ram[0x2184] = 0x7a;

  const fetch = api.fetchPmgDmaCycle(ctx, 0, 8);
  assert.equal(fetch, 1);
  assert.equal(ctx.sram[0xd011], 0x7a);
}

function testDelayedDmaCtlControlsPmgFetch() {
  const api = loadGtiaApi();
  const ctx = makeCtx();

  ctx.sram[0xd400] = 0x32;
  ctx.sram[0xd01d] = 0x03;
  ctx.sram[0xd407] = 0x20;
  ctx.sram[0xd011] = 0x00;
  ctx.sram[0xd00d] = 0x4c;
  ctx.ram[0x2308] = 0xa5;
  ctx.ram[0x2408] = 0x5a;

  // AHRM 4.13: a disable on cycle 113 still permits missile DMA at cycle 0.
  assert.equal(api.fetchPmgDmaCycle(ctx, 0, 8, 0x3e), 1);
  assert.equal(ctx.sram[0xd011], 0xa5);

  // The same delayed value has reached the disabled state by player cycle 2.
  assert.equal(api.fetchPmgDmaCycle(ctx, 2, 8, 0x32), 0);
  assert.equal(ctx.sram[0xd00d], 0x4c);
}

function testPhantomMissileDmaUsesDisplayListByte() {
  const api = loadGtiaApi();
  const ctx = makeCtx();
  const drawLine = enablePmgHistory(ctx);

  ctx.sram[0xd01d] = 0x01;
  ctx.sram[0xd011] = 0x00;
  assert.equal(api.fetchPhantomMissileDmaCycle(ctx, 1, 8, 0xe4), 1);
  assert.equal(ctx.sram[0xd011], 0xe4);
  assert.equal(drawLine.pmgEventCount, 1);
  assert.equal(drawLine.pmgEventCycles[0], 1);
}

function testPmbaseChangeKeepsMixedLineDmaHistory() {
  const api = loadGtiaApi();
  const ctx = makeCtx();
  const drawLine = enablePmgHistory(ctx);

  ctx.sram[0xd400] = 0x08;
  ctx.sram[0xd01d] = 0x02;
  ctx.sram[0xd407] = 0x20;
  ctx.ram[0x2203] = 0x11;
  ctx.ram[0x2683] = 0x22;

  assert.equal(api.fetchPmgDmaCycle(ctx, 2, 7), 1);
  ctx.sram[0xd407] = 0x24;
  assert.equal(api.fetchPmgDmaCycle(ctx, 3, 7), 1);

  assert.equal(ctx.sram[0xd00d], 0x11);
  assert.equal(ctx.sram[0xd00e], 0x22);
  assert.equal(drawLine.pmgEventCount, 2);
  assert.deepEqual(
    Array.from(drawLine.pmgEventCycles.slice(0, 2)),
    [2, 3],
  );
}

function testHposZeroStillRenders() {
  const api = loadGtiaApi();
  const ctx = makeCtx();

  ctx.sram[0xd01b] = 0x00;
  ctx.sram[0xd00d] = 0xff;
  ctx.sram[0xd000] = 0x00;
  ctx.sram[0xd008] = 0x03;
  ctx.sram[0xd012] = 0x66;

  api.drawPlayerMissilesClock(ctx, 32);

  assert.equal(ctx.ioData.videoOut.pixels[32], 0x66);
  assert.equal(ctx.ioData.videoOut.pixels[35], 0x66);
}

function testMidImageHposWriteKeepsOriginalStart() {
  const api = loadGtiaApi();
  const ctx = makeCtx();

  ctx.sram[0xd01b] = 0x00;
  ctx.sram[0xd00d] = 0xff;
  ctx.sram[0xd000] = 0x18;
  ctx.sram[0xd008] = 0x03;
  ctx.sram[0xd012] = 0x44;

  ctx.ioData.clock = 6;
  api.drawPlayerMissilesClock(ctx, 48);

  ctx.sram[0xd000] = 0x3c;
  ctx.ioData.clock = 7;
  api.drawPlayerMissilesClock(ctx, 52);

  ctx.ioData.clock = 24;
  api.drawPlayerMissilesClock(ctx, 120);

  assert.equal(ctx.ioData.videoOut.pixels[48], 0x44);
  assert.equal(ctx.ioData.videoOut.pixels[55], 0x44);
  assert.equal(ctx.ioData.videoOut.pixels[120], 0x44);
  assert.equal(ctx.ioData.videoOut.pixels[123], 0x44);
}

function testOverlappingRightwardHposRetriggerMergesShiftRegister() {
  const api = loadGtiaApi();
  const ctx = makeCtx();

  ctx.sram[0xd01b] = 0x00;
  ctx.sram[0xd00d] = 0x81;
  ctx.sram[0xd000] = 0x18;
  ctx.sram[0xd008] = 0x00;
  ctx.sram[0xd012] = 0x55;

  ctx.ioData.clock = 6;
  api.drawPlayerMissilesClock(ctx, 48);

  ctx.sram[0xd000] = 0x1a;
  ctx.ioData.clock = 7;
  api.drawPlayerMissilesClock(ctx, 52);
  api.drawPlayerMissilesClock(ctx, 56);
  api.drawPlayerMissilesClock(ctx, 60);
  api.drawPlayerMissilesClock(ctx, 64);

  assert.equal(ctx.ioData.videoOut.pixels[48], 0x55);
  assert.equal(ctx.ioData.videoOut.pixels[49], 0x55);
  assert.equal(ctx.ioData.videoOut.pixels[52], 0x55);
  assert.equal(ctx.ioData.videoOut.pixels[53], 0x55);
  assert.equal(ctx.ioData.videoOut.pixels[62], 0x55);
  assert.equal(ctx.ioData.videoOut.pixels[63], 0x55);
  assert.equal(ctx.ioData.videoOut.pixels[66], 0x55);
  assert.equal(ctx.ioData.videoOut.pixels[67], 0x55);
  assert.equal(ctx.ioData.drawLine.playerPmgShift[0], 0x00);
}

function testMidLinePriorWriteAffectsOnlyLaterPixels() {
  const api = loadGtiaApi();
  const ctx = makeCtx();

  ctx.sram[0xd01b] = 0x04;
  ctx.sram[0xd00d] = 0xff;
  ctx.sram[0xd000] = 0x30;
  ctx.sram[0xd008] = 0x03;
  ctx.sram[0xd012] = 0x66;
  ctx.ioData.videoOut.priority[96] = 0x01;
  ctx.ioData.videoOut.priority[97] = 0x01;

  api.drawPlayerMissilesClock(ctx, 96);
  ctx.sram[0xd01b] = 0x00;
  api.drawPlayerMissilesClock(ctx, 100);

  assert.equal(ctx.ioData.videoOut.pixels[96], 0x00);
  assert.equal(ctx.ioData.videoOut.pixels[100], 0x66);
}

function testPlayerCollisionSetsBothPlayerLatches() {
  const api = loadGtiaApi();
  const ctx = makeCtx();

  ctx.sram[0xd01b] = 0x00;
  ctx.sram[0xd00d] = 0xff;
  ctx.sram[0xd00e] = 0xff;
  ctx.sram[0xd000] = 0x30;
  ctx.sram[0xd001] = 0x30;
  ctx.sram[0xd008] = 0x00;
  ctx.sram[0xd009] = 0x00;
  ctx.sram[0xd012] = 0x66;
  ctx.sram[0xd013] = 0x77;

  api.drawPlayerMissilesClock(ctx, 96);

  assert.equal(ctx.ram[0xd00c] & 0x02, 0x02);
  assert.equal(ctx.ram[0xd00d] & 0x01, 0x01);
}

function testHpos30MapsToNormalPlayfieldLeftEdge() {
  const api = loadGtiaApi();
  const ctx = makeCtx();

  ctx.sram[0xd01b] = 0x00;
  ctx.sram[0xd00d] = 0x80;
  ctx.sram[0xd000] = 0x30;
  ctx.sram[0xd008] = 0x00;
  ctx.sram[0xd012] = 0x77;

  api.drawPlayerMissiles(ctx);

  assert.equal(ctx.ioData.videoOut.pixels[95], 0x00);
  assert.equal(ctx.ioData.videoOut.pixels[96], 0x77);
  assert.equal(ctx.ioData.videoOut.pixels[97], 0x77);
}

function testHiddenSpanReplaysMidLineHposHistory() {
  const api = loadGtiaApi();
  const ctx = makeCtx();
  const drawLine = enablePmgHistory(ctx);
  drawLine.pmgInitialRegisters[0] = 60;
  drawLine.pmgInitialRegisters[8] = 0x03;
  drawLine.pmgInitialRegisters[13] = 0xff;

  ctx.sram[0xd01b] = 0x00;
  ctx.sram[0xd000] = 24;
  ctx.sram[0xd008] = 0x03;
  ctx.sram[0xd00d] = 0xff;
  ctx.sram[0xd012] = 0x66;
  ctx.ioData.clock = 10;
  ctx.currentInstructionCycles = 1;
  api.recordPmgRegisterWrite(ctx, 0xd000, 24);

  api.drawPlayerMissilesClock(ctx, 96);

  // The write occurs after the old HPOS position (x=120) has passed. It must
  // not retroactively start a sprite at x=48 in the hidden span.
  assert.equal(ctx.ioData.videoOut.pixels[96], 0x00);
  assert.equal(drawLine.pmgEventCount, 1);
}

// AHRM 6.7/6.8: mode 0 mixes the matching PF/player groups. In
// high resolution, PF1 marks foreground luminance but priority still sees PF2.
function testModeZeroPlayerPlayfieldMix() {
  const api = loadGtiaApi();
  for (const special of [false, true]) {
    for (const multi of [0, 0x20]) {
      const ctx = makeCtx();
      ctx.ioData.currentDisplayListCommand = special ? 2 : 4;
      ctx.sram[0xd01b] = multi;
      ctx.sram[0xd002] = ctx.sram[0xd003] = 0x30;
      ctx.sram[0xd00f] = ctx.sram[0xd010] = 0x80;
      ctx.sram[0xd014] = 0x48;
      ctx.sram[0xd015] = 0x22;
      ctx.ioData.videoOut.priority[96] = 4;
      ctx.ioData.videoOut.priority[97] = special ? 2 : 4;
      ctx.ioData.videoOut.pixels[96] = 0x94;
      ctx.ioData.videoOut.pixels[97] = special ? 0x96 : 0x94;
      api.drawPlayerMissilesClock(ctx, 96);
      assert.equal(ctx.ioData.videoOut.pixels[96], multi ? 0xfe : 0xdc);
      assert.equal(ctx.ioData.videoOut.pixels[97], special ? (multi ? 0xf6 : 0xd6) : (multi ? 0xfe : 0xdc));
      assert.equal(ctx.ram[0xd006] & 4, 4);
    }
  }
}
function testModeZeroMixGroupsAndBackground() {
  const api = loadGtiaApi();
  for (const [player, prior, pf, expected] of [
    [0, 0, 1, 0xdc], [1, 0, 2, 0xdc],
    [2, 0, 4, 0xdc], [3, 0, 8, 0xdc],
    [0, 0, 0, 0x48], [2, 0, 0, 0x48],
    [0, 1, 1, 0x48], [2, 1, 4, 0x48],
  ]) {
    const ctx = makeCtx();
    ctx.sram[0xd01b] = prior;
    ctx.sram[0xd000 + player] = 0x30;
    ctx.sram[0xd00d + player] = 0x80;
    ctx.sram[0xd012 + player] = 0x48;
    ctx.ioData.videoOut.priority[96] = pf;
    ctx.ioData.videoOut.pixels[96] = 0x94;
    api.drawPlayerMissilesClock(ctx, 96);
    assert.equal(ctx.ioData.videoOut.pixels[96], expected);
  }
}
testModeZeroMixGroupsAndBackground();
testModeZeroPlayerPlayfieldMix();

testVdelayMasksFetchesOnEvenScanlines();
testPlayerDmaKeepsMissileSlotAlive();
testDelayedDmaCtlControlsPmgFetch();
testPhantomMissileDmaUsesDisplayListByte();
testPmbaseChangeKeepsMixedLineDmaHistory();
testHposZeroStillRenders();
testMidImageHposWriteKeepsOriginalStart();
testOverlappingRightwardHposRetriggerMergesShiftRegister();
testMidLinePriorWriteAffectsOnlyLaterPixels();
testPlayerCollisionSetsBothPlayerLatches();
testHpos30MapsToNormalPlayfieldLeftEdge();
testHiddenSpanReplaysMidLineHposHistory();
console.log("gtia_pmg_dma_regression tests passed");
