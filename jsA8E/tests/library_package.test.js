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
      folderId: "folder-projects",
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
    folders: [
      { id: "root", name: "Library", parentId: null, created: Date.parse("2026-10-01T00:00:00Z"), modified: Date.parse("2026-10-01T00:00:00Z") },
      { id: "folder-projects", name: "Projects", parentId: "root", created: Date.parse("2026-10-01T00:00:00Z"), modified: Date.parse("2026-10-08T14:00:00Z") },
    ],
    workspace: {
      devices: { D1: "writer-disk", D2: "docs-disk" },
      writeProtected: { D1: false, D2: false },
    },
  };
  const manifest = api.makeManifest(records, options);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.libraryVersion, 7);
  assert.equal(manifest.library[0].folderId, "folder-projects");
  assert.equal(manifest.folders.length, 2);

  const exported = await api.exportPackage(records, options);
  const imported = await api.importPackage(exported.bytes);
  assert.equal(JSON.stringify(imported.manifest), JSON.stringify(manifest));
  assert.deepEqual(Array.from(imported.entries[0].bytes), [0x96, 0x02, 1, 2, 3]);
  assert.deepEqual(Array.from(imported.entries[1].bytes), [9, 8, 7]);
  assert.equal(imported.entries[0].manifest.folderId, "folder-projects");
  await assert.rejects(api.importPackage(exported.bytes, { maxPayloadBytes: 4 }), /payload.*size limit/);
  await assert.rejects(api.importPackage(exported.bytes, { maxPackageBytes: exported.bytes.byteLength - 1 }), /archive.*size limit/);
  assert.throws(() => api.exportPackage(records, Object.assign({}, options, { maxPayloadBytes: 4 })), /payload.*size limit/);
  const futureManifest = Object.assign({}, manifest, { schemaVersion: 2 });
  const futurePackage = apis.archiveApi.write([
    { name: "library.json", bytes: new TextEncoder().encode(JSON.stringify(futureManifest)) },
    { name: futureManifest.library[0].path, bytes: records[0].bytes },
    { name: futureManifest.library[1].path, bytes: records[1].bytes },
  ]);
  const futureImport = await api.importPackage(futurePackage);
  assert.match(futureImport.schemaWarning, /schema is newer/);

  const progressEvents = [];
  await api.exportPackage(records, Object.assign({}, options, {
    onProgress: function (progress) { progressEvents.push(progress); },
  }));
  assert.ok(progressEvents.some(function (progress) { return progress.phase === "export"; }));
  assert.throws(function () {
    api.exportPackage(records, Object.assign({}, options, {
      isCanceled: function () { return true; },
    }));
  }, /operation canceled/);
  assert.throws(function () {
    api.importPackage(exported.bytes, {
      isCanceled: function () { return true; },
    });
  }, /operation canceled/);

  const folderScopedPlan = api.planImport([
    { id: "root-copy", name: "atariwriter.atr", format: "atr", bytes: new Uint8Array([7, 7, 7]), folderId: "root" },
    { id: "root-docs", name: "docs.atr", format: "atr", bytes: new Uint8Array([8, 8, 8]), folderId: "root" },
    { id: "root-docs-copy", name: "docs(1).atr", format: "atr", bytes: new Uint8Array([6, 6, 6]), folderId: "root" },
  ], imported, options.folders);
  assert.equal(folderScopedPlan.summary.renamed, 1);
  assert.equal(folderScopedPlan.summary.payloads, 2);
  assert.equal(folderScopedPlan.additions[0].name, "atariwriter.atr");
  assert.equal(folderScopedPlan.additions[1].name, "docs(2).atr");

  // Different library entries may share identical content. The manifest
  // keeps both entries while the archive stores one content-addressed blob.
  const sharedContentRecords = records.concat([{
    id: "writer-copy",
    name: "writer-copy.atr",
    format: "atr",
    bytes: records[0].bytes,
    created: Date.parse("2026-10-08T15:00:00Z"),
    modified: Date.parse("2026-10-08T15:00:00Z"),
  }]);
  const sharedContentPackage = await api.exportPackage(sharedContentRecords, options);
  const sharedContentImport = await api.importPackage(sharedContentPackage.bytes);
  assert.equal(sharedContentImport.manifest.library.length, 3);
  assert.equal(sharedContentImport.entries.length, 3);
  assert.equal(
    sharedContentImport.manifest.library[0].path,
    sharedContentImport.manifest.library[2].path,
  );

  const historyRecords = [{
    id: "history-disk",
    name: "history.atr",
    format: "atr",
    bytes: new Uint8Array([3, 3, 3]),
    created: Date.parse("2026-10-01T12:00:00Z"),
    modified: Date.parse("2026-10-08T15:00:00Z"),
    revisions: [
      {
        id: "history-r1",
        bytes: new Uint8Array([1, 1, 1]),
        created: Date.parse("2026-10-01T12:00:00Z"),
        modified: Date.parse("2026-10-01T12:00:00Z"),
      },
      {
        id: "history-r2",
        bytes: new Uint8Array([3, 3, 3]),
        created: Date.parse("2026-10-08T15:00:00Z"),
        modified: Date.parse("2026-10-08T15:00:00Z"),
        parentId: "history-r1",
      },
    ],
    preferredRevisionId: "history-r2",
  }];
  const historyPackage = await api.exportPackage(historyRecords);
  const historyImport = await api.importPackage(historyPackage.bytes);
  assert.equal(historyImport.manifest.library[0].revisions.length, 2);
  assert.equal(historyImport.manifest.library[0].preferredRevisionId, "history-r2");
  assert.deepEqual(Array.from(historyImport.entries[0].revisions[0].bytes), [1, 1, 1]);
  const historyPlan = api.planImport([], historyImport, []);
  assert.equal(historyPlan.summary.payloads, 2);
  assert.equal(historyPlan.summary.revisions, 2);

  const conflictPlan = api.planImport([
    {
      id: "writer-disk",
      name: "local.atr",
      format: "atr",
      bytes: new Uint8Array([4, 4, 4]),
    },
  ], imported);
  assert.equal(conflictPlan.summary.conflicts, 1);
  assert.equal(conflictPlan.summary.newer, 1);
  assert.equal(conflictPlan.summary.added, 2);
  assert.equal(conflictPlan.summary.foldersAdded, 1);
  assert.equal(conflictPlan.additions[0].folderId, "folder-projects");

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
