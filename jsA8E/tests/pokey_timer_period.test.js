/* global __dirname, console, require */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const CYCLE_NEVER = Number.POSITIVE_INFINITY;
const IO_AUDF1_POT0 = 0xd200;
const IO_AUDF2_POT2 = 0xd202;
const IO_AUDF4_POT6 = 0xd206;
const IO_AUDCTL_ALLPOT = 0xd208;
const IO_SKCTL_SKSTAT = 0xd20f;

function loadPokeyApi() {
  const context = {
    console: console,
    Uint8Array: Uint8Array,
    Int16Array: Int16Array,
    Math: Math,
    Number: Number,
    Object: Object,
  };
  context.window = context;
  context.A8EPokeySio = {
    createApi: function (cfg) {
      return {
        seroutWrite: function (ctx) {
          // Exercise the real POKEY clock-selection callback without pulling
          // the complete disk state machine into this timer-period fixture.
          const selected = cfg.serialOutputClockPeriod(ctx) | 0;
          const period = selected > 0
            ? selected
            : cfg.SERIAL_OUTPUT_DATA_NEEDED_CYCLES;
          ctx.ioData.serialOutputNeedDataCycle = ctx.cycleCounter + period;
        },
        serinRead: function () {
          return 0;
        },
      };
    },
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "js", "core", "pokey.js"), "utf8"),
    context,
    { filename: "pokey.js" },
  );
  return context.window.A8EPokeyAudio.createApi({
    ATARI_CPU_HZ_PAL: 1773447,
    CYCLES_PER_LINE: 114,
    POKEY_AUDIO_MAX_CATCHUP_CYCLES: 1000000,
    IO_AUDF1_POT0: IO_AUDF1_POT0,
    IO_AUDC1_POT1: 0xd201,
    IO_AUDF2_POT2: IO_AUDF2_POT2,
    IO_AUDC2_POT3: 0xd203,
    IO_AUDF3_POT4: 0xd204,
    IO_AUDC3_POT5: 0xd205,
    IO_AUDF4_POT6: IO_AUDF4_POT6,
    IO_AUDC4_POT7: 0xd207,
    IO_AUDCTL_ALLPOT: IO_AUDCTL_ALLPOT,
    IO_STIMER_KBCODE: 0xd209,
    IO_SKCTL_SKSTAT: IO_SKCTL_SKSTAT,
    IO_SEROUT_SERIN: 0xd20d,
    SERIAL_OUTPUT_DATA_NEEDED_CYCLES: 1,
    SERIAL_OUTPUT_TRANSMISSION_DONE_CYCLES: 1,
    SERIAL_INPUT_FIRST_DATA_READY_CYCLES: 1,
    SERIAL_INPUT_DATA_READY_CYCLES: 1,
    CYCLE_NEVER: CYCLE_NEVER,
    cycleTimedEventUpdate: function () {},
  });
}

function makeContext() {
  return {
    cycleCounter: 0,
    ram: new Uint8Array(0x10000),
    sram: new Uint8Array(0x10000),
    ioData: {},
  };
}

function testSerialClockModeSelection() {
  const api = loadPokeyApi();
  const ctx = makeContext();
  ctx.cycleCounter = 100;
  ctx.sram[IO_AUDF4_POT6] = 1;
  ctx.sram[IO_AUDF2_POT2] = 2;

  // Timer 4: 28 * (1 + 1) = 56 CPU cycles.
  ctx.sram[IO_SKCTL_SKSTAT] = 0x23;
  api.seroutWrite(ctx, 0x55);
  assert.equal(ctx.ioData.serialOutputNeedDataCycle, 156);

  // Timer 2: 28 * (2 + 1) = 84 CPU cycles in modes 110/111.
  ctx.ioData.serialOutputNeedDataCycle = 0;
  ctx.sram[IO_SKCTL_SKSTAT] = 0x63;
  api.seroutWrite(ctx, 0x55);
  assert.equal(ctx.ioData.serialOutputNeedDataCycle, 184);

  // The fixture stub applies its legacy fallback when the clock callback
  // returns zero; the full SIO path now suppresses the event entirely.
  ctx.ioData.serialOutputNeedDataCycle = 0;
  ctx.sram[IO_SKCTL_SKSTAT] = 0x03;
  api.seroutWrite(ctx, 0x55);
  assert.equal(ctx.ioData.serialOutputNeedDataCycle, 101);
}

function testZeroIsTheMinimumValidDivisor() {
  const api = loadPokeyApi();
  const fixture = fs
    .readFileSync(
      path.join(__dirname, "..", "..", "implementation", "traces", "pokey_timer_contract.jsonl"),
      "utf8",
    )
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));

  for (const testCase of fixture) {
    const ctx = makeContext();
    ctx.sram[IO_SKCTL_SKSTAT] = testCase.skctl;
    ctx.sram[IO_AUDCTL_ALLPOT] = testCase.audctl;
    ctx.sram[IO_AUDF1_POT0] = testCase.audf1;
    ctx.sram[IO_AUDF2_POT2] = testCase.audf2;
    ctx.sram[0xd204] = testCase.audf3;
    ctx.sram[IO_AUDF4_POT6] = testCase.audf4;
    assert.equal(
      api.timerPeriodCpuCycles(ctx, testCase.timer),
      testCase.expected,
      testCase.step,
    );
  }
}

function testLinkedAudioReloadsBothCounters() {
  const api = loadPokeyApi();
  for (const lowChannel of [0, 2]) {
    for (const fast of [false, true]) {
      for (const slow15 of [false, true]) {
        const ctx = makeContext();
        const st = api.createState(48000);
        const audctl = (lowChannel === 0 ? 0x10 : 0x08) |
          (fast ? (lowChannel === 0 ? 0x40 : 0x20) : 0) |
          (slow15 ? 1 : 0);
        const base = fast ? 1 : (slow15 ? 114 : 28);
        const first = fast ? 68 : 65; // AUDF low=$40, high=$01 (AHRM 5.3).
        const period = fast ? 327 : 321;
        api.onRegisterWrite(st, 0xd20f, 3);
        api.onRegisterWrite(st, 0xd208, audctl);
        api.onRegisterWrite(st, 0xd200 + lowChannel * 2, 0x40);
        api.onRegisterWrite(st, 0xd202 + lowChannel * 2, 1);
        api.onRegisterWrite(st, 0xd201 + lowChannel * 2, 0xaf);
        api.onRegisterWrite(st, 0xd203 + lowChannel * 2, 0xaf);
        api.onRegisterWrite(st, 0xd209, 0);
        const lowEdges = [], highEdges = [];
        let low = st.channels[lowChannel].output;
        let high = st.channels[lowChannel + 1].output;
        for (let cycle = 1; cycle <= 3 * period * base; cycle++) {
          api.sync(ctx, st, cycle);
          if (st.channels[lowChannel].output !== low) lowEdges.push(cycle);
          if (st.channels[lowChannel + 1].output !== high) highEdges.push(cycle);
          low = st.channels[lowChannel].output;
          high = st.channels[lowChannel + 1].output;
        }
        const expectedLow = [];
        for (let n = 0; n < 3; n++) {
          expectedLow.push((n * period + first) * base,
            (n * period + first + 256) * base);
        }
        assert.deepEqual(lowEdges, expectedLow, `low audio pulses AUDCTL=${audctl}`);
        assert.deepEqual(highEdges, [1, 2, 3].map(n => n * period * base));
      }
    }
  }
}

testLinkedAudioReloadsBothCounters();

testZeroIsTheMinimumValidDivisor();
testSerialClockModeSelection();
console.log("pokey_timer_period.test.js passed");
