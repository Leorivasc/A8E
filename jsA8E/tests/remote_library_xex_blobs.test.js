/* global console, process, require */

// A converted XEX keeps its original bytes as a revision while the entry is
// exported as an ATR. The blob the first browser uploaded as `<sha>.xex` is
// then referenced as `<sha>.atr`; a third browser must still be able to pull it.
const assert = require("node:assert/strict");
const { loadContext, startServer, makeBrowser } = require("./remote_test_support.js");

function xex(seed) {
  const bytes = new Uint8Array(40);
  bytes.set([0xff, 0xff, 0x00, 0x06, 0x1f, 0x06]);
  for (let i = 6; i < bytes.length; i++) bytes[i] = (seed * 17 + i) & 255;
  return bytes;
}

function runtimeAtr(bytes) {
  const out = new Uint8Array(16 + 128 * 4);
  out.set([0x96, 0x02]);
  out.set(bytes, 16);
  return out;
}

async function main() {
  const context = loadContext();
  const api = context.window.A8ERemoteWorkspace;
  const remote = await startServer();
  try {
    const client = api.createClient({ url: remote.url, user: "leo", password: "secret" });
    await client.connect();
    const makeSync = function (library) {
      return context.window.A8ERemoteLibrary.createSync({ client: client, library: library, state: {} });
    };
    const options = { convertXex: runtimeAtr };
    const first = await makeBrowser(context, options);
    const second = await makeBrowser(context, options);
    const third = await makeBrowser(context, options);
    const syncFirst = makeSync(first);
    await syncFirst.prepare();

    // The first browser adds a plain XEX and publishes it as blobs/<sha>.xex.
    await first.addFile("BENCH.XEX", xex(1));
    await syncFirst.sync();
    assert.ok(Array.from(remote.files.keys()).some(function (name) { return name.endsWith(".xex"); }));

    // The second browser pulls it, runs it (converting it to an ATR) and syncs.
    const syncSecond = makeSync(second);
    await syncSecond.sync();
    const entry = second.listAllFiles()[0];
    await second.mountFile(entry.id, 0);
    await syncSecond.sync();

    // A third browser must be able to pull everything the manifest references.
    const report = await makeSync(third).sync();
    assert.equal(report.pulled, true);
    assert.equal(third.listAllFiles().length, 1);
    // The remote still holds the blob under its original .xex name only.
    const manifest = JSON.parse(remote.files.get("library.json").body.toString());
    const named = manifest.library[0].revisions.map(function (revision) { return revision.path; });
    assert.ok(named.some(function (name) { return name.endsWith(".atr") && !remote.files.has(name); }),
      "the manifest names an .atr blob the remote only stores as .xex");
    console.log("remote_library_xex_blobs.test.js passed");
  } finally {
    remote.server.close();
  }
  process.exit(0);
}

main().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
