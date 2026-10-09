/* global __dirname, console, process, require */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadApis() {
  const context = {
    console: console,
    ArrayBuffer: ArrayBuffer,
    Uint8Array: Uint8Array,
    TextEncoder: TextEncoder,
    TextDecoder: TextDecoder,
    Date: Date,
    Math: Math,
    Map: Map,
    Set: Set,
    Error: Error,
    Number: Number,
    String: String,
    Object: Object,
    JSON: JSON,
    Promise: Promise,
  };
  context.window = context;
  context.self = context;
  vm.createContext(context);
  ["library_archive.js", "library_package.js"].forEach(function (file) {
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, "..", "js", "core", file), "utf8"),
      context,
      { filename: file },
    );
  });
  return {
    packageApi: context.window.A8ELibraryPackage.createApi(),
    archiveApi: context.window.A8ELibraryArchive.createApi(),
  };
}

async function main() {
  const apis = loadApis();
  const api = apis.packageApi;
  assert.equal(api.sha256(new Uint8Array()), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(api.sha256(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

  const records = [
    {
      id: "writer-disk",
      name: "atariwriter.atr",
      format: "atr",
      bytes: new Uint8Array([0x96, 0x02, 1, 2, 3]),
      created: Date.parse("2026-10-01T12:00:00Z"),
      modified: Date.parse("2026-10-08T14:45:12Z"),
      mountedSlot: 0,
    },
    {
      id: "docs-disk",
      name: "docs.atr",
      format: "atr",
      bytes: new Uint8Array([9, 8, 7]),
      created: Date.parse("2026-10-01T12:00:00Z"),
      modified: Date.parse("2026-10-08T14:46:12Z"),
      mountedSlot: 1,
    },
  ];
  const options = {
    libraryVersion: 7,
    createdAt: "2026-10-08T15:00:00Z",
    workspace: {
      devices: { D1: "writer-disk", D2: "docs-disk" },
      writeProtected: { D1: false, D2: false },
    },
  };
  const manifest = api.makeManifest(records, options);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.libraryVersion, 7);

  const exported = await api.exportPackage(records, options);
  const imported = await api.importPackage(exported.bytes);
  assert.equal(JSON.stringify(imported.manifest), JSON.stringify(manifest));
  assert.deepEqual(Array.from(imported.entries[0].bytes), [0x96, 0x02, 1, 2, 3]);
  assert.deepEqual(Array.from(imported.entries[1].bytes), [9, 8, 7]);

  const conflictPlan = api.planImport([
    {
      id: "writer-disk",
      name: "local.atr",
      format: "atr",
      bytes: new Uint8Array([4, 4, 4]),
    },
  ], imported);
  assert.equal(conflictPlan.summary.conflicts, 1);
  assert.equal(conflictPlan.summary.added, 2);

  const malformedManifest = Object.assign({}, manifest, {
    library: manifest.library.map(function (entry, index) {
      return Object.assign({}, entry, {
        path: "blobs/" + (index === 0 ? "0" : "1").repeat(64) + "." + entry.type,
        sha256: (index === 0 ? "0" : "1").repeat(64),
      });
    }),
  });
  const malformed = apis.archiveApi.write([
    { name: "library.json", bytes: new TextEncoder().encode(JSON.stringify(malformedManifest)) },
    { name: malformedManifest.library[0].path, bytes: records[0].bytes },
    { name: malformedManifest.library[1].path, bytes: records[1].bytes },
  ]);
  await assert.rejects(api.importPackage(malformed), /SHA-256 mismatch/);

  console.log("library_package.test.js passed");
}

main().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
