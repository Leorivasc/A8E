/* global console, process, require */

// Exercises the remote workspace MVP against an in-process WebDAV-like server
// (ETag, If-Match, If-None-Match, Basic auth) and two independent libraries
// that stand for two browsers.
const assert = require("node:assert/strict");
const { loadContext, startServer, makeBrowser } = require("./remote_test_support.js");

// replaceFile ejects a mounted image, so remount it like the UI flow does.
async function edit(library, id, bytes) {
  await library.replaceFile(id, "DOC.ATR", new Uint8Array(bytes));
  await library.mountFile(id, 0);
}

function makeSync(context, remote, library, state, password) {
  const api = context.window.A8ERemoteWorkspace;
  const client = api.createClient({ url: remote.url, user: "leo", password: password || "secret" });
  return api.createSync({ client: client, library: library, state: state });
}

async function main() {
  const context = loadContext();
  const api = context.window.A8ERemoteWorkspace;

  // URL policy.
  assert.equal(api.normalizeUrl("https://example.org/dav"), "https://example.org/dav/");
  assert.equal(api.normalizeUrl("http://localhost:8080/x/"), "http://localhost:8080/x/");
  assert.throws(function () { api.normalizeUrl("http://example.org/dav/"); }, /HTTPS/);
  assert.throws(function () { api.normalizeUrl("https://u:p@example.org/"); }, /credentials/);
  assert.throws(function () { api.normalizeUrl("not a url"); }, /not valid/);

  const remote = await startServer();
  try {
    // Connection diagnostics.
    const bad = api.createClient({ url: remote.url, user: "leo", password: "wrong" });
    await assert.rejects(bad.connect(), function (err) { return err.code === "auth"; });
    const client = api.createClient({ url: remote.url, user: "leo", password: "secret" });
    const first = await client.connect();
    assert.equal(first.created, true);
    const again = await client.connect();
    assert.equal(again.created, false);
    assert.equal(again.repoId, first.repoId);
    remote.files.set("other/.a8e-remote.json", { body: Buffer.from("{}"), etag: "\"x\"" });
    const foreign = api.createClient({ url: remote.url + "other/", user: "leo", password: "secret" });
    await assert.rejects(foreign.connect(), function (err) { return err.code === "not-repository"; });

    // Browser A publishes a mounted disk.
    const a = await makeBrowser(context);
    const b = await makeBrowser(context);
    const disk = await a.addFile("DOC.ATR", new Uint8Array([1, 2, 3, 4]));
    await a.mountFile(disk.id, 0);
    let stateA = {};
    const syncA = makeSync(context, remote, a, stateA);
    let report = await syncA.sync();
    assert.equal(report.pushed, true);
    assert.ok(remote.files.has("workspace.a8e"));

    // Nothing changed: no further upload.
    const putsBefore = remote.stats.puts;
    report = await syncA.sync();
    assert.equal(report.pushed, false);
    assert.equal(remote.stats.puts, putsBefore);

    // Browser B starts empty and pulls it.
    const syncB = makeSync(context, remote, b, {});
    report = await syncB.sync();
    assert.equal(report.pulled, true);
    assert.equal(report.pushed, false);
    assert.equal(b.listAllFiles().length, 1);
    assert.equal(b.listAllFiles()[0].name, "DOC.ATR");

    // B edits; A receives the new revision.
    const bId = b.listAllFiles()[0].id;
    await edit(b, bId, [9, 9, 9, 9]);
    report = await syncB.sync();
    assert.equal(report.pushed, true);
    report = await syncA.sync();
    assert.equal(report.pulled, true);
    assert.equal(report.pushed, false);
    // A sequential edit fast-forwards: no conflict copy, still mounted in D1.
    assert.equal(a.listAllFiles().length, 1);
    assert.equal(a.listAllFiles()[0].bytes[0], 9);
    assert.equal(a.listFiles("root")[0].mountedSlot, 0);

    // Concurrent edits: A publishes first, B is rejected, merges, republishes.
    await edit(a, disk.id, [5, 5, 5, 5]);
    await edit(b, bId, [6, 6, 6, 6]);
    await syncA.sync();
    report = await syncB.sync();
    assert.equal(report.pulled, true);
    assert.equal(report.pushed, true);
    await syncA.sync();
    // The merging side keeps both variants (its own edit and a `(1)` copy of the
    // remote one); the remote workspace's mount wins. Only mounted disks travel,
    // so A receives B's republished mounted copy as a duplicate of its own.
    const bNames = b.listAllFiles().map(function (f) { return f.name + ":" + f.bytes[0]; }).sort().join(",");
    assert.equal(bNames, "DOC(1).ATR:5,DOC.ATR:6", "B must retain its own edit and the remote one");
    assert.equal(a.listAllFiles().length, 1);

    // First connection with data on both sides: a vetoed merge changes nothing.
    const putsNow = remote.stats.puts;
    const filesBefore = a.listAllFiles().length;
    const fresh = makeSync(context, remote, a, {});
    report = await fresh.sync({ confirmMerge: function () { return false; } });
    assert.equal(report.canceled, true);
    assert.equal(remote.stats.puts, putsNow);
    assert.equal(a.listAllFiles().length, filesBefore);
  } finally {
    remote.server.close();
  }

  // A server that does not expose ETag is diagnosed, not silently accepted.
  const noEtag = await startServer({ hideEtag: true });
  try {
    const client = api.createClient({ url: noEtag.url, user: "leo", password: "secret" });
    await assert.rejects(client.connect(), function (err) { return err.code === "no-etag"; });
  } finally {
    noEtag.server.close();
  }
  console.log("remote workspace tests passed");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
