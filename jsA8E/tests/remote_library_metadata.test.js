/* global console, process, require */

// Phase 2b: renames and moves propagate (newest change wins) without
// duplicating folders or touching content.
const assert = require("node:assert/strict");
const { loadContext, startServer, makeBrowser } = require("./remote_test_support.js");

function atr(seed) {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (seed * 31 + i) & 255;
  return bytes;
}

const tick = function () { return new Promise(function (resolve) { setTimeout(resolve, 5); }); };
const folderNames = function (library) {
  return library.listAllFolders().filter(function (f) { return f.id !== "root"; })
    .map(function (f) { return f.name; }).sort().join(",");
};

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
    const folder = await a.createFolder("GAMES", "root");
    await syncA.sync();
    await syncB.sync();
    assert.equal(b.getFileInfo(x.id).folderId, "root");
    assert.equal(folderNames(b), "GAMES");

    // A move propagates and leaves the content alone.
    await tick();
    await a.moveFile(x.id, folder.id);
    await syncA.sync();
    let report = await syncB.sync();
    assert.equal(report.moved, 1);
    assert.equal(b.getFileInfo(x.id).folderId, folder.id);
    assert.equal(b.listAllFiles().length, 1, "no copy was created");
    report = await syncB.sync();
    assert.equal(report.pushed, false, "applying a remote move is not a local change");

    // A folder rename propagates without duplicating the folder.
    await tick();
    await a.renameFolder(folder.id, "ARCADE");
    await syncA.sync();
    await syncB.sync();
    assert.equal(folderNames(b), "ARCADE");

    // Rename + edit in the same sync round: still one folder, content fast-forwards.
    await tick();
    await a.renameFolder(folder.id, "CLASSICS");
    await a.replaceFile(x.id, "X.ATR", atr(2));
    await syncA.sync();
    await syncB.sync();
    assert.equal(folderNames(b), "CLASSICS");
    assert.equal(b.listAllFiles().length, 1);

    // The newest move wins: B moves back to root after A's move.
    await tick();
    await a.moveFile(x.id, "root");
    await tick();
    await b.moveFile(x.id, folder.id);
    await syncA.sync();
    await syncB.sync(); // B's move is newer than A's published move: B keeps it
    assert.equal(b.getFileInfo(x.id).folderId, folder.id);
    await syncA.sync();
    assert.equal(a.getFileInfo(x.id).folderId, folder.id, "the newest move reaches the other browser");
  } finally {
    remote.server.close();
  }
  console.log("remote library metadata tests passed");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
