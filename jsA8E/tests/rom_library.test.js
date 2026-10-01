/* global __dirname, console, process, require, setTimeout */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function cloneValue(value) {
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (!value || typeof value !== "object") return value;
  const result = {};
  Object.keys(value).forEach(function (key) {
    result[key] = cloneValue(value[key]);
  });
  return result;
}

class FakeObjectStore {
  constructor(records) {
    this.records = records;
  }

  put(record) {
    const request = {};
    setTimeout(() => {
      this.records.set(record.kind, cloneValue(record));
      request.result = record.kind;
      if (request.onsuccess) request.onsuccess();
    }, 0);
    return request;
  }

  get(kind) {
    const request = {};
    setTimeout(() => {
      request.result = cloneValue(this.records.get(kind));
      if (request.onsuccess) request.onsuccess();
    }, 0);
    return request;
  }

  getAll() {
    const request = {};
    setTimeout(() => {
      request.result = Array.from(this.records.values()).map(cloneValue);
      if (request.onsuccess) request.onsuccess();
    }, 0);
    return request;
  }

  delete(kind) {
    setTimeout(() => this.records.delete(kind), 0);
  }

  clear() {
    setTimeout(() => this.records.clear(), 0);
  }
}

class FakeDatabase {
  constructor() {
    this.records = new Map();
    this.objectStoreNames = {
      contains: (name) => name === "roms",
    };
  }

  createObjectStore() {
    return new FakeObjectStore(this.records);
  }

  transaction() {
    const transaction = {
      error: null,
      objectStore: () => new FakeObjectStore(this.records),
      oncomplete: null,
      onabort: null,
    };
    setTimeout(() => {
      if (transaction.oncomplete) transaction.oncomplete();
    }, 10);
    return transaction;
  }
}

function createFakeIndexedDb() {
  const database = new FakeDatabase();
  return {
    open: function () {
      const request = {};
      setTimeout(() => {
        request.result = database;
        if (request.onupgradeneeded) {
          request.onupgradeneeded({ target: { result: database } });
        }
        if (request.onsuccess) request.onsuccess({ target: { result: database } });
      }, 0);
      return request;
    },
  };
}

function loadApi(indexedDB) {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "js", "core", "rom_library.js"),
    "utf8",
  );
  const context = {
    console: console,
    indexedDB: indexedDB,
    setTimeout: setTimeout,
    Promise: Promise,
    Uint8Array: Uint8Array,
    ArrayBuffer: ArrayBuffer,
    Date: Date,
    Math: Math,
    Object: Object,
    String: String,
    Number: Number,
    Array: Array,
    Error: Error,
  };
  context.window = context;
  context.self = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "rom_library.js" });
  return context.window.A8ERomLibrary.createApi().create();
}

async function main() {
  const indexedDB = createFakeIndexedDb();
  const library = loadApi(indexedDB);
  await library.init();
  assert.deepEqual(await library.list(), []);

  const os = new Uint8Array(0x4000);
  os[0] = 0xa8;
  await library.put("os", os, { filename: "custom-os.rom" });
  const restoredOs = await library.get("os");
  assert.equal(restoredOs.filename, "custom-os.rom");
  assert.equal(restoredOs.size, 0x4000);
  assert.equal(restoredOs.source, "user-upload");
  assert.equal(restoredOs.bytes[0], 0xa8);

  await assert.rejects(library.put("basic", new Uint8Array(12)), /8192 bytes/);

  const secondLibrary = loadApi(indexedDB);
  const persisted = await secondLibrary.get("os");
  assert.equal(persisted.bytes.length, 0x4000);
  await secondLibrary.put("basic", new Uint8Array(0x2000));
  assert.equal((await secondLibrary.list()).length, 2);

  await secondLibrary.clear();
  assert.deepEqual(await secondLibrary.list(), []);
  console.log("rom_library.test.js passed");
}

main().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
