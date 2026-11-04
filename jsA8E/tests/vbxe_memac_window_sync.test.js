"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { createHeadlessAutomation } = require("../headless");

// Regression for two MEMAC window-remap faults that silently lost CPU writes:
//  1. RAM addresses mapped to the VBXE window stayed routed through the I/O
//     handler after MEMAC was disabled, so writes reached the write-only
//     register shadow instead of RAM.
//  2. A MEMAC register write rebuilt the whole memory map and reloaded RAM
//     hidden under ROM from a stale copy, discarding bytes written while the
//     OS ROM was disabled.
async function main() {
  const root = path.resolve(__dirname, "../..");
  const runtime = await createHeadlessAutomation({
    turbo: true,
    skipRendering: true,
    memoryExpansion: "130xe-128k",
    roms: {
      os: path.join(root, "A8E", "build", "ATARIXL.ROM"),
      basic: path.join(root, "A8E", "build", "ATARIBAS.ROM"),
    },
  });

  try {
    runtime.app.reset({ vbxe: "fx1.26", memoryExpansion: "130xe-128k" });
    let ctx = null;
    runtime.app.setMemoryAccessHook(function () {
      ctx = arguments[arguments.length - 1];
    });
    await runtime.api.system.start();
    const run = await runtime.api.system.waitForCycles({ count: 2000, timeoutMs: 10000 });
    assert.ok(run.ok, "the harness should execute");
    await runtime.api.system.pause();
    assert.ok(ctx, "CPU execution should expose its context");

    const vbxe = ctx.ioData.vbxe;
    const page = vbxe.page;
    const MEMAC_B_CONTROL = page + 0x1d;
    const MEMAC_CONTROL = page + 0x1e;
    const MEMAC_BANK_SEL = page + 0x1f;

    // Issue a CPU-style bus access through the installed handler.
    function write(address, value) {
      ctx.accessAddress = address;
      ctx.accessFunctionList[address](ctx, value);
    }
    function read(address) {
      ctx.accessAddress = address;
      return ctx.accessFunctionList[address](ctx, null) & 0xff;
    }

    // 1. MEMAC B routes $4000 to VBXE local memory, and disabling it must
    // return the address to plain RAM.
    write(MEMAC_B_CONTROL, 0x80 | 0x10);
    write(0x4000, 0x6b);
    assert.equal(vbxe.vram[0x40000], 0x6b, "enabled MEMAC B writes VBXE memory");
    write(MEMAC_B_CONTROL, 0x00);
    write(0x4000, 0x5a);
    assert.equal(read(0x4000), 0x5a, "disabled MEMAC B reads back the RAM write");
    assert.equal(ctx.ram[0x4000], 0x5a, "disabled MEMAC B writes reach RAM");
    assert.equal(vbxe.vram[0x40000], 0x6b, "disabled MEMAC B leaves VBXE memory alone");

    // 2. Bytes written to RAM under the OS ROM must survive MEMAC register
    // writes, which only move windows.
    write(0xd303, 0x38); // PBCTL: select the data direction register
    write(0xd301, 0xff); // all PORTB bits are outputs
    write(0xd303, 0x3c); // PBCTL: select the output register
    write(0xd301, 0xfe); // OS ROM off, BASIC off
    assert.equal(ctx.sram[0xd301] & 0x01, 0, "PORTB must disable the OS ROM");
    write(0xd800, 0xa7);
    write(0xc000, 0x3c);
    write(0xffff, 0x99);
    write(MEMAC_CONTROL, 0x58);
    write(MEMAC_BANK_SEL, 0xd0);
    write(MEMAC_CONTROL, 0x00);
    write(MEMAC_BANK_SEL, 0x00);
    assert.equal(ctx.ram[0xd800], 0xa7, "RAM under FP ROM survives MEMAC writes");
    assert.equal(ctx.ram[0xc000], 0x3c, "RAM under OS ROM survives MEMAC writes");
    assert.equal(ctx.ram[0xffff], 0x99, "RAM under the vectors survives MEMAC writes");

    console.log("vbxe_memac_window_sync: MEMAC remap preserves RAM writes.");
  } finally {
    await runtime.dispose();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
