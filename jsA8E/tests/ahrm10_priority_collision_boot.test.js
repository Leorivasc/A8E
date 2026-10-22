/* global __dirname, console, process, require */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHeadlessAutomation } = require("../headless");

async function main() {
  const root = path.resolve(__dirname, "../..");
  const romDir = fs.existsSync(path.join(root, "ATARIXL.ROM"))
    ? root
    : path.join(root, "A8E/build");
  const runtime = await createHeadlessAutomation({
    roms: {
      os: path.join(romDir, "ATARIXL.ROM"),
      basic: path.join(romDir, "ATARIBAS.ROM"),
    },
    turbo: true,
    skipRendering: false,
  });

  try {
    const api = runtime.api;
    const build = await api.dev.assembleSource({
      name: "AHRM10.ASM",
      text: fs.readFileSync(path.join(root, "implementation/AHRM/AHRM10_PRIORITY_COLLISION_TEST.asm"), "utf8"),
    });
    assert.ok(build.ok, build.error);
    const symbols = build.symbols;
    const bytes = fs.readFileSync(path.join(root, "implementation/AHRM/AHRM10_PRIORITY_COLLISION_TEST.XEX"));
    assert.deepEqual(Buffer.from(build.bytes), bytes);
    await api.dev.writeHostFile("AHRM10_P.XEX", { bytes });
    await api.debug.setBreakpoints(symbols.START);
    const launch = await api.dev.runXex({ hostFile: "AHRM10_P.XEX", awaitEntry: false });
    assert.ok(launch.ok, launch.phase);
    const entry = await api.debug.waitForBreakpoint({ timeoutMs: 30000 });
    assert.equal(entry.debugState.pc, symbols.START);
    const initialSp = entry.debugState.sp;

    async function stopAt(pc) {
      await api.debug.setBreakpoints(pc);
      await api.system.start();
      const stop = await api.debug.waitForBreakpoint({ timeoutMs: 10000 });
      assert.equal(stop.debugState.pc, pc);
      return stop.debugState;
    }

    const ready = await stopAt(symbols.WAIT);
    assert.equal(ready.sp, initialSp);
    assert.equal(await api.debug.readWord(0x0230), symbols.DISPLAY_LIST);
    assert.equal(await api.debug.readWord(0x0200), symbols.DLI_HANDLER);
    const title = await api.debug.readRange(symbols.SCREEN, "AHRM10 SPACE TEST".length);
    assert.deepEqual(Array.from(title), Array.from("AHRM10 SPACE TEST", (c) => c.charCodeAt(0) - 32));

    let collision = 0;
    for (let frame = 1; frame <= 24; frame++) {
      await stopAt(symbols.DLI_HANDLER);
      const returned = await stopAt(symbols.WAIT);
      assert.equal(returned.sp, initialSp);
      assert.equal(await api.debug.readMemory(symbols.PRIOR_TICKS), frame % 32);
      collision = await api.debug.readMemory(symbols.M0PL);
      if (collision & 0x02) break;
    }
    assert.ok(collision & 0x02, "missile 0 should collide with player 1");
    const hit = await api.debug.readRange(symbols.SCREEN + 70, 3);
    assert.deepEqual(Array.from(hit), Array.from("HIT", (c) => c.charCodeAt(0) - 32));

    await stopAt(symbols.DLI_HANDLER);
    for (let frame = 1; frame < 32; frame++) await stopAt(symbols.DLI_HANDLER);
    assert.equal(await api.debug.readMemory(symbols.PRIOR_VALUE), 0x01);
    const phase = await stopAt(symbols.WAIT);
    assert.equal(phase.sp, initialSp);
    console.log("ahrm10_priority_collision_boot: moving missile collision and priority phase verified.");
  } finally {
    await runtime.dispose();
  }
}

main().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
