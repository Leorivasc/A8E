"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { createHeadlessAutomation } = require("../headless");

// Software can run code from a MEMAC window (Popeye executes its game code
// from a window onto VBXE memory). Instruction fetch must read the mapped
// VRAM, not the RAM underneath the window.
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
    await runtime.api.system.waitForCycles({ count: 2000, timeoutMs: 10000 });
    await runtime.api.system.pause();
    assert.ok(ctx, "CPU execution should expose its context");

    const vbxe = ctx.ioData.vbxe;
    const page = vbxe.page;
    function write(address, value) {
      ctx.accessAddress = address;
      ctx.accessFunctionList[address](ctx, value);
    }

    // MEMAC A: 4K window at $A000 (CPU enabled) onto VRAM $00000.
    write(page + 0x1e, 0xa8);
    write(page + 0x1f, 0x80);
    // LDA #$42 / STA $0600 / JMP $A007 (spin) located in VRAM, not in RAM.
    const program = [0xa9, 0x42, 0x8d, 0x00, 0x06, 0x4c, 0x05, 0xa0];
    for (let i = 0; i < program.length; i++) vbxe.vram[i] = program[i];
    assert.notEqual(ctx.ram[0xa000], 0xa9, "RAM under the window must differ from the program");
    ctx.ram[0x0600] = 0;
    ctx.cpu.pc = 0xa000;

    await runtime.api.system.start();
    await runtime.api.system.waitForCycles({ count: 400, timeoutMs: 10000 });
    await runtime.api.system.pause();

    assert.equal(ctx.ram[0x0600], 0x42, "code in the MEMAC window should execute from VRAM");
    assert.ok(ctx.cpu.pc >= 0xa005 && ctx.cpu.pc <= 0xa007, "program should be spinning in the window");
    assert.notEqual(ctx.ram[0xa000], 0xa9, "staging must not leave window bytes in RAM");
    console.log("vbxe_memac_code_fetch: instructions execute from a MEMAC window.");
  } finally {
    await runtime.dispose();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
