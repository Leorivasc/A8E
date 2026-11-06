"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { createHeadlessAutomation } = require("../headless");

async function main() {
  const root = path.resolve(__dirname, "../..");
  const runtime = await createHeadlessAutomation({
    turbo: true,
    skipRendering: true,
    roms: {
      os: path.join(root, "A8E", "build", "ATARIXL.ROM"),
      basic: path.join(root, "A8E", "build", "ATARIBAS.ROM"),
    },
  });

  try {
    runtime.app.reset({ vbxe: "fx1.26r", memoryExpansion: "none" });
    let ctx = null;
    runtime.app.setMemoryAccessHook(function () {
      ctx = arguments[arguments.length - 1];
    });
    await runtime.api.system.start();
    const run = await runtime.api.system.waitForCycles({ count: 2000, timeoutMs: 10000 });
    assert.ok(run.ok, "the RAMBO bus harness should execute");
    await runtime.api.system.pause();
    assert.ok(ctx, "CPU execution should expose its context");

    const state = ctx.ioData.vbxe;
    const cpuWindow = ctx.accessFunctionList[0x4000];
    assert.equal(typeof cpuWindow, "function", "RAMBO installs a CPU bus handler");

    // PORTB D4 low enables RAMBO. With D6/D5/D3/D2 high, local $40000 is
    // selected; the CPU handler and ANTIC reader must see the same byte.
    ctx.sram[0xd301] = 0xef;
    ctx.accessAddress = 0x4000;
    cpuWindow(ctx, 0x5a);
    assert.equal(state.vram[0x40000], 0x5a);
    assert.equal(cpuWindow(ctx, null), 0x5a);
    assert.equal(ctx.ioData.memoryExpansionRead(ctx, 0x4000, true), 0x5a,
      "ANTIC shares the RAMBO bank selected by PORTB");

    // All four bank bits low select the final 16K at $7C000 independently.
    ctx.sram[0xd301] = 0x00;
    ctx.accessAddress = 0x7fff;
    cpuWindow(ctx, 0xa5);
    assert.equal(state.vram[0x7ffff], 0xa5);
    assert.equal(state.vram[0x40000], 0x5a, "RAMBO banks remain independent");

    // Disabling D4 returns the normal RAM path even though the handler stays
    // installed, so a later PORTB write can re-enable the direct window.
    ctx.sram[0xd301] = 0xff;
    ctx.ram[0x4000] = 0x33;
    ctx.accessAddress = 0x4000;
    assert.equal(cpuWindow(ctx, null), 0x33);
    assert.equal(state.vram[0x40000], 0x5a);
    console.log("vbxe_rambo_bus: CPU and ANTIC shared-memory window verified.");
  } finally {
    await runtime.dispose();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
