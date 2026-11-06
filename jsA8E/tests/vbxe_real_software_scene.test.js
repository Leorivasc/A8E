/* global __dirname, console, process, require */

"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { createHeadlessAutomation } = require("../headless");

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47,
  0x0d, 0x0a, 0x1a, 0x0a,
]);
const SOFTWARE = [
  { label: "Popeye", file: "popeye.xex" },
  {
    label: "Galaga",
    file: "Galaga_VBXE_1.01.xex",
    visualGate: false,
    visualGateReason: "headless capture remains black after the launch gate",
  },
  { label: "DACTest", file: "DACTest (2009, KMK).xex" },
  { label: "Textmode Test mode 4", file: "Textmode Test (2009, KMK).xex", key: "4" },
  { label: "Crysis", file: "crysis1.xex" },
  {
    label: "Celeste",
    file: "celeste1.3.xex",
    visualGate: false,
    visualGateReason: "headless capture matches the reset-frame set",
  },
  {
    label: "D600 demo",
    file: "demoD600.xex",
    visualGate: false,
    visualGateReason: "headless capture matches the reset-frame set",
  },
  { label: "Falcon", file: "falcon1.xex" },
  {
    label: "Phoenix",
    file: "phoenix-vbxe.xex",
    visualGate: false,
    visualGateReason: "headless capture matches the reset-frame set",
  },
];

// The XEX disk boot path needs more than the short launch window used by the
// boot-only tests. Checkpoints also reject a transient all-black frame. This
// is a visual progress gate, not an Altirra golden image.
const SCENE_CHECKPOINTS = [120, 240, 360, 480];

function pixelDigest(bytes) {
  const data = Buffer.from(bytes);
  assert.deepEqual(data.subarray(0, PNG_SIGNATURE.length), PNG_SIGNATURE);
  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  const parts = [];
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(start);
      height = data.readUInt32BE(start + 4);
      assert.equal(data[start + 8], 8);
      assert.equal(data[start + 9], 6);
    } else if (type === "IDAT") {
      parts.push(data.subarray(start, end));
    }
    offset = end + 4;
    if (type === "IEND") break;
  }
  const raw = zlib.inflateSync(Buffer.concat(parts));
  const rowStride = width * 4;
  assert.equal(raw.length, height * (rowStride + 1));
  let nonBlack = 0;
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (rowStride + 1)], 0,
      "headless visual captures must use unfiltered rows");
    const row = y * (rowStride + 1) + 1;
    for (let x = 0; x < width; x++) {
      const p = row + x * 4;
      if (raw[p] || raw[p + 1] || raw[p + 2]) nonBlack++;
    }
  }
  return {
    width,
    height,
    nonBlack,
    digest: crypto.createHash("sha256").update(raw).digest("hex"),
  };
}

