(function () {
  "use strict";

  const DB_NAME = "a8e_rom_library";
  const DB_VERSION = 1;
  const STORE_NAME = "roms";
  const SPECS = Object.freeze({
    os: Object.freeze({ size: 0x4000, label: "Atari OS ROM" }),
    basic: Object.freeze({ size: 0x2000, label: "Atari BASIC ROM" }),
  });

  function normalizeKind(kind) {
    const value = String(kind || "").trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(SPECS, value) ? value : null;
  }

  function toUint8(data) {
    if (data instanceof Uint8Array) return new Uint8Array(data);
    if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      );
    }
    if (Array.isArray(data)) return new Uint8Array(data);
    return new Uint8Array(0);
  }

  function validateBytes(kind, data) {
    const normalizedKind = normalizeKind(kind);
    if (!normalizedKind) throw new Error("Unknown ROM kind: " + kind);
    const bytes = toUint8(data);
    const expectedSize = SPECS[normalizedKind].size;
    if (bytes.byteLength !== expectedSize) {
      throw new Error(
        SPECS[normalizedKind].label +
          " must be exactly " +
          expectedSize +
          " bytes (received " +
          bytes.byteLength +
          ").",
      );
    }
    return bytes;
  }

  function cloneRecord(record, includeBytes) {
    if (!record || typeof record !== "object") return null;
    const kind = normalizeKind(record.kind);
    if (!kind) return null;
    const bytes = includeBytes ? validateBytes(kind, record.bytes) : null;
    return {
      kind: kind,
      bytes: bytes,
      filename: record.filename ? String(record.filename) : null,
      size: SPECS[kind].size,
      savedAt: Number(record.savedAt) || 0,
      source: "user-upload",
    };
  }

  function createApi() {
    function create() {
      let db = null;
      let ready = false;
      let initPromise = null;

      function init() {
        if (ready) return Promise.resolve();
        if (initPromise) return initPromise;
        if (!self.indexedDB) {
          ready = true;
          return Promise.resolve();
        }

        initPromise = new Promise(function (resolve) {
          let request;
          try {
            request = self.indexedDB.open(DB_NAME, DB_VERSION);
          } catch (err) {
            console.error("ROM library IndexedDB init failed:", err);
            ready = true;
            resolve();
            return;
          }
          request.onupgradeneeded = function (event) {
            const database = event.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
              database.createObjectStore(STORE_NAME, { keyPath: "kind" });
            }
          };
          request.onsuccess = function (event) {
            db = event.target.result;
            ready = true;
            resolve();
          };
          request.onerror = function () {
            console.error("ROM library IndexedDB init failed:", request.error);
            ready = true;
            resolve();
          };
        });
        return initPromise;
      }

      function get(kind) {
        const normalizedKind = normalizeKind(kind);
        if (!normalizedKind) return Promise.reject(new Error("Unknown ROM kind: " + kind));
        return init().then(function () {
          if (!db) return null;
          return new Promise(function (resolve) {
            let tx;
            try {
              tx = db.transaction(STORE_NAME, "readonly");
            } catch (err) {
              resolve(null);
              return;
            }
            const request = tx.objectStore(STORE_NAME).get(normalizedKind);
            request.onsuccess = function () {
              try {
                resolve(cloneRecord(request.result, true));
              } catch (err) {
                console.error("ROM library record is invalid:", err);
                resolve(null);
              }
            };
            request.onerror = function () { resolve(null); };
          });
        });
      }

      function list() {
        return init().then(function () {
          if (!db) return [];
          return new Promise(function (resolve) {
            let tx;
            try {
              tx = db.transaction(STORE_NAME, "readonly");
            } catch (err) {
              resolve([]);
              return;
            }
            const request = tx.objectStore(STORE_NAME).getAll();
            request.onsuccess = function () {
              resolve((request.result || []).map(function (record) {
                return cloneRecord(record, false);
              }).filter(Boolean));
            };
            request.onerror = function () { resolve([]); };
          });
        });
      }

      function put(kind, data, metadata) {
        const normalizedKind = normalizeKind(kind);
        let bytes;
        try {
          bytes = validateBytes(normalizedKind, data);
        } catch (err) {
          return Promise.reject(err);
        }
        const info = metadata && typeof metadata === "object" ? metadata : {};
        return init().then(function () {
          if (!db) return false;
          return new Promise(function (resolve, reject) {
            let tx;
            try {
              tx = db.transaction(STORE_NAME, "readwrite");
            } catch (err) {
              reject(err);
              return;
            }
            const record = {
              kind: normalizedKind,
              bytes: bytes.buffer.slice(0),
              filename: info.filename ? String(info.filename) : null,
              savedAt: Date.now(),
              source: "user-upload",
            };
            const request = tx.objectStore(STORE_NAME).put(record);
            tx.oncomplete = function () { resolve(true); };
            tx.onabort = function () {
              reject(tx.error || new Error("ROM library IndexedDB write aborted"));
            };
            request.onerror = function () {
              reject(request.error || new Error("ROM library IndexedDB write failed"));
            };
          });
        });
      }

      function remove(kind) {
        const normalizedKind = normalizeKind(kind);
        if (!normalizedKind) return Promise.reject(new Error("Unknown ROM kind: " + kind));
        return init().then(function () {
          if (!db) return false;
          return new Promise(function (resolve, reject) {
            let tx;
            try {
              tx = db.transaction(STORE_NAME, "readwrite");
            } catch (err) {
              reject(err);
              return;
            }
            tx.objectStore(STORE_NAME).delete(normalizedKind);
            tx.oncomplete = function () { resolve(true); };
            tx.onabort = function () {
              reject(tx.error || new Error("ROM library IndexedDB delete aborted"));
            };
          });
        });
      }

      function clear() {
        return init().then(function () {
          if (!db) return false;
          return new Promise(function (resolve, reject) {
            let tx;
            try {
              tx = db.transaction(STORE_NAME, "readwrite");
            } catch (err) {
              reject(err);
              return;
            }
            tx.objectStore(STORE_NAME).clear();
            tx.oncomplete = function () { resolve(true); };
            tx.onabort = function () {
              reject(tx.error || new Error("ROM library IndexedDB clear aborted"));
            };
          });
        });
      }

      return {
        init: init,
        get: get,
        list: list,
        put: put,
        remove: remove,
        clear: clear,
        isReady: function () { return ready; },
      };
    }

    return { create: create };
  }

  window.A8ERomLibrary = { createApi: createApi };
})();
