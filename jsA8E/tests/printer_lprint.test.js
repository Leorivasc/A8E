/* global __dirname, console, process, require */

// The real OS P: handler printing through the SIO printer device: LPRINT and
// OPEN/PRINT from BASIC, checked against the paper model.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { createHeadlessAutomation } = require("../headless");

async function main() {
  const root = path.resolve(__dirname, "..");
  const osRom = path.join(root, "ATARIXL.ROM");
  const basicRom = path.join(root, "ATARIBAS.ROM");
  if (!fs.existsSync(osRom) || !fs.existsSync(basicRom)) {
    console.log("printer_lprint.test.js skipped (Atari OS/BASIC ROMs are unavailable).");
    return;
  }

  const paperContext = { window: {} };
  vm.createContext(paperContext);
  vm.runInContext(
    fs.readFileSync(path.join(root, "js", "app", "printer_paper.js"), "utf8"),
    paperContext,
  );
  const paper = paperContext.window.A8EPrinterPaper.createPaper();

  const runtime = await createHeadlessAutomation({
    roms: { os: osRom, basic: basicRom },
    turbo: true,
    frameDelayMs: 0,
  });
  runtime.app.onSioDeviceEvent(function (message) {
    if (message.device === 0x40) paper.add(message.event);
  });

  try {
    const api = runtime.api;
    await api.whenReady();
    await api.system.start();
    await api.system.waitForCycles({ count: 8000000, timeoutMs: 30000 });
    await api.input.typeText('LPRINT "HELLO FROM BASIC"\n', { interKeyDelayMs: 40 });
    await api.system.waitForCycles({ count: 4000000, timeoutMs: 30000 });
    await api.input.typeText('OPEN #1,8,0,"P:"\n', { interKeyDelayMs: 40 });
    await api.system.waitForCycles({ count: 4000000, timeoutMs: 30000 });
    await api.input.typeText('PRINT #1;"second line"\n', { interKeyDelayMs: 40 });
    await api.system.waitForCycles({ count: 4000000, timeoutMs: 30000 });
    await api.input.typeText("CLOSE #1\n", { interKeyDelayMs: 40 });
    await api.system.waitForCycles({ count: 4000000, timeoutMs: 30000 });

    // A line longer than the 40 byte frames the OS sends (here with a left
    // margin, as word processors print) reaches the paper as one line.
    const long = "          NUESTRAS SOBREESPECIALIZADAS VIDAS HAN LOGRADO, SEA MUCHO O";
    await api.input.typeText('LPRINT "' + long + '"\n', { interKeyDelayMs: 40 });
    await api.system.waitForCycles({ count: 6000000, timeoutMs: 30000 });

    const text = paper.toText();
    assert.ok(text.split("\n").includes(long), "long line joined by the 1025: " + JSON.stringify(text));
    assert.match(text, /^HELLO FROM BASIC$/m, "LPRINT reached the paper: " + JSON.stringify(text));
    assert.match(text, /^SECOND LINE$/m, "PRINT #1 reached the paper: " + JSON.stringify(text));
    console.log("printer_lprint.test.js passed");
  } finally {
    await runtime.dispose();
  }
}

main().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
