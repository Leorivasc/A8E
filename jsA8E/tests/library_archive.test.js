const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadArchiveApi() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "js", "core", "library_archive.js"),
    "utf8",
  );
  const context = {
    ArrayBuffer,
    DataView,
    Error,
    Set,
    TextDecoder,
    Uint8Array,
    console,
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: "library_archive.js" });
  return context.A8ELibraryArchive.createApi();
}

function bytes(values) {
  return new Uint8Array(values);
}

function readHexFixture() {
  const hex = fs.readFileSync(
    path.join(__dirname, "..", "..", "implementation", "traces", "library_archive_contract.hex"),
    "utf8",
  ).replace(/\s+/g, "");
  assert.equal(hex.length % 2, 0);
  const result = new Uint8Array(hex.length / 2);
  for (let i = 0; i < result.length; i++) result[i] = parseInt(hex.substr(i * 2, 2), 16);
  return result;
}

const archive = loadArchiveApi();
const utf8Name = "blobs/" + String.fromCharCode(0x00e1) + ".atr";
const manifestJson =
  '{"format":"a8e-library-export","schemaVersion":1,"libraryVersion":1,' +
  '"createdAt":"2026-10-08T15:00:00Z","library":[{"id":"disk-demo",' +
  '"name":"demo.atr","type":"atr","path":"blobs/demo.atr","size":5,' +
  '"sha256":"ff5d8507b6a72bee2debce2c0054798deaccdc5d8a1b945b6280ce8aa9cba52e",' +
  '"createdAt":"2026-10-08T15:00:00Z","modifiedAt":"2026-10-08T15:00:00Z"}],'+
  '"workspace":{"devices":{"D1":"disk-demo"},"writeProtected":{"D1":false}}}';
const entries = [
  {
    name: "library.json",
    bytes: new TextEncoder().encode(manifestJson),
  },
  { name: "blobs/demo.atr", bytes: bytes([0, 1, 2, 3, 0xff]) },
  { name: utf8Name, bytes: bytes([9, 8, 7]) },
];

const encoded = new Uint8Array(archive.write(entries));
assert.equal(encoded[0], 0x50);
assert.equal(encoded[1], 0x4b);
assert.deepEqual(Array.from(encoded), Array.from(readHexFixture()));
const decoded = archive.read(encoded);
assert.equal(decoded.length, entries.length);
entries.forEach(function (entry, index) {
  assert.equal(decoded[index].name, entry.name);
  assert.deepEqual(Array.from(decoded[index].bytes), Array.from(entry.bytes));
});
const fixtureDecoded = archive.read(readHexFixture());
assert.deepEqual(
  fixtureDecoded.map(function (entry) { return entry.name; }),
  entries.map(function (entry) { return entry.name; }),
);

assert.throws(
  function () { archive.write([{ name: "../outside", bytes: bytes([1]) }]); },
  /unsafe entry path/,
);
assert.throws(
  function () { archive.write([{ name: "a", bytes: bytes([1]) }, { name: "a", bytes: bytes([2]) }]); },
  /duplicate entry path/,
);
assert.throws(
  function () { archive.write([{ name: "blobs/" + String.fromCharCode(0xd800), bytes: bytes([1]) }]); },
  /Invalid UTF-8 ZIP entry name/,
);

const corrupted = encoded.slice();
corrupted[30 + entries[0].name.length] ^= 0x01;
assert.throws(function () { archive.read(corrupted); }, /Invalid A8E ZIP archive/);

console.log("library_archive.test.js passed");
