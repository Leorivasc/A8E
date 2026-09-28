/* AHRM 5.7 / 5.8: a key updates KBCODE while masked, but must not leave a
 * keyboard IRQ pending for a later IRQEN write. */
const assert = require("node:assert/strict");
const path = require("node:path");
const { createHeadlessAutomation } = require("../headless");

async function getContext(runtime) {
  let ctx = null;
  runtime.app.setMemoryAccessHook(function (_, __, ___, ____, _____, ______, _______, context) {
    ctx = context;
  });
  await runtime.api.system.start();
  await runtime.api.system.waitForCycles({ count: 100, timeoutMs: 2000 });
  await runtime.api.system.pause();
  runtime.app.setMemoryAccessHook(null);
  assert.ok(ctx, "headless runtime did not expose its machine context");
  return ctx;
}

async function main() {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const runtime = await createHeadlessAutomation({
    turbo: true,
    roms: {
      os: path.join(repoRoot, "ATARIXL.ROM"),
      basic: path.join(repoRoot, "ATARIBAS.ROM"),
    },
  });
  try {
    const api = runtime.api;
    const ctx = await getContext(runtime);
    const IRQEN = 0xd20e;
    const KBCODE = 0xd209;
    const KEYBOARD_IRQ = 0x40;

    ctx.ram[IRQEN] = 0xff;
    ctx.sram[IRQEN] = 0x00;
    ctx.irqPending = 0;
    await api.input.keyDown({ key: "a", code: "KeyA", sourceToken: "masked-a" });
    await api.input.keyUp({ key: "a", code: "KeyA", sourceToken: "masked-a" });

    assert.notEqual(ctx.ram[KBCODE], 0x00, "masked key did not update KBCODE");
    assert.notEqual(ctx.ram[IRQEN] & KEYBOARD_IRQ, 0, "masked key latched keyboard IRQST");
    assert.equal(ctx.irqPending, 0, "masked key left a CPU IRQ pending");

    ctx.ram[IRQEN] = 0xff;
    ctx.sram[IRQEN] = KEYBOARD_IRQ;
    ctx.ioData.timer1Cycle = ctx.cycleCounter;
    await api.system.start();
    await api.system.waitForCycles({ count: 20, timeoutMs: 2000 });
    await api.system.pause();
    assert.notEqual(ctx.ram[IRQEN] & 0x01, 0, "masked timer latched IRQST");

    ctx.ram[IRQEN] = 0xff;
    ctx.sram[IRQEN] = KEYBOARD_IRQ;
    ctx.irqPending = 0;
    await api.input.keyDown({ key: "b", code: "KeyB", sourceToken: "enabled-b" });
    await api.input.keyUp({ key: "b", code: "KeyB", sourceToken: "enabled-b" });

    assert.equal(ctx.ram[IRQEN] & KEYBOARD_IRQ, 0, "enabled key did not latch keyboard IRQST");
    assert.equal(ctx.irqPending, 1, "enabled key did not assert the CPU IRQ");
    console.log("keyboard_irq_gate.test.js passed");
  } finally {
    await runtime.dispose();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
