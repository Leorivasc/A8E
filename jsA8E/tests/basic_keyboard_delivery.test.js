/* ROM-backed regression for the OS IRQ dispatcher. Disabled POKEY timers
 * must not starve the enabled keyboard IRQ before Atari BASIC sees it. */
const assert = require("node:assert/strict");
const path = require("node:path");
const { createHeadlessAutomation } = require("../headless");

async function main() {
  const root = path.resolve(__dirname, "..", "..");
  const runtime = await createHeadlessAutomation({
    turbo: true,
    roms: {
      os: path.join(root, "ATARIXL.ROM"),
      basic: path.join(root, "ATARIBAS.ROM"),
    },
  });
  try {
    const api = runtime.api;
    let ctx = null;
    runtime.app.setMemoryAccessHook(function (_, __, ___, ____, _____, ______, _______, context) {
      ctx = context;
    });
    await api.system.start();
    await api.system.waitForCycles({ count: 8000000, timeoutMs: 15000 });
    await api.system.pause();
    assert.ok(ctx, "headless runtime did not expose its machine context");

    const screen = ctx.ram[0x58] | (ctx.ram[0x59] << 8);
    const cursor = screen + 82;
    const before = ctx.ram[cursor];
    await api.input.keyDown({ key: "a", code: "KeyA", sourceToken: "basic-a" });
    await api.input.keyUp({ key: "a", code: "KeyA", sourceToken: "basic-a" });
    await api.system.start();
    await api.system.waitForCycles({ count: 1000000, timeoutMs: 5000 });
    await api.system.pause();

    assert.notEqual(ctx.ram[cursor], before, "Atari BASIC did not receive keyboard input");
    console.log("basic_keyboard_delivery.test.js passed");
  } finally {
    await runtime.dispose();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
