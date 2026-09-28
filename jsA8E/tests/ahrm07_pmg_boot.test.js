/* global __dirname, console, process, require */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHeadlessAutomation } = require("../headless");

// ROM-backed guest regression; run explicitly, separate from unit fixtures.
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
      name: "AHRM07.ASM",
      text: fs.readFileSync(path.join(root, "implementation/AHRM07_PMG_TEST.asm"), "utf8"),
    });
    assert.ok(build.ok, build.error);
    const symbols = build.symbols;
    const bytes = fs.readFileSync(path.join(root, "implementation/AHRM07_PMG_TEST.XEX"));
    assert.deepEqual(Buffer.from(build.bytes), bytes);
    await api.dev.writeHostFile("AHRM07_P.XEX", { bytes: bytes });
    await api.debug.setBreakpoints(symbols.START);
    // Boot through the normal frame runner. The cold OS boot exceeds the
    // runXex default four-million-cycle entry guard on this ROM.
    const launch = await api.dev.runXex({ hostFile: "AHRM07_P.XEX", awaitEntry: false });
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
    assert.equal(ready.sp, initialSp, "startup must balance the stack");
    assert.equal(await api.debug.readWord(0x0230), symbols.DISPLAY_LIST);
    assert.equal(await api.debug.readWord(0x0200), symbols.DLI_HANDLER);
    const title = await api.debug.readRange(symbols.SCREEN, "AHRM07 GTIA PMG TEST".length);
    assert.deepEqual(Array.from(title), Array.from("AHRM07 GTIA PMG TEST", (c) => c.charCodeAt(0) - 32));

    // Cross both 32-frame phase transitions and check every interrupt return.
    for (let frame = 1; frame <= 65; frame++) {
      await stopAt(symbols.DLI_HANDLER);
      const returned = await stopAt(symbols.WAIT);
      assert.equal(returned.sp, initialSp, "DLI must return with balanced stack");
      assert.equal(await api.debug.readMemory(symbols.PM_TICKS), frame % 32);
      assert.equal(await api.debug.readMemory(symbols.PM_PHASE), Math.floor(frame / 32) % 2);
      assert.equal(await api.debug.readMemory(symbols.COLLISION_STATE), 1);
    }
    const status = await api.debug.readRange(symbols.SCREEN + 160 + 17, 4);
    assert.deepEqual(Array.from(status), Array.from("PASS", (c) => c.charCodeAt(0) - 32));
    console.log("ahrm07_pmg_boot: HostFS boot, 65 DLI returns, both phases and collision PASS verified.");
  } finally {
    await runtime.dispose();
  }
}

main().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
