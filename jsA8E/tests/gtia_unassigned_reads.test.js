"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { createHeadlessAutomation } = require("../headless");

// AHRM 6.1: GTIA drives every data bit on reads, and the unassigned
// registers $D015-$D01E return $0F. Popeye probes $D01C/$D01D and takes a
// different path when they read back with bit 7 set.
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
    let ctx = null;
    runtime.app.setMemoryAccessHook(function () {
      ctx = arguments[arguments.length - 1];
    });
    await runtime.api.system.start();
    await runtime.api.system.waitForCycles({ count: 3000, timeoutMs: 10000 });
    await runtime.api.system.pause();
    assert.ok(ctx, "CPU execution should expose its context");

    function read(address) {
      ctx.accessAddress = address;
      return ctx.accessFunctionList[address](ctx, null) & 0xff;
    }
    for (let address = 0xd015; address <= 0xd01e; address++) {
      assert.equal(read(address), 0x0f, "$" + address.toString(16) + " reads $0F");
    }
    // Writing a GTIA register must not change what it reads back.
    ctx.accessAddress = 0xd01d;
    ctx.accessFunctionList[0xd01d](ctx, 0x80);
    assert.equal(read(0xd01d), 0x0f, "GRACTL reads $0F after a write");
    console.log("gtia_unassigned_reads: $D015-$D01E read $0F.");
  } finally {
    await runtime.dispose();
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
