/* global console, process, require */

// Phase 2b: deletions propagate through tombstones without ever beating a
// later edit, and only move entries to the local trash.
const assert = require("node:assert/strict");
const { loadContext, startServer, makeBrowser } = require("./remote_test_support.js");

function atr(seed) {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (seed * 31 + i) & 255;
  return bytes;
}

const tick = function () { return new Promise(function (resolve) { setTimeout(resolve, 5); }); };
const names = function (library) { return library.listAllFiles().map(function (f) { return f.name; }).sort().join(","); };

async function main() {
  const context = loadContext();
  const remote = await startServer();
  try {
    const client = context.window.A8ERemoteWorkspace.createClient({ url: remote.url, user: "leo", password: "secret" });
    await client.connect();
    const makeSync = function (library) {
      return context.window.A8ERemoteLibrary.createSync({ client: client, library: library, state: {} });
    };
    const a = await makeBrowser(context);
    const b = await makeBrowser(context);
    const syncA = makeSync(a);
    const syncB = makeSync(b);
    await syncA.prepare();

    const x = await a.addFile("X.ATR", atr(1));
    const y = await a.addFile("Y.ATR", atr(2));
    await syncA.sync();
    await syncB.sync();
    assert.equal(names(b), "X.ATR,Y.ATR");

    // A deletion propagates to the trash of the other browser, not to a purge.
    await tick();
    await a.deleteFile(x.id);
    let report = await syncA.sync();
    assert.equal(report.pushed, true);
    assert.equal(JSON.parse(remote.files.get("library.json").body.toString()).tombstones.length, 1);
    report = await syncB.sync();
    assert.equal(report.deleted, 1);
    assert.equal(names(b), "Y.ATR");
    assert.equal(b.listTrash().map(function (t) { return t.name; }).join(","), "X.ATR");

    // It does not come back, and nobody re-uploads it.
    report = await syncB.sync();
    assert.equal(report.pushed, false);
    await syncA.sync();
    assert.equal(names(a), "Y.ATR");

    // A newer edit beats the deletion: A deletes Y, B edits it, B's edit survives.
    await tick();
    await a.deleteFile(y.id);
    const bY = b.listAllFiles().find(function (f) { return f.name === "Y.ATR"; });
    await b.replaceFile(bY.id, "Y.ATR", atr(22));
    await syncA.sync();
    report = await syncB.sync();
    assert.equal(report.deleted, 0);
    assert.equal(names(b), "Y.ATR", "the edited copy is kept");
    await syncA.sync();
    assert.equal(names(a), "Y.ATR", "the edit resurrects the entry on the deleter");
    assert.equal(a.listTrash().length, 1, "only the older X copy remains in the trash");
    assert.equal((await a.getManifest()).tombstones.length, 1);

    // Restoring from the trash outranks the deletion everywhere.
    const trashed = b.listTrash()[0];
    await tick();
    await b.restoreTrash(trashed.id);
    assert.equal(names(b), "X.ATR,Y.ATR");
    await syncB.sync();
    await syncA.sync();
    assert.equal(names(a), "X.ATR,Y.ATR");

    // Purging the trash keeps the tombstone, so the entry stays deleted.
    await tick();
    await a.deleteFile(a.listAllFiles().find(function (f) { return f.name === "X.ATR"; }).id);
    await a.purgeAllTrash();
    await syncA.sync();
    await syncB.sync();
    assert.equal(names(b), "Y.ATR");

    // Remote cleanup: unreferenced blobs go, young ones are protected, referenced ones stay.
    const blobsBefore = Array.from(remote.files.keys()).filter(function (n) { return n.startsWith("blobs/"); }).length;
    let gc = await syncA.collectGarbage();
    assert.equal(gc.deleted, 0);
    assert.ok(gc.young >= 1, "fresh blobs are not removed");
    gc = await syncA.collectGarbage({ minAgeMs: 0 });
    assert.ok(gc.deleted >= 1);
    const blobsAfter = Array.from(remote.files.keys()).filter(function (n) { return n.startsWith("blobs/"); }).length;
    assert.equal(blobsAfter, blobsBefore - gc.deleted);
    const manifest = JSON.parse(remote.files.get("library.json").body.toString());
    for (const entry of manifest.library) {
      assert.ok(remote.files.has(entry.path), "referenced blob " + entry.path + " is kept");
      for (const revision of entry.revisions || []) assert.ok(remote.files.has(revision.path));
    }
    await syncB.sync();
    assert.equal(names(b), "Y.ATR");

    // Folder deletions follow the same path.
    const folder = await a.createFolder("GAMES", "root");
    await syncA.sync();
    await syncB.sync();
    assert.ok(b.listFolders("root").some(function (f) { return f.name === "GAMES"; }));
    await a.deleteFolder(folder.id);
    await syncA.sync();
    await syncB.sync();
    assert.ok(!b.listFolders("root").some(function (f) { return f.name === "GAMES"; }));
  } finally {
    remote.server.close();
  }
  console.log("remote library tombstone tests passed");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
