/* global __dirname, console, require */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const CYCLES_PER_LINE = 114;
const CYCLE_NEVER = Number.POSITIVE_INFINITY;
const IO_AUDF1_POT0 = 0xd200;
const IO_AUDCTL_ALLPOT = 0xd208;
const IO_POTGO = 0xd20b;
const IO_SKCTL_SKSTAT = 0xd20f;

function loadApis() {
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
    createApi: function () {
      return {
        seroutWrite: function () {},
        serinRead: function () { return 0; },
      };
    },
  };
  vm.createContext(context);
  for (const rel of ["js/core/cpu_tables.js", "js/core/cpu.js", "js/core/pokey.js", "js/core/io.js"]) {
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, "..", rel), "utf8"),
      context,
      { filename: rel },
    );
  }

  const pokey = context.A8EPokeyAudio.createApi({
    ATARI_CPU_HZ_PAL: 1773447,
    CYCLES_PER_LINE: CYCLES_PER_LINE,
    POKEY_AUDIO_MAX_CATCHUP_CYCLES: 0,
    IO_AUDF1_POT0: IO_AUDF1_POT0,
    IO_AUDC1_POT1: 0xd201,
    IO_AUDF2_POT2: 0xd202,
    IO_AUDC2_POT3: 0xd203,
    IO_AUDF3_POT4: 0xd204,
    IO_AUDC3_POT5: 0xd205,
    IO_AUDF4_POT6: 0xd206,
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
  const io = context.A8EIo.createApi({
    CPU: context.A8E6502,
    CYCLES_PER_LINE: CYCLES_PER_LINE,
    CYCLE_NEVER: CYCLE_NEVER,
    IO_AUDC1_POT1: 0xd201,
    IO_AUDC2_POT3: 0xd203,
    IO_AUDC3_POT5: 0xd205,
    IO_AUDC4_POT7: 0xd207,
    IO_AUDCTL_ALLPOT: IO_AUDCTL_ALLPOT,
    IO_AUDF1_POT0: IO_AUDF1_POT0,
    IO_AUDF2_POT2: 0xd202,
    IO_AUDF3_POT4: 0xd204,
    IO_AUDF4_POT6: 0xd206,
    IO_POTGO: IO_POTGO,
    IO_SEROUT_SERIN: 0xd20d,
    IO_SKCTL_SKSTAT: IO_SKCTL_SKSTAT,
    IO_STIMER_KBCODE: 0xd209,
    pokeyPotPrepareSkctlWrite: pokey.potPrepareSkctlWrite,
    pokeyPotStartScan: pokey.potStartScan,
    pokeyPotUpdate: pokey.potUpdate,
    pokeyPotReadValue: pokey.potReadValue,
    pokeyRestartTimers: pokey.restartTimers,
    pokeyArmInactiveTimers: pokey.armInactiveTimers,
    pokeySyncLfsr17: pokey.syncLfsr17,
    pokeySeroutWrite: pokey.seroutWrite,
    pokeySerinRead: pokey.serinRead,
    IO_PORTA: 0xd300,
    IO_PORTB: 0xd301,
    IO_PACTL: 0xd302,
    IO_PBCTL: 0xd303,
  });
  return { CPU: context.A8E6502, ioAccess: io.ioAccess };
}

function main() {
  const api = loadApis();
  const ctx = api.CPU.makeContext();
  ctx.ioData = {
    pokeyPotValues: new Uint8Array([229, 229, 229, 229, 229, 229, 229, 229]),
    pokeyPotLatched: new Uint8Array(8),
    pokeyPotScanLastCycle: 0,
    pokeyPotScanTerminalCycle: CYCLE_NEVER,
    pokeyPotCounter: 0,
    pokeyPotScanActive: false,
    sioOutIndex: 0,
    sioOutPhase: 0,
    sioDataIndex: 0,
    sioInSize: 0,
    sioInIndex: 0,
    sioPendingReadSize: 0,
  };
  ctx.accessFunctionList.fill(undefined);
  api.CPU.setRam(ctx, 0x0000, 0xffff);
  api.CPU.setRom(ctx, 0xd000, 0xd7ff);
  for (const address of [
    IO_AUDF1_POT0, IO_AUDCTL_ALLPOT, IO_POTGO, IO_SKCTL_SKSTAT,
  ]) api.CPU.setIo(ctx, address, api.ioAccess);

  // LDA #3; STA SKCTL; LDA #0; STA POTGO; poll ALLPOT; save POT0.
  const program = [
    0xa9, 0x03, 0x8d, 0x0f, 0xd2,
    0xa9, 0x00, 0x8d, 0x0b, 0xd2,
    0xad, 0x08, 0xd2, 0xd0, 0xfb,
    0xad, 0x00, 0xd2, 0x8d, 0x00, 0x21,
    0x4c, 0x15, 0x20,
  ];
  ctx.ram.set(program, 0x2000);
  ctx.cpu.pc = 0x2000;
  ctx.cpu.ps = 0x04;
  api.CPU.run(ctx, 100000);

  assert.equal(ctx.ioData.pokeyPotScanActive, false);
  assert.equal(ctx.ram[0x2100], 228);
  console.log("pokey_pot_cpu_dispatch.test.js passed");
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
