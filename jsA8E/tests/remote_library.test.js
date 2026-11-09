/* global console, process, require */

// Full-library remote sync (Phase 2a): incremental blobs, merge by the
// existing non-destructive import, conflicts keep both variants.
const assert = require("node:assert/strict");
const { loadContext, startServer, makeBrowser } = require("./remote_test_support.js");

function blobCount(remote) {
  return Array.from(remote.files.keys()).filter(function (name) { return name.startsWith("blobs/"); }).length;
}

function atr(seed, size) {
  const bytes = new Uint8Array(size || 16);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (seed * 31 + i) & 255;
  return bytes;
}

async function main() {
  const context = loadContext();
  const api = context.window.A8ERemoteWorkspace;
  const remote = await startServer();
  try {
    const client = api.createClient({ url: remote.url, user: "leo", password: "secret" });
    await client.connect();
    function makeSync(library, state) {
      return context.window.A8ERemoteLibrary.createSync({ client: client, library: library, state: state || {} });
    }

    // The blobs/ folder is created on demand, and an existing one is accepted.
    const a = await makeBrowser(context);
    const b = await makeBrowser(context);
    const syncA = makeSync(a);
    await syncA.prepare();
    await syncA.prepare();
    assert.ok(remote.dirs.has("blobs/"));

    // A publishes unmounted disks too (full library, not just the workspace).
    const one = await a.addFile("ONE.ATR", atr(1));
    const two = await a.addFile("TWO.ATR", atr(2));
    let report = await syncA.sync();
    assert.equal(report.pushed, true);
    assert.equal(report.uploaded, 2);
    assert.ok(remote.files.has("library.json"));
    assert.equal(blobCount(remote), 2);

    // Nothing changed: no network write.
    const putsBefore = remote.stats.puts;
    report = await syncA.sync();
    assert.equal(report.pushed, false);
    assert.equal(remote.stats.puts, putsBefore);

    // B starts empty and downloads both blobs without a confirmation.
    const syncB = makeSync(b);
    report = await syncB.sync({ confirmMerge: function () { throw new Error("no confirmation expected"); } });
    assert.equal(report.pulled, true);
    assert.equal(report.pushed, false);
    assert.equal(report.downloaded, 2);
    assert.equal(b.listAllFiles().map(function (f) { return f.name; }).sort().join(","), "ONE.ATR,TWO.ATR");
    // Mounts are per browser and were not restored.
    assert.ok(b.listFiles("root").every(function (f) { return f.mountedSlot === -1; }));

    // Incremental: a third disk uploads exactly one new blob.
    await a.addFile("THREE.ATR", atr(3));
    report = await syncA.sync();
    assert.equal(report.uploaded, 1);
    assert.equal(blobCount(remote), 3);
    report = await syncB.sync();
    assert.equal(report.downloaded, 1);
    assert.equal(b.listAllFiles().length, 3);

    // A new revision transfers only that revision's blob.
    await a.replaceFile(one.id, "ONE.ATR", atr(11));
    report = await syncA.sync();
    assert.equal(report.uploaded, 1);
    report = await syncB.sync();
    assert.equal(report.downloaded, 1);
    assert.equal(b.listAllFiles().length, 3, "a newer descendant revision is not a conflict");

    // Concurrent edits to the same disk: 412 -> merge -> republish, both kept.
    await a.replaceFile(two.id, "TWO.ATR", atr(21));
    const bTwo = b.listAllFiles().find(function (f) { return f.name === "TWO.ATR"; });
    await b.replaceFile(bTwo.id, "TWO.ATR", atr(22));
    await syncA.sync();
    report = await syncB.sync();
    assert.equal(report.pulled, true);
    assert.equal(report.pushed, true);
    await syncA.sync();
    assert.equal(a.listAllFiles().length, 4);
    assert.equal(b.listAllFiles().length, 4);

    // First connection with data on both sides asks before merging.
    const c = await makeBrowser(context);
    await c.addFile("OWN.ATR", atr(40));
    const putsNow = remote.stats.puts;
    report = await makeSync(c).sync({ confirmMerge: function () { return false; } });
    assert.equal(report.canceled, true);
    assert.equal(remote.stats.puts, putsNow);
    assert.equal(c.listAllFiles().length, 1);

    // A corrupted remote blob is rejected instead of imported.
    const d = await makeBrowser(context);
    const blobName = Array.from(remote.files.keys()).find(function (name) { return name.startsWith("blobs/"); });
    remote.files.get(blobName).body = Buffer.from("tampered");
    await assert.rejects(makeSync(d).sync(), function (err) { return err.code === "corrupt-blob"; });
    assert.equal(d.listAllFiles().length, 0);
  } finally {
    remote.server.close();
  }
  console.log("remote library tests passed");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
