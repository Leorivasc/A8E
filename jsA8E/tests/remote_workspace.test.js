/* global __dirname, console, process, require, setTimeout, clearTimeout */

// Exercises the remote workspace MVP against an in-process WebDAV-like server
// (ETag, If-Match, If-None-Match, Basic auth) and two independent libraries
// that stand for two browsers.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

function loadContext() {
  const context = {
    console, setTimeout, clearTimeout, Promise, Uint8Array, ArrayBuffer, Date, Math, Object,
    String, Number, Boolean, TextEncoder, TextDecoder, Map, Set, Error, JSON, URL, btoa,
    Array, RegExp, Symbol, fetch,
  };
  context.window = context;
  context.self = context;
  context.globalThis = context;
  vm.createContext(context);
  [["core", "library_archive.js"], ["core", "library_package.js"], ["core", "atr_inspector.js"],
    ["core", "disk_library.js"], ["app", "remote_workspace.js"]].forEach(function (parts) {
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, "..", "js", parts[0], parts[1]), "utf8"),
      context, { filename: parts[1] });
  });
  return context;
}

function startServer(options) {
  const files = new Map();
  const stats = { puts: 0, gets: 0 };
  let counter = 0;
  const server = http.createServer(function (req, res) {
    const name = decodeURIComponent(req.url.replace(/^\/dav\//, ""));
    const expected = "Basic " + Buffer.from("leo:secret").toString("base64");
    if (req.headers.authorization !== expected) { res.writeHead(401); res.end(); return; }
    const chunks = [];
    req.on("data", function (chunk) { chunks.push(chunk); });
    req.on("end", function () {
      const body = Buffer.concat(chunks);
      const current = files.get(name);
      const headers = options && options.hideEtag ? {} : (current ? { ETag: current.etag } : {});
      if (req.method === "GET" || req.method === "HEAD") {
        stats.gets++;
        if (!current) { res.writeHead(404); res.end(); return; }
        if (req.headers["if-none-match"] === current.etag) { res.writeHead(304, headers); res.end(); return; }
        res.writeHead(200, headers); res.end(req.method === "GET" ? current.body : undefined); return;
      }
      if (req.method === "PUT") {
        stats.puts++;
        if (req.headers["if-match"] && (!current || req.headers["if-match"] !== current.etag)) {
          res.writeHead(412); res.end(); return;
        }
        if (req.headers["if-none-match"] === "*" && current) { res.writeHead(412); res.end(); return; }
        const etag = "\"" + (++counter) + "-" + crypto.createHash("md5").update(body).digest("hex") + "\"";
        files.set(name, { body: body, etag: etag });
        res.writeHead(current ? 204 : 201, options && options.hideEtag ? {} : { ETag: etag });
        res.end(); return;
      }
      res.writeHead(405); res.end();
    });
  });
  return new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", function () {
      resolve({ server: server, files: files, stats: stats,
        url: "http://127.0.0.1:" + server.address().port + "/dav/" });
    });
  });
}

async function makeBrowser(context) {
  const mounted = new Map();
  let next = 0;
  const library = context.window.A8EDiskLibrary.createApi().create({
    mountDisk: function (bytes, name, slot) {
      const imageIndex = next++;
      mounted.set(slot, { imageIndex: imageIndex, bytes: new Uint8Array(bytes) });
      return { imageIndex: imageIndex, deviceSlot: slot };
    },
    unmountDisk: function (slot) { mounted.delete(slot); },
    getDiskImageBytes: function (imageIndex) {
      for (const item of mounted.values()) if (item.imageIndex === imageIndex) return item.bytes;
      return null;
    },
  });
  await library.init();
  await library.restoreMounts();
  return library;
}

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

    // Concurrent edits: A publishes first, B is rejected, merges, republishes.
    await edit(a, disk.id, [5, 5, 5, 5]);
    await edit(b, bId, [6, 6, 6, 6]);
    await syncA.sync();
    report = await syncB.sync();
    assert.equal(report.pulled, true);
    assert.equal(report.pushed, true);
    await syncA.sync();
    // The library's keep-both policy preserves the divergent variant as a
    // separate entry on each side; nothing is lost.
    assert.equal(a.listAllFiles().length, 2, "A keeps its own and B's divergent disk");
    assert.equal(b.listAllFiles().length, 2, "B keeps its own and A's divergent disk");

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