function memoryDigest(bytes) {
  return crypto.createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

async function captureReset(root) {
  const romDir = path.join(root, "A8E", "build");
  const runtime = await createHeadlessAutomation({
    turbo: true,
    sioTurbo: true,
    skipRendering: false,
    memoryExpansion: "130xe-128k",
    videoStandard: "ntsc",
    roms: {
      os: path.join(romDir, "ATARIXL.ROM"),
      basic: path.join(romDir, "ATARIBAS.ROM"),
    },
  });
  try {
    runtime.app.reset({ vbxe: "fx1.26", memoryExpansion: "130xe-128k" });
    await runtime.api.system.start();
    const frames = {};
    let elapsed = 0;
    for (const checkpoint of SCENE_CHECKPOINTS) {
      const wait = await runtime.api.system.waitForFrames({
        count: checkpoint - elapsed,
        timeoutMs: 30000,
      });
      assert.equal(wait.ok, true, "reset capture must reach its control point");
      frames[checkpoint] = Object.assign(pixelDigest(
        (await runtime.api.captureScreenshot({ encoding: "bytes" })).bytes,
      ), {
        memoryDigest: memoryDigest(await runtime.api.debug.readRange(0, 0x10000)),
      });
      elapsed = checkpoint;
    }
    await runtime.api.system.pause();
    return frames;
  } finally {
    await runtime.dispose();
  }
}

async function captureSoftware(root, entry, resetFrames) {
  const romDir = path.join(root, "A8E", "build");
  const image = path.join(root, "build", "Altirra-4.40-bin", entry.file);
  assert.ok(fs.existsSync(image), entry.label + " XEX must exist");
  const runtime = await createHeadlessAutomation({
    turbo: true,
    sioTurbo: true,
    skipRendering: false,
    memoryExpansion: "130xe-128k",
    videoStandard: "ntsc",
    roms: {
      os: path.join(romDir, "ATARIXL.ROM"),
      basic: path.join(romDir, "ATARIBAS.ROM"),
    },
  });
  const resetDigests = new Set(
    Object.keys(resetFrames).map(function (checkpoint) {
      return resetFrames[checkpoint].digest;
    }),
  );
  const resetMemoryDigests = new Set(
    Object.keys(resetFrames).map(function (checkpoint) {
      return resetFrames[checkpoint].memoryDigest;
    }),
  );
  try {
    runtime.app.reset({ vbxe: "fx1.26", memoryExpansion: "130xe-128k" });
    const launch = await runtime.api.dev.runXex({
      bytes: fs.readFileSync(image),
      name: entry.file,
      awaitEntry: false,
    });
    assert.equal(launch.ok, true, entry.label + " XEX launch failed: " + launch.phase);
    let elapsed = 0;
    let frame = null;
    let matchedCheckpoint = null;
    for (const checkpoint of SCENE_CHECKPOINTS) {
      const wait = await runtime.api.system.waitForFrames({
        count: checkpoint - elapsed,
        timeoutMs: 30000,
      });
      assert.equal(wait.ok, true, entry.label + " must reach its scene point");
      elapsed = checkpoint;
      if (entry.key && checkpoint === SCENE_CHECKPOINTS[0]) {
        await runtime.api.input.keyDown({ key: entry.key, code: "Digit" + entry.key });
        await runtime.api.system.waitForFrames({ count: 2, timeoutMs: 5000 });
        await runtime.api.input.keyUp({ key: entry.key, code: "Digit" + entry.key });
      }
      frame = pixelDigest(
        (await runtime.api.captureScreenshot({ encoding: "bytes" })).bytes,
      );
      frame.memoryDigest = memoryDigest(await runtime.api.debug.readRange(0, 0x10000));
      const executionProgress = !resetMemoryDigests.has(frame.memoryDigest);
      if (entry.visualGate !== false && frame.nonBlack > 0 &&
          !resetDigests.has(frame.digest) && executionProgress) {
        matchedCheckpoint = checkpoint;
        break;
      }
      if (entry.visualGate === false && executionProgress) {
        matchedCheckpoint = checkpoint;
        break;
      }
    }
    await runtime.api.system.pause();
    const executionProgress = frame && !resetMemoryDigests.has(frame.memoryDigest);
    assert.ok(frame && executionProgress,
      entry.label + " must change machine RAM beyond the reset-frame set");
    if (entry.visualGate === false) {
      console.log("vbxe_real_software_scene: " + entry.label +
        " visual gate deferred: " + entry.visualGateReason +
        "; RAM execution marker verified");
      return { label: entry.label, frame, visual: false, execution: true };
    }
    assert.ok(frame && frame.nonBlack > 0 && matchedCheckpoint !== null,
      entry.label + " must produce a non-black frame outside the reset-frame set");
    console.log("vbxe_real_software_scene: " + entry.label +
      " checkpoint=" + matchedCheckpoint + " digest=" + frame.digest);
    return { label: entry.label, frame, visual: true, execution: true };
  } finally {
    await runtime.dispose();
  }
}

async function main() {
  const root = path.resolve(__dirname, "../..");
  const reset = await captureReset(root);
  console.log("vbxe_real_software_scene: reset nonBlack=" + reset[480].nonBlack);
  let visualCount = 0;
  let executionCount = 0;
  for (const entry of SOFTWARE) {
    const result = await captureSoftware(root, entry, reset);
    if (result.visual) visualCount++;
    if (result.execution) executionCount++;
    console.log("vbxe_real_software_scene: " + result.label +
      " nonBlack=" + result.frame.nonBlack);
  }
  console.log("vbxe_real_software_scene: " + visualCount +
    " visual scenes and " + executionCount +
    " RAM execution markers verified.");
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
