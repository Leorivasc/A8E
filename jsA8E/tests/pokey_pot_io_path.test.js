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
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "js", "core", "pokey.js"), "utf8"),
    context,
    { filename: "pokey.js" },
  );
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "js", "core", "io.js"), "utf8"),
    context,
    { filename: "io.js" },
  );

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
    CPU: {},
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
  return { ioAccess: io.ioAccess };
}

function main() {
  const api = loadApis();
  const ctx = {
    accessAddress: 0,
    cycleCounter: 0,
    cpu: { pc: 0 },
    ram: new Uint8Array(0x10000),
    sram: new Uint8Array(0x10000),
    ioData: {
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
    },
  };

  function write(address, value) {
    ctx.accessAddress = address;
    api.ioAccess(ctx, value);
  }

  function read(address) {
    ctx.accessAddress = address;
    return api.ioAccess(ctx);
  }

  write(IO_SKCTL_SKSTAT, 0x03);
  write(IO_POTGO, 0x00);
  for (let cycle = 0; cycle <= CYCLES_PER_LINE * 228 + 1; cycle++) {
    ctx.cycleCounter = cycle;
    read(IO_AUDCTL_ALLPOT);
  }

  assert.equal(ctx.ioData.pokeyPotScanActive, false);
  assert.equal(read(IO_AUDCTL_ALLPOT), 0x00);
  assert.equal(read(IO_AUDF1_POT0), 228);
  console.log("pokey_pot_io_path.test.js passed");
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
