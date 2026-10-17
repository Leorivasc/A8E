(function () {
  "use strict";

  const DB_NAME = "a8e_disk_library";
  const DB_VERSION = 4;
  const STORE_NAME = "entries";
  const TRASH_STORE_NAME = "trash";
  const FOLDER_STORE_NAME = "folders";
  const META_STORE_NAME = "metadata";
  const ROOT_FOLDER_ID = "root";
  const FLUSH_DELAY_MS = 350;
  const BLANK_ATR_SECTOR_COUNT = 720;
  const BLANK_ATR_SECTOR_SIZE = 128;
  const BLANK_ATR_HEADER_SIZE = 16;

  function getExtension(name) {
    const value = String(name || "").trim();
    const dot = value.lastIndexOf(".");
    return dot >= 0 ? value.substring(dot + 1).toLowerCase() : "";
  }

  function normalizeName(name) {
    const value = String(name || "").trim();
    if (!value) return null;
    return value;
  }

  function logicalName(name) {
    const normalized = normalizeName(name);
    return normalized ? normalized.toUpperCase() : null;
  }

  function normalizeFolderName(name) {
    const value = String(name || "").trim();
    if (!value || value === "." || value === ".." || value.includes("/")) return null;
    return value;
  }

  function isSupportedName(name) {
    const ext = getExtension(name);
    return ext === "atr" || ext === "xex";
  }

  function toUint8(data) {
    if (!data) return new Uint8Array(0);
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

  function cloneBytes(data) {
    return new Uint8Array(toUint8(data));
  }

  function bytesEqual(left, right) {
    const a = toUint8(left);
    const b = toUint8(right);
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function createBlankAtrBytes() {
    const dataSize = BLANK_ATR_SECTOR_COUNT * BLANK_ATR_SECTOR_SIZE;
    const atr = new Uint8Array(BLANK_ATR_HEADER_SIZE + dataSize);
    const paragraphs = dataSize / 16;
    atr[0] = 0x96;
    atr[1] = 0x02;
    atr[2] = paragraphs & 0xff;
    atr[3] = (paragraphs >> 8) & 0xff;
    atr[4] = BLANK_ATR_SECTOR_SIZE;
    atr[5] = 0x00;
    atr[6] = (paragraphs >> 16) & 0xff;
    atr[7] = (paragraphs >> 24) & 0xff;
    return atr;
  }

  function makeId() {
    return (
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).substring(2, 10)
    );
  }

  function createApi() {
    function create(options) {
      const config = options && typeof options === "object" ? options : {};
      const mountDisk =
        typeof config.mountDisk === "function" ? config.mountDisk : null;
      const unmountDisk =
        typeof config.unmountDisk === "function" ? config.unmountDisk : null;
      const getDiskImageBytes =
        typeof config.getDiskImageBytes === "function"
          ? config.getDiskImageBytes
          : null;
      const getDiskImageInfo =
        typeof config.getDiskImageInfo === "function"
          ? config.getDiskImageInfo
          : null;
      const getMountedDiskForDeviceSlot =
        typeof config.getMountedDiskForDeviceSlot === "function"
          ? config.getMountedDiskForDeviceSlot
          : null;
      const entries = new Map();
      const trash = new Map();
      const folders = new Map();
      const listeners = new Set();
      let db = null;
      let ready = false;
      let mountsRestored = false;
      let libraryVersion = 1;

      function makeFolder(name, parentId, id) {
        return {
          id: id || makeId(),
          name: normalizeFolderName(name) || "New Folder",
          parentId: parentId || ROOT_FOLDER_ID,
          created: Date.now(),
          modified: Date.now(),
        };
      }

      function ensureRootFolder() {
        if (!folders.has(ROOT_FOLDER_ID)) {
          folders.set(ROOT_FOLDER_ID, {
            id: ROOT_FOLDER_ID,
            name: "Library",
            parentId: null,
            created: Date.now(),
            modified: Date.now(),
          });
        }
        return folders.get(ROOT_FOLDER_ID);
      }

      ensureRootFolder();

      function emitChange() {
        listeners.forEach(function (listener) {
          try {
            listener();
          } catch (err) {
            console.error("Disk library listener error:", err);
          }
        });
      }

      function onChange(listener) {
        if (typeof listener !== "function") return function () {};
        listeners.add(listener);
        return function () {
          listeners.delete(listener);
        };
      }

      function makeEntry(name, sourceBytes, id, folderId) {
        const normalized = normalizeName(name);
        const format = getExtension(normalized);
        const bytes = cloneBytes(sourceBytes);
        const revision = {
          id: makeId(),
          bytes: cloneBytes(bytes),
          created: Date.now(),
          modified: Date.now(),
          parentId: null,
        };
        return {
          id: id || makeId(),
          name: normalized,
          logicalName: logicalName(normalized),
          format: format,
          sourceBytes: bytes,
          runtimeBytes: format === "atr" ? cloneBytes(bytes) : null,
          runtimeName: format === "atr" ? normalized : null,
          folderId: folders.has(folderId) ? folderId : ROOT_FOLDER_ID,
          imageIndex: -1,
          slot: -1,
          dirty: false,
          persisting: false,
          pendingFlush: null,
          flushTimer: 0,
          created: Date.now(),
          modified: Date.now(),
          revisions: [revision],
          preferredRevisionId: revision.id,
        };
      }

      function appendRevision(entry, data) {
        if (!entry) return null;
        const bytes = cloneBytes(data);
        const current = entry.revisions && entry.revisions.length
          ? entry.revisions[entry.revisions.length - 1]
          : null;
        if (current && bytesEqual(current.bytes, bytes)) {
          entry.preferredRevisionId = current.id;
          return current;
        }
        const revision = {
          id: makeId(),
          bytes: bytes,
          created: Date.now(),
          modified: Date.now(),
          parentId: current ? current.id : null,
        };
        if (!Array.isArray(entry.revisions)) entry.revisions = [];
        entry.revisions.push(revision);
        entry.preferredRevisionId = revision.id;
        return revision;
      }

      function currentBytes(entry) {
        if (!entry) return new Uint8Array(0);
        return entry.runtimeBytes || entry.sourceBytes;
      }

      function currentName(entry) {
        if (!entry) return "disk.atr";
        if (entry.format === "xex" && entry.runtimeBytes) {
          const dot = entry.name.lastIndexOf(".");
          const base = dot > 0 ? entry.name.substring(0, dot) : entry.name;
          return base + ".ATR";
        }
        return entry.runtimeName || entry.name;
      }

      function clonePersistedEntry(entry) {
        return {
          id: entry.id,
          name: entry.name,
          format: entry.format,
          sourceBytes: cloneBytes(entry.sourceBytes),
          runtimeBytes: entry.runtimeBytes
            ? cloneBytes(entry.runtimeBytes)
            : null,
          runtimeName: entry.runtimeName || null,
          folderId: entry.folderId || ROOT_FOLDER_ID,
          slot: entry.slot | 0,
          created: entry.created || Date.now(),
          modified: entry.modified || Date.now(),
          revisions: (entry.revisions || []).map(function (revision) {
            return {
              id: revision.id,
              bytes: cloneBytes(revision.bytes),
              created: revision.created || Date.now(),
              modified: revision.modified || Date.now(),
              parentId: revision.parentId || null,
            };
          }),
          preferredRevisionId: entry.preferredRevisionId || null,
        };
      }

      function clonePersistedTrash(entry) {
        const record = clonePersistedEntry(entry);
        record.slot = -1;
        record.deletedAt = entry.deletedAt || Date.now();
        return record;
      }

      function clonePersistedFolder(folder) {
        return {
          id: folder.id,
          name: folder.name,
          parentId: folder.parentId || null,
          created: folder.created || Date.now(),
          modified: folder.modified || Date.now(),
        };
      }

      function persistFolder(folder) {
        if (!db || !folder) return Promise.resolve();
        let tx;
        try {
          tx = db.transaction(FOLDER_STORE_NAME, "readwrite");
        } catch (err) {
          return Promise.reject(err);
        }
        return new Promise(function (resolve, reject) {
          const request = tx.objectStore(FOLDER_STORE_NAME).put(clonePersistedFolder(folder));
          tx.oncomplete = function () { resolve(); };
          tx.onabort = function () {
            reject(tx.error || new Error("Disk library folder write aborted"));
          };
          request.onerror = function () {
            reject(request.error || new Error("Disk library folder write failed"));
          };
        });
      }

      function deleteFolderRecord(id) {
        if (!db) return Promise.resolve();
        let tx;
        try {
          tx = db.transaction(FOLDER_STORE_NAME, "readwrite");
        } catch (err) {
          return Promise.reject(err);
        }
        return new Promise(function (resolve, reject) {
          const request = tx.objectStore(FOLDER_STORE_NAME).delete(id);
          tx.oncomplete = function () { resolve(); };
          tx.onabort = function () {
            reject(tx.error || new Error("Disk library folder delete aborted"));
          };
          request.onerror = function () {
            reject(request.error || new Error("Disk library folder delete failed"));
          };
        });
      }

      function persistRecord(entry) {
        if (!db || !entry) return Promise.resolve();
        let tx;
        try {
          tx = db.transaction(STORE_NAME, "readwrite");
        } catch (err) {
          return Promise.reject(err);
        }
        return new Promise(function (resolve, reject) {
          const request = tx.objectStore(STORE_NAME).put(clonePersistedEntry(entry));
          tx.oncomplete = function () { resolve(); };
          tx.onabort = function () {
            reject(tx.error || new Error("Disk library IndexedDB write aborted"));
          };
          request.onerror = function () {
            reject(request.error || new Error("Disk library IndexedDB write failed"));
          };
        });
      }

      function deleteRecord(id) {
        if (!db) return Promise.resolve();
        let tx;
        try {
          tx = db.transaction(STORE_NAME, "readwrite");
        } catch (err) {
          return Promise.reject(err);
        }
        return new Promise(function (resolve, reject) {
          const request = tx.objectStore(STORE_NAME).delete(id);
          tx.oncomplete = function () { resolve(); };
          tx.onabort = function () {
            reject(tx.error || new Error("Disk library IndexedDB delete aborted"));
          };
          request.onerror = function () {
            reject(request.error || new Error("Disk library IndexedDB delete failed"));
          };
        });
      }

      function persistDeleteAtomically(entry) {
        if (!db || !entry) return Promise.resolve();
        let tx;
        try {
          tx = db.transaction([STORE_NAME, TRASH_STORE_NAME], "readwrite");
        } catch (err) {
          return Promise.reject(err);
        }
        return new Promise(function (resolve, reject) {
          const trashRequest = tx.objectStore(TRASH_STORE_NAME).put(clonePersistedTrash(entry));
          const deleteRequest = tx.objectStore(STORE_NAME).delete(entry.id);
          tx.oncomplete = function () { resolve(); };
          tx.onabort = function () {
            reject(tx.error || new Error("Disk library trash transaction aborted"));
          };
          trashRequest.onerror = function () {
            reject(trashRequest.error || new Error("Disk library trash write failed"));
          };
          deleteRequest.onerror = function () {
            reject(deleteRequest.error || new Error("Disk library entry delete failed"));
          };
        });
      }

      function persistRestoreAtomically(entry, trashId) {
        if (!db || !entry) return Promise.resolve();
        let tx;
        try {
          tx = db.transaction([STORE_NAME, TRASH_STORE_NAME], "readwrite");
        } catch (err) {
          return Promise.reject(err);
        }
        return new Promise(function (resolve, reject) {
          const entryRequest = tx.objectStore(STORE_NAME).put(clonePersistedEntry(entry));
          const trashRequest = tx.objectStore(TRASH_STORE_NAME).delete(trashId);
          tx.oncomplete = function () { resolve(); };
          tx.onabort = function () {
            reject(tx.error || new Error("Disk library restore transaction aborted"));
          };
          entryRequest.onerror = function () {
            reject(entryRequest.error || new Error("Disk library restore write failed"));
          };
          trashRequest.onerror = function () {
            reject(trashRequest.error || new Error("Disk library trash delete failed"));
          };
        });
      }

      function deleteTrashRecord(id) {
        if (!db) return Promise.resolve();
        let tx;
        try {
          tx = db.transaction(TRASH_STORE_NAME, "readwrite");
        } catch (err) {
          return Promise.reject(err);
        }
        return new Promise(function (resolve, reject) {
          const request = tx.objectStore(TRASH_STORE_NAME).delete(id);
          tx.oncomplete = function () { resolve(); };
          tx.onabort = function () {
            reject(tx.error || new Error("Disk library trash purge aborted"));
          };
          request.onerror = function () {
            reject(request.error || new Error("Disk library trash purge failed"));
          };
        });
      }

      function hydrateRecord(raw) {
        if (!raw || typeof raw !== "object") return null;
        const name = normalizeName(raw.name);
        if (!name || !isSupportedName(name)) return null;
        const format = getExtension(name);
        const sourceBytes = cloneBytes(raw.sourceBytes || raw.bytes);
        const runtimeBytes = raw.runtimeBytes
          ? cloneBytes(raw.runtimeBytes)
          : format === "atr"
            ? cloneBytes(sourceBytes)
            : null;
        const revisions = Array.isArray(raw.revisions) ? raw.revisions.map(function (revision) {
          if (!revision || !revision.id) return null;
          return {
            id: String(revision.id),
            bytes: cloneBytes(revision.bytes),
            created: revision.created || Date.now(),
            modified: revision.modified || Date.now(),
            parentId: revision.parentId || null,
          };
        }).filter(Boolean) : [];
        if (!revisions.length) {
          revisions.push({ id: makeId(), bytes: cloneBytes(sourceBytes), created: raw.created || Date.now(), modified: raw.modified || Date.now(), parentId: null });
        }
        return {
          id: raw.id ? String(raw.id) : makeId(),
          name: name,
          logicalName: logicalName(name),
          format: format,
          sourceBytes: sourceBytes,
          runtimeBytes: runtimeBytes,
          runtimeName: raw.runtimeName ? String(raw.runtimeName) : null,
          folderId: raw.folderId ? String(raw.folderId) : ROOT_FOLDER_ID,
          imageIndex: -1,
          slot: typeof raw.slot === "number" ? raw.slot | 0 : -1,
          dirty: false,
          persisting: false,
          pendingFlush: null,
          flushTimer: 0,
          created: raw.created || Date.now(),
          modified: raw.modified || Date.now(),
          revisions: revisions,
          preferredRevisionId: raw.preferredRevisionId || revisions[revisions.length - 1].id,
        };
      }

      function hydrateTrashRecord(raw) {
        const entry = hydrateRecord(raw);
        if (!entry) return null;
        entry.slot = -1;
        entry.imageIndex = -1;
        entry.deletedAt = raw.deletedAt || Date.now();
        return entry;
      }

      function init() {
        if (ready) return Promise.resolve();
        if (!self.indexedDB) {
          ready = true;
          emitChange();
          return Promise.resolve();
        }
        return new Promise(function (resolve) {
          let request;
          try {
            request = self.indexedDB.open(DB_NAME, DB_VERSION);
          } catch (err) {
            ready = true;
            console.error("Disk library IndexedDB init failed:", err);
            emitChange();
            resolve();
            return;
          }
          request.onupgradeneeded = function (event) {
            const database = event.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
              database.createObjectStore(STORE_NAME, { keyPath: "id" });
            }
            if (!database.objectStoreNames.contains(TRASH_STORE_NAME)) {
              database.createObjectStore(TRASH_STORE_NAME, { keyPath: "id" });
            }
            if (!database.objectStoreNames.contains(FOLDER_STORE_NAME)) {
              database.createObjectStore(FOLDER_STORE_NAME, { keyPath: "id" });
            }
            if (!database.objectStoreNames.contains(META_STORE_NAME)) {
              database.createObjectStore(META_STORE_NAME, { keyPath: "key" });
            }
          };
          request.onsuccess = function (event) {
            db = event.target.result;
            let tx;
            try {
              tx = db.transaction([STORE_NAME, TRASH_STORE_NAME, FOLDER_STORE_NAME], "readonly");
            } catch (err) {
              ready = true;
              emitChange();
              resolve();
              return;
            }
            const getAll = tx.objectStore(STORE_NAME).getAll();
            const getAllTrash = tx.objectStore(TRASH_STORE_NAME).getAll();
            const getAllFolders = tx.objectStore(FOLDER_STORE_NAME).getAll();
            let rawEntries = null;
            let rawTrash = null;
            let rawFolders = null;
            let loadedEntries = false;
            let loadedTrash = false;
            let loadedFolders = false;
            function finishLibraryLoad() {
              if (!loadedEntries || !loadedTrash || !loadedFolders) return;
              for (let i = 0; i < rawEntries.length; i++) {
                const entry = hydrateRecord(rawEntries[i]);
                if (entry) entries.set(entry.id, entry);
              }
              for (let i = 0; i < rawTrash.length; i++) {
                const entry = hydrateTrashRecord(rawTrash[i]);
                if (entry && !entries.has(entry.id)) trash.set(entry.id, entry);
              }
              for (let i = 0; i < rawFolders.length; i++) {
                const raw = rawFolders[i];
                const name = normalizeFolderName(raw && raw.name);
                if (!raw || !raw.id || !name) continue;
                folders.set(String(raw.id), {
                  id: String(raw.id),
                  name: name,
                  parentId: raw.id === ROOT_FOLDER_ID ? null : (raw.parentId || ROOT_FOLDER_ID),
                  created: raw.created || Date.now(),
                  modified: raw.modified || Date.now(),
                });
              }
              ensureRootFolder();
              entries.forEach(function (entry) {
                if (!folders.has(entry.folderId)) entry.folderId = ROOT_FOLDER_ID;
              });
              let metadataTx;
              try {
                metadataTx = db.transaction(META_STORE_NAME, "readonly");
              } catch (err) {
                ready = true;
                emitChange();
                resolve();
                return;
              }
              const metadata = metadataTx.objectStore(META_STORE_NAME).get("libraryVersion");
              metadata.onsuccess = function () {
                if (metadata.result && Number.isInteger(metadata.result.value)) {
                  libraryVersion = Math.max(1, metadata.result.value | 0);
                }
                ready = true;
                emitChange();
                resolve();
                persistFolder(folders.get(ROOT_FOLDER_ID)).catch(function () {});
              };
              metadata.onerror = function () {
                ready = true;
                emitChange();
                resolve();
              };
            }
            getAll.onsuccess = function () {
              rawEntries = getAll.result || [];
              loadedEntries = true;
              finishLibraryLoad();
            };
            getAllFolders.onsuccess = function () {
              rawFolders = getAllFolders.result || [];
              loadedFolders = true;
              finishLibraryLoad();
            };
            getAllTrash.onsuccess = function () {
              rawTrash = getAllTrash.result || [];
              loadedTrash = true;
              finishLibraryLoad();
            };
            function failLibraryLoad() {
              ready = true;
              emitChange();
              resolve();
            }
            getAll.onerror = failLibraryLoad;
            getAllFolders.onerror = failLibraryLoad;
            getAllTrash.onerror = failLibraryLoad;
          };
          request.onerror = function () {
            ready = true;
            console.error("Disk library IndexedDB init failed:", request.error);
            emitChange();
            resolve();
          };
        });
      }

      function isReady() {
        return ready;
      }

      function isRestored() {
        return mountsRestored;
      }

      function getEntry(id) {
        return entries.get(String(id || "")) || null;
      }

      function getFolder(id) {
        return folders.get(String(id || ROOT_FOLDER_ID)) || null;
      }

      function listFolders(parentId) {
        const parent = String(parentId || ROOT_FOLDER_ID);
        const result = [];
        folders.forEach(function (folder) {
          if (folder.id !== ROOT_FOLDER_ID && folder.parentId === parent) {
            result.push({
              id: folder.id,
              name: folder.name,
              parentId: folder.parentId,
              created: folder.created,
              modified: folder.modified,
            });
          }
        });
        result.sort(function (a, b) {
          return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        });
        return result;
      }

      function listAllFolders() {
        const result = [];
        folders.forEach(function (folder) {
          result.push({
            id: folder.id,
            name: folder.name,
            parentId: folder.parentId,
            created: folder.created,
            modified: folder.modified,
          });
        });
        result.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
        return result;
      }

      function getFolderPath(id) {
        const result = [];
        let current = getFolder(id) || ensureRootFolder();
        const seen = new Set();
        while (current && !seen.has(current.id)) {
          seen.add(current.id);
          result.unshift({ id: current.id, name: current.name });
          current = current.parentId ? getFolder(current.parentId) : null;
        }
        return result;
      }

      function listFiles(folderId) {
        const currentFolderId = folderId === undefined || folderId === null
          ? null
          : String(folderId || ROOT_FOLDER_ID);
        const result = [];
        entries.forEach(function (entry) {
          if (currentFolderId !== null && (entry.folderId || ROOT_FOLDER_ID) !== currentFolderId) return;
          result.push({
            id: entry.id,
            name: entry.name,
            format: entry.format,
            folderId: entry.folderId || ROOT_FOLDER_ID,
            size: currentBytes(entry).length | 0,
            sourceSize: entry.sourceBytes.length | 0,
            mountedSlot: entry.slot | 0,
            dirty: !!entry.dirty,
            converted: entry.format === "xex" && !!entry.runtimeBytes,
            created: entry.created,
            modified: entry.modified,
          });
        });
        result.sort(function (a, b) {
          return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
        });
        return result;
      }

      function listAllFiles() {
        const result = [];
        entries.forEach(function (entry) {
          result.push({
            id: entry.id,
            name: entry.name,
            format: entry.format,
            folderId: entry.folderId || ROOT_FOLDER_ID,
            bytes: cloneBytes(currentBytes(entry)),
            created: entry.created,
            modified: entry.modified,
          });
        });
        return result;
      }

      function listTrash() {
        const result = [];
        trash.forEach(function (entry) {
          result.push({
            id: entry.id,
            name: entry.name,
            format: entry.format,
            folderId: entry.folderId || ROOT_FOLDER_ID,
            size: currentBytes(entry).length | 0,
            deletedAt: entry.deletedAt || 0,
            created: entry.created,
            modified: entry.modified,
          });
        });
        result.sort(function (a, b) {
          return (b.deletedAt || 0) - (a.deletedAt || 0) ||
            String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" });
        });
        return result;
      }

      function hasFolderName(name, parentId, excludeId) {
        const key = String(name || "").toUpperCase();
        const parent = String(parentId || ROOT_FOLDER_ID);
        let found = false;
        folders.forEach(function (folder) {
          if (!found && folder.id !== excludeId && folder.parentId === parent && folder.name.toUpperCase() === key) {
            found = true;
          }
        });
        return found;
      }

      function createFolder(name, parentId) {
        const normalized = normalizeFolderName(name);
        const parent = String(parentId || ROOT_FOLDER_ID);
        if (!normalized) return Promise.reject(new Error("Invalid folder name"));
        if (!folders.has(parent)) return Promise.reject(new Error("Parent folder not found"));
        if (hasFolderName(normalized, parent)) return Promise.reject(new Error("A folder with that name already exists"));
        const folder = makeFolder(normalized, parent);
        folders.set(folder.id, folder);
        return persistFolder(folder).then(function () {
          emitChange();
          return { id: folder.id, name: folder.name, parentId: folder.parentId };
        });
      }

      function renameFolder(id, name) {
        const folder = getFolder(id);
        const normalized = normalizeFolderName(name);
        if (!folder || folder.id === ROOT_FOLDER_ID) return Promise.reject(new Error("Folder cannot be renamed"));
        if (!normalized) return Promise.reject(new Error("Invalid folder name"));
        if (hasFolderName(normalized, folder.parentId, folder.id)) return Promise.reject(new Error("A folder with that name already exists"));
        folder.name = normalized;
        folder.modified = Date.now();
        return persistFolder(folder).then(function () {
          emitChange();
          return { id: folder.id, name: folder.name, parentId: folder.parentId };
        });
      }

      function deleteFolder(id) {
        const folder = getFolder(id);
        if (!folder || folder.id === ROOT_FOLDER_ID) return Promise.reject(new Error("Folder cannot be deleted"));
        if (listFolders(folder.id).length > 0 || listFiles(folder.id).length > 0) {
          return Promise.reject(new Error("Folder is not empty"));
        }
        folders.delete(folder.id);
        return deleteFolderRecord(folder.id).then(function () {
          emitChange();
          return true;
        });
      }

      function moveFile(id, folderId) {
        const entry = getEntry(id);
        const target = getFolder(folderId);
        if (!entry) return Promise.reject(new Error("Disk library entry not found"));
        if (!target) return Promise.reject(new Error("Target folder not found"));
        entry.folderId = target.id;
        entry.modified = Date.now();
        return persistRecord(entry).then(function () {
          emitChange();
          return getFileInfo(entry.id);
        });
      }

      function findByLogicalName(name, folderId) {
        const key = logicalName(name);
        if (!key) return null;
        const targetFolder = folderId === undefined || folderId === null
          ? null
          : String(folderId || ROOT_FOLDER_ID);
        let result = null;
        entries.forEach(function (entry) {
          if (!result && entry.logicalName === key &&
              (targetFolder === null || (entry.folderId || ROOT_FOLDER_ID) === targetFolder)) result = entry;
        });
        return result;
      }

      function addFile(name, data, folderId) {
        const normalized = normalizeName(name);
        if (!normalized || !isSupportedName(normalized)) {
          return Promise.reject(new Error("Only ATR and XEX files are supported"));
        }
        const targetFolder = String(folderId || ROOT_FOLDER_ID);
        if (findByLogicalName(normalized, targetFolder)) {
          const error = new Error("A disk library entry with that name already exists");
          error.code = "disk_library_duplicate";
          return Promise.reject(error);
        }
        if (!getFolder(folderId)) return Promise.reject(new Error("Target folder not found"));
        const entry = makeEntry(normalized, data, null, folderId);
        entries.set(entry.id, entry);
        emitChange();
        return persistRecord(entry).then(function () {
          return getFileInfo(entry.id);
        });
      }

      function replaceFile(id, name, data) {
        const entry = getEntry(id);
        const normalized = normalizeName(name);
        if (!entry) return Promise.reject(new Error("Disk library entry not found"));
        if (!normalized || !isSupportedName(normalized)) {
          return Promise.reject(new Error("Only ATR and XEX files are supported"));
        }
        const duplicate = findByLogicalName(normalized, entry.folderId || ROOT_FOLDER_ID);
        if (duplicate && duplicate.id !== entry.id) {
          return Promise.reject(new Error("A disk library entry with that name already exists"));
        }
        const replace = entry.slot >= 0 ? unmountFile(entry.id) : flushEntry(entry);
        return replace.then(function () {
          const format = getExtension(normalized);
          const bytes = cloneBytes(data);
          entry.name = normalized;
          entry.logicalName = logicalName(normalized);
          entry.format = format;
          entry.sourceBytes = bytes;
          entry.runtimeBytes = format === "atr" ? cloneBytes(bytes) : null;
          entry.runtimeName = format === "atr" ? normalized : null;
          entry.modified = Date.now();
          appendRevision(entry, bytes);
          entry.dirty = false;
          return persistRecord(entry);
        }).then(function () {
          emitChange();
          return getFileInfo(entry.id);
        });
      }

      function getFileInfo(id) {
        const entry = getEntry(id);
        if (!entry) return null;
        return {
          id: entry.id,
          name: entry.name,
          format: entry.format,
          folderId: entry.folderId || ROOT_FOLDER_ID,
          size: currentBytes(entry).length | 0,
          sourceSize: entry.sourceBytes.length | 0,
          mountedSlot: entry.slot | 0,
          dirty: !!entry.dirty,
          converted: entry.format === "xex" && !!entry.runtimeBytes,
        };
      }

      function getStorageEstimate() {
        if (typeof navigator === "undefined" || !navigator.storage ||
            typeof navigator.storage.estimate !== "function") {
          return Promise.resolve({ supported: false, usage: 0, quota: 0, available: 0 });
        }
        return Promise.resolve(navigator.storage.estimate()).then(function (estimate) {
          const usage = Number.isFinite(estimate && estimate.usage) ? estimate.usage : 0;
          const quota = Number.isFinite(estimate && estimate.quota) ? estimate.quota : 0;
          return {
            supported: true,
            usage: Math.max(0, Math.floor(usage)),
            quota: Math.max(0, Math.floor(quota)),
            available: Math.max(0, Math.floor(quota - usage)),
          };
        });
      }

      function listRevisions(id) {
        const entry = getEntry(id);
        if (!entry) return [];
        return (entry.revisions || []).map(function (revision) {
          return {
            id: revision.id,
            size: revision.bytes.length | 0,
            created: revision.created,
            modified: revision.modified,
            parentId: revision.parentId || null,
            preferred: revision.id === entry.preferredRevisionId,
          };
        });
      }

      function selectRevision(id, revisionId) {
        const entry = getEntry(id);
        const target = entry && (entry.revisions || []).find(function (revision) {
          return revision.id === String(revisionId || "");
        });
        if (!entry) return Promise.reject(new Error("Disk library entry not found"));
        if (!target) return Promise.reject(new Error("Disk library revision not found"));
        return unmountFile(id).then(function () {
          const bytes = cloneBytes(target.bytes);
          if (entry.format === "atr") {
            entry.sourceBytes = cloneBytes(bytes);
            entry.runtimeBytes = cloneBytes(bytes);
            entry.runtimeName = entry.name;
          } else {
            entry.sourceBytes = cloneBytes(bytes);
            entry.runtimeBytes = null;
            entry.runtimeName = null;
          }
          entry.modified = target.modified || Date.now();
          entry.preferredRevisionId = target.id;
          entry.dirty = false;
          return persistRecord(entry);
        }).then(function () {
          emitChange();
          return getFileInfo(entry.id);
        });
      }

      function verifyFile(id) {
        const entry = getEntry(id);
        if (!entry) return Promise.reject(new Error("Disk library entry not found"));
        return flushEntry(entry).then(function () {
          if (entry.format !== "atr") {
            return {
              id: entry.id,
              name: entry.name,
              valid: true,
              skipped: true,
              filesystemKnown: false,
              errors: [],
              warnings: ["Integrity verification is only available for ATR images"],
              checkedFiles: 0,
              checkedSectors: 0,
            };
          }
          const inspector = window.A8EAtrInspector;
          if (!inspector || typeof inspector.verify !== "function") {
            return Promise.reject(new Error("ATR integrity support is unavailable"));
          }
          const report = inspector.verify(currentBytes(entry));
          report.id = entry.id;
          report.name = entry.name;
          return report;
        });
      }

      function verifyLibrary() {
        const reports = [];
        let pending = Promise.resolve();
        entries.forEach(function (entry) {
          pending = pending.then(function () {
            return verifyFile(entry.id).then(function (report) {
              reports.push(report);
            });
          });
        });
        return pending.then(function () {
          const summary = { files: reports.length, invalid: 0, warnings: 0 };
          reports.forEach(function (report) {
            if (!report.valid) summary.invalid++;
            if (report.warnings && report.warnings.length) summary.warnings++;
          });
          return { reports: reports, summary: summary };
        });
      }

      function scheduleFlush(entry) {
        if (!entry || entry.flushTimer) return;
        entry.flushTimer = setTimeout(function () {
          entry.flushTimer = 0;
          flushEntry(entry).catch(function (err) {
            console.error("Disk library persistence failed:", err);
            emitChange();
          });
        }, FLUSH_DELAY_MS);
      }

      function flushEntry(entry) {
        if (!entry) return Promise.resolve();
        if (entry.pendingFlush) return entry.pendingFlush;
        if (!entry.dirty) return Promise.resolve();

        function flushLoop() {
          if (!entry.dirty) return Promise.resolve();
          entry.dirty = false;
          appendRevision(entry, currentBytes(entry));
          const snapshot = clonePersistedEntry(entry);
          return persistRecord(snapshot)
            .catch(function (err) {
              entry.dirty = true;
              scheduleFlush(entry);
              throw err;
            })
            .then(function () {
              return flushLoop();
            });
        }

        entry.persisting = true;
        entry.pendingFlush = flushLoop()
          .finally(function () {
            entry.persisting = false;
            entry.pendingFlush = null;
            emitChange();
          });
        return entry.pendingFlush;
      }

      function markDirty(entry) {
        if (!entry) return;
        entry.modified = Date.now();
        entry.dirty = true;
        scheduleFlush(entry);
        emitChange();
      }

      function getImageBytes(entry) {
        if (!entry || entry.imageIndex < 0 || !getDiskImageBytes) return null;
        const bytes = getDiskImageBytes(entry.imageIndex);
        return bytes ? cloneBytes(bytes) : null;
      }

      function onDiskMediaChanged(imageIndex, deviceSlot) {
        const index = imageIndex | 0;
        const imageInfo = getDiskImageInfo ? getDiskImageInfo(index) : null;
        if (getDiskImageInfo && imageInfo && !imageInfo.libraryId) return;
        let changed = imageInfo && imageInfo.libraryId
          ? getEntry(imageInfo.libraryId)
          : null;
        if (!changed) {
          entries.forEach(function (entry) {
            if (!changed && entry.imageIndex === index) changed = entry;
          });
        }
        if (!changed) return;
        if (imageInfo && imageInfo.libraryId && imageInfo.libraryId !== changed.id) return;
        if (typeof deviceSlot === "number") changed.slot = deviceSlot | 0;
        changed.imageIndex = index;
        const bytes = getImageBytes(changed);
        if (!bytes) return;
        changed.runtimeBytes = bytes;
        changed.runtimeName = currentName(changed);
        markDirty(changed);
      }

      function reconcileMounts() {
        if (!getMountedDiskForDeviceSlot) return Promise.resolve();
        const mountedByLibraryId = new Map();
        for (let slot = 0; slot < 8; slot++) {
          const mounted = getMountedDiskForDeviceSlot(slot);
          if (mounted && mounted.libraryId) {
            mountedByLibraryId.set(String(mounted.libraryId), {
              slot: slot,
              imageIndex: mounted.imageIndex | 0,
            });
          }
        }
        const pending = [];
        entries.forEach(function (entry) {
          const match = mountedByLibraryId.get(entry.id) || null;
          const nextSlot = match ? match.slot | 0 : -1;
          const nextImageIndex = match ? match.imageIndex | 0 : -1;
          if (entry.slot === nextSlot && entry.imageIndex === nextImageIndex) return;
          entry.slot = nextSlot;
          entry.imageIndex = nextImageIndex;
          pending.push(persistRecord(entry));
        });
        return Promise.all(pending).then(function () {
          emitChange();
        });
      }

      function entryUsingSlot(slot) {
        const target = slot | 0;
        let result = null;
        entries.forEach(function (entry) {
          if (!result && entry.slot === target) result = entry;
        });
        return result;
      }

      function mountFile(id, slot) {
        const entry = getEntry(id);
        const targetSlot = slot | 0;
        if (!entry) return Promise.reject(new Error("Disk library entry not found"));
        if (!mountDisk) return Promise.reject(new Error("Disk mounting is unavailable"));
        if (targetSlot < 0 || targetSlot >= 8) {
          return Promise.reject(new Error("Disk drive out of range"));
        }

        const occupying = entryUsingSlot(targetSlot);
        const oldSlot = entry.slot | 0;
        let work = Promise.resolve();
        if (occupying && occupying.id !== entry.id) {
          work = flushEntry(occupying).then(function () {
            if (unmountDisk) return unmountDisk(targetSlot);
            return undefined;
          }).then(function () {
            occupying.slot = -1;
            occupying.imageIndex = -1;
            return persistRecord(occupying);
          });
        }
        if (oldSlot >= 0 && oldSlot !== targetSlot) {
          work = work.then(function () {
            if (unmountDisk) return unmountDisk(oldSlot);
            return undefined;
          }).then(function () {
            entry.slot = -1;
            entry.imageIndex = -1;
            return persistRecord(entry);
          });
        }

        const source = entry.runtimeBytes || entry.sourceBytes;
        const mountName = entry.runtimeBytes ? currentName(entry) : entry.name;
        return work.then(function () {
          return Promise.resolve(
            mountDisk(cloneBytes(source), mountName, targetSlot, {
              diskLibraryId: entry.id,
            }),
          );
        }).then(function (result) {
          const info = result || {};
          entry.slot = targetSlot;
          entry.imageIndex = info.imageIndex === undefined ? -1 : info.imageIndex | 0;
          const mountedBytes = getImageBytes(entry);
          if (mountedBytes) {
            entry.runtimeBytes = mountedBytes;
            entry.runtimeName = currentName(entry);
          }
          return persistRecord(entry).then(function () {
            emitChange();
            return getFileInfo(entry.id);
          });
        });
      }

      function unmountFile(id) {
        const entry = getEntry(id);
        if (!entry) return Promise.reject(new Error("Disk library entry not found"));
        if (entry.slot < 0) return flushEntry(entry);
        const slot = entry.slot | 0;
        return flushEntry(entry).then(function () {
          if (unmountDisk) return unmountDisk(slot);
          return undefined;
        }).then(function () {
          entry.slot = -1;
          entry.imageIndex = -1;
          return persistRecord(entry);
        }).then(function () {
          emitChange();
          return getFileInfo(entry.id);
        });
      }

      function flush(id) {
        return flushEntry(getEntry(id));
      }

      function downloadFile(id) {
        const entry = getEntry(id);
        if (!entry) return Promise.reject(new Error("Disk library entry not found"));
        return flushEntry(entry).then(function () {
          const bytes = currentBytes(entry);
          return {
            id: entry.id,
            name: currentName(entry),
            originalName: entry.name,
            format: entry.format,
            converted: entry.format === "xex" && !!entry.runtimeBytes,
            buffer: cloneBytes(bytes).buffer,
          };
        });
      }

      function deleteFile(id) {
        const entry = getEntry(id);
        if (!entry) return Promise.reject(new Error("Disk library entry not found"));
        return unmountFile(id).then(function () {
          entry.deletedAt = Date.now();
          trash.set(entry.id, entry);
          entries.delete(entry.id);
          return persistDeleteAtomically(entry).catch(function (err) {
            trash.delete(entry.id);
            entries.set(entry.id, entry);
            throw err;
          });
        }).then(function () {
          emitChange();
          return true;
        });
      }

      function restoreTrash(id, options) {
        const entry = trash.get(String(id || ""));
        const config = options && typeof options === "object" ? options : {};
        if (!entry) return Promise.reject(new Error("Disk library trash entry not found"));
        const targetFolder = String(config.folderId || entry.folderId || ROOT_FOLDER_ID);
        const targetName = normalizeName(config.name || entry.name);
        if (!getFolder(targetFolder)) return Promise.reject(new Error("Target folder not found"));
        if (!targetName || !isSupportedName(targetName)) {
          return Promise.reject(new Error("Only ATR and XEX files are supported"));
        }
        const duplicate = findByLogicalName(targetName, targetFolder);
        if (duplicate) return Promise.reject(new Error("A disk library entry with that name already exists"));
        const restored = hydrateRecord(clonePersistedEntry(entry));
        restored.name = targetName;
        restored.logicalName = logicalName(targetName);
        restored.folderId = targetFolder;
        restored.slot = -1;
        restored.imageIndex = -1;
        restored.dirty = false;
        delete restored.deletedAt;
        entries.set(restored.id, restored);
        trash.delete(entry.id);
        return persistRestoreAtomically(restored, entry.id).catch(function (err) {
          entries.delete(restored.id);
          trash.set(entry.id, entry);
          throw err;
        }).then(function () {
          emitChange();
          return getFileInfo(restored.id);
        });
      }

      function purgeTrash(id) {
        const entry = trash.get(String(id || ""));
        if (!entry) return Promise.reject(new Error("Disk library trash entry not found"));
        trash.delete(entry.id);
        return deleteTrashRecord(entry.id).catch(function (err) {
          trash.set(entry.id, entry);
          throw err;
        }).then(function () {
          emitChange();
          return true;
        });
      }

      function purgeAllTrash() {
        const ids = Array.from(trash.keys());
        let pending = Promise.resolve();
        ids.forEach(function (id) {
          pending = pending.then(function () { return purgeTrash(id); });
        });
        return pending.then(function () { return ids.length; });
      }

      function purgeTrashBefore(cutoff) {
        const threshold = Number(cutoff);
        if (!Number.isFinite(threshold)) {
          return Promise.reject(new Error("Invalid trash cutoff"));
        }
        const ids = [];
        trash.forEach(function (entry) {
          if (Number(entry.deletedAt || 0) < threshold) ids.push(entry.id);
        });
        let pending = Promise.resolve();
        ids.forEach(function (id) {
          pending = pending.then(function () { return purgeTrash(id); });
        });
        return pending.then(function () { return ids.length; });
      }

      function suggestBlankAtrName(folderId) {
        const targetFolder = String(folderId || ROOT_FOLDER_ID);
        const used = new Set();
        entries.forEach(function (entry) {
          if ((entry.folderId || ROOT_FOLDER_ID) === targetFolder) used.add(entry.name.toUpperCase());
        });
        let number = 1;
        let name = "blank.atr";
        while (used.has(name.toUpperCase())) {
          number++;
          name = "blank-" + number + ".atr";
        }
        return name;
      }

      function createBlankAtr(name, folderId) {
        const targetFolder = String(folderId || ROOT_FOLDER_ID);
        if (!getFolder(targetFolder)) return Promise.reject(new Error("Target folder not found"));
        let normalized = normalizeName(name) || suggestBlankAtrName(targetFolder);
        if (!/\.atr$/i.test(normalized)) normalized += ".atr";
        if (!isSupportedName(normalized) || getExtension(normalized) !== "atr") {
          return Promise.reject(new Error("Blank disk name must use the ATR extension"));
        }
        if (findByLogicalName(normalized, targetFolder)) {
          const error = new Error("A disk library entry with that name already exists");
          error.code = "disk_library_duplicate";
          return Promise.reject(error);
        }
        return addFile(normalized, createBlankAtrBytes(), targetFolder);
      }

      function getPackageApi() {
        return window.A8ELibraryPackage && window.A8ELibraryPackage.createApi
          ? window.A8ELibraryPackage.createApi()
          : null;
      }

      function reportOperationProgress(options, phase, completed, total, current) {
        const config = options && typeof options === "object" ? options : {};
        if ((config.signal && config.signal.aborted) ||
            (typeof config.isCanceled === "function" && config.isCanceled())) {
          const error = new Error("A8E library operation canceled");
          error.code = "a8e_library_canceled";
          throw error;
        }
        if (typeof config.onProgress === "function") {
          config.onProgress({
            phase: phase,
            completed: completed,
            total: total,
            current: current || "",
          });
        }
      }

      function exportPackage(options) {
        const packageApi = getPackageApi();
        if (!packageApi) return Promise.reject(new Error("A8E library package support is unavailable"));
        const config = options && typeof options === "object" ? options : {};
        const workspaceOnly = !!config.workspaceOnly;
        const records = [];
        const total = Array.from(entries.values()).filter(function (entry) {
          return !workspaceOnly || (entry.slot >= 0 && entry.slot < 8);
        }).length;
        let completed = 0;
        reportOperationProgress(config, "prepare", completed, total, "");
        let pending = Promise.resolve();
        entries.forEach(function (entry) {
          if (workspaceOnly && (entry.slot < 0 || entry.slot >= 8)) return;
          pending = pending.then(function () {
            return flushEntry(entry).then(function () {
              reportOperationProgress(config, "flush", ++completed, total, entry.name);
              records.push({
                id: entry.id,
                name: currentName(entry),
                format: entry.format === "xex" && entry.runtimeBytes ? "atr" : entry.format,
                bytes: currentBytes(entry),
                created: entry.created,
                modified: entry.modified,
                folderId: entry.folderId || ROOT_FOLDER_ID,
                mountedSlot: entry.slot,
                revisions: (entry.revisions || []).map(function (revision) {
                  return {
                    id: revision.id,
                    bytes: cloneBytes(revision.bytes),
                    created: revision.created,
                    modified: revision.modified,
                    parentId: revision.parentId || null,
                  };
                }),
                preferredRevisionId: entry.preferredRevisionId,
              });
            });
          });
        });
        return pending.then(function () {
          const devices = {};
          const writeProtected = {};
          records.forEach(function (record) {
            const entry = getEntry(record.id);
            if (entry.slot >= 0 && entry.slot < 8) {
              devices["D" + (entry.slot + 1)] = entry.id;
              writeProtected["D" + (entry.slot + 1)] = false;
            }
          });
          const selectedFolders = new Map();
          selectedFolders.set(ROOT_FOLDER_ID, folders.get(ROOT_FOLDER_ID));
          records.forEach(function (record) {
            let folder = folders.get(record.folderId || ROOT_FOLDER_ID);
            const seen = new Set();
            while (folder && !seen.has(folder.id)) {
              seen.add(folder.id);
              selectedFolders.set(folder.id, folder);
              folder = folder.parentId ? folders.get(folder.parentId) : null;
            }
          });
          return packageApi.exportPackage(records, {
            libraryVersion: config.libraryVersion || libraryVersion,
            createdAt: config.createdAt,
            folders: Array.from(selectedFolders.values()),
            workspace: { devices: devices, writeProtected: writeProtected },
            scope: workspaceOnly ? "workspace" : config.scope,
            fileName: config.fileName || (workspaceOnly ? "workspace.a8e" : "library.a8e"),
            onProgress: config.onProgress,
            isCanceled: config.isCanceled,
            signal: config.signal,
          });
        }).then(function (result) {
          return {
            buffer: result.bytes.buffer,
            manifest: result.manifest,
            fileName: result.fileName,
          };
        });
      }

      function exportWorkspacePackage(options) {
        const config = Object.assign({}, options || {}, { workspaceOnly: true });
        return exportPackage(config);
      }

      function inspectPackage(data) {
        const packageApi = getPackageApi();
        if (!packageApi) return Promise.reject(new Error("A8E library package support is unavailable"));
        return packageApi.importPackage(data);
      }

      function localPackageRecords() {
        const records = [];
        entries.forEach(function (entry) {
          records.push({
            id: entry.id,
            name: currentName(entry),
            format: entry.format === "xex" && entry.runtimeBytes ? "atr" : entry.format,
            bytes: cloneBytes(currentBytes(entry)),
            created: entry.created,
            modified: entry.modified,
            folderId: entry.folderId || ROOT_FOLDER_ID,
            revisions: (entry.revisions || []).map(function (revision) {
              return {
                id: revision.id,
                bytes: cloneBytes(revision.bytes),
                created: revision.created,
                modified: revision.modified,
                parentId: revision.parentId || null,
              };
            }),
            preferredRevisionId: entry.preferredRevisionId,
          });
        });
        return records;
      }

      function localPackageFolders() {
        return Array.from(folders.values()).map(function (folder) {
          return {
            id: folder.id,
            name: folder.name,
            parentId: folder.parentId,
            created: folder.created,
            modified: folder.modified,
          };
        });
      }

      function previewImport(data, options) {
        const packageApi = getPackageApi();
        if (!packageApi) return Promise.reject(new Error("A8E library package support is unavailable"));
        const config = options && typeof options === "object" ? options : {};
        return packageApi.importPackage(data, config).then(function (imported) {
          const plan = packageApi.planImport(
            localPackageRecords(), imported, localPackageFolders(), config);
          const warnings = [];
          if (imported.manifest.schemaVersion > 1) {
            warnings.push("The imported schema is newer; known fields only will be imported.");
          }
          if (imported.manifest.libraryVersion > libraryVersion) {
            warnings.push("The imported library is newer than this local library.");
          }
          plan.warning = warnings.join(" ");
          return plan;
        });
      }

      function cloneImportedEntry(record) {
        const entry = makeEntry(record.name, record.bytes, record.id);
        entry.folderId = record.folderId || ROOT_FOLDER_ID;
        entry.created = Number.isFinite(record.created) ? record.created : Date.now();
        entry.modified = Number.isFinite(record.modified) ? record.modified : entry.created;
        entry.slot = -1;
        if (Array.isArray(record.revisions) && record.revisions.length) {
          entry.revisions = record.revisions.map(function (revision) {
            return {
              id: revision.id,
              bytes: cloneBytes(revision.bytes),
              created: Number.isFinite(revision.created) ? revision.created : entry.created,
              modified: Number.isFinite(revision.modified) ? revision.modified : entry.modified,
              parentId: revision.parentId || null,
            };
          });
          entry.preferredRevisionId = record.preferredRevisionId || entry.revisions[entry.revisions.length - 1].id;
        }
        return entry;
      }

      function cloneImportedFolder(record) {
        return {
          id: record.id,
          name: record.name,
          parentId: record.parentId || ROOT_FOLDER_ID,
          created: Number.isFinite(record.created) ? record.created : Date.now(),
          modified: Number.isFinite(record.modified) ? record.modified : Date.now(),
        };
      }

      function persistImportAtomically(importedFolders, importedEntries, updatedEntries, nextVersion) {
        const committedVersion = Math.max(1, nextVersion | 0);
        if (!db) {
          libraryVersion = committedVersion;
          return Promise.resolve();
        }
        let tx;
        try {
          tx = db.transaction([STORE_NAME, FOLDER_STORE_NAME, META_STORE_NAME], "readwrite");
        } catch (err) {
          return Promise.reject(err);
        }
        return new Promise(function (resolve, reject) {
          const entryStore = tx.objectStore(STORE_NAME);
          const folderStore = tx.objectStore(FOLDER_STORE_NAME);
          importedFolders.forEach(function (folder) {
            folderStore.put(clonePersistedFolder(folder));
          });
          importedEntries.forEach(function (entry) {
            entryStore.put(clonePersistedEntry(entry));
          });
          updatedEntries.forEach(function (entry) {
            entryStore.put(clonePersistedEntry(entry));
          });
          const metadataStore = tx.objectStore(META_STORE_NAME);
          metadataStore.put({ key: "libraryVersion", value: committedVersion });
          tx.oncomplete = function () {
            libraryVersion = committedVersion;
            resolve();
          };
          tx.onabort = function () {
            reject(tx.error || new Error("Disk library import transaction aborted"));
          };
          tx.onerror = function () {
            reject(tx.error || new Error("Disk library import transaction failed"));
          };
        });
      }

      function importPackage(data, options) {
        const config = options && typeof options === "object" ? options : {};
        return previewImport(data, config).then(function (plan) {
          reportOperationProgress(config, "commit", 0, 1, "library.json");
          const importedFolders = plan.folders.map(cloneImportedFolder);
          const importedEntries = plan.additions.map(cloneImportedEntry);
          const updatedEntries = [];
          (plan.historyUpdates || []).forEach(function (update) {
            const entry = getEntry(update.id);
            if (!entry) return;
            const known = new Set((entry.revisions || []).map(function (revision) { return revision.id; }));
            const merged = Object.assign({}, entry, {
              revisions: (entry.revisions || []).map(function (revision) {
                return {
                  id: revision.id,
                  bytes: cloneBytes(revision.bytes),
                  created: revision.created,
                  modified: revision.modified,
                  parentId: revision.parentId || null,
                };
              }),
            });
            (update.revisions || []).forEach(function (revision) {
              if (known.has(revision.id)) return;
              merged.revisions.push({
                id: revision.id,
                bytes: cloneBytes(revision.bytes),
                created: revision.created,
                modified: revision.modified,
                parentId: revision.parentId || null,
              });
            });
            merged.preferredRevisionId = update.preferredRevisionId || merged.preferredRevisionId;
            updatedEntries.push(merged);
          });
          const nextVersion = Math.max(libraryVersion + 1, plan.manifest.libraryVersion | 0);
          return persistImportAtomically(importedFolders, importedEntries, updatedEntries, nextVersion).then(function () {
            importedFolders.forEach(function (folder) {
              folders.set(folder.id, folder);
            });
            importedEntries.forEach(function (entry) {
              entries.set(entry.id, entry);
            });
            updatedEntries.forEach(function (entry) {
              const local = getEntry(entry.id);
              if (local) {
                local.revisions = entry.revisions;
                local.preferredRevisionId = entry.preferredRevisionId;
              }
            });
            emitChange();
            const restored = [];
            const mountErrors = [];
            let pending = Promise.resolve();
            plan.mounts.forEach(function (mount) {
              pending = pending.then(function () {
                if (!mountDisk) return;
                return mountFile(mount.id, mount.slot)
                  .then(function () { restored.push(mount); })
                  .catch(function (err) {
                    mountErrors.push({ id: mount.id, slot: mount.slot, error: err && err.message ? err.message : String(err) });
                  });
              });
            });
            return pending.then(function () {
              return {
                summary: plan.summary,
                warning: plan.warning,
                libraryVersion: libraryVersion,
                restoredMounts: restored,
                mountErrors: mountErrors,
              };
            });
          });
        });
      }

      function restoreMounts() {
        let pending = Promise.resolve();
        entries.forEach(function (entry) {
          if (entry.slot >= 0) {
            const requestedSlot = entry.slot | 0;
            pending = pending.then(function () {
              entry.slot = -1;
              entry.imageIndex = -1;
              return mountFile(entry.id, requestedSlot);
            });
          }
        });
        return pending.then(function () {
          mountsRestored = true;
          emitChange();
        });
      }

      return {
        init: init,
        isReady: isReady,
        isRestored: isRestored,
        getFolder: getFolder,
        getFolderPath: getFolderPath,
        listFolders: listFolders,
        listAllFolders: listAllFolders,
        listAllFiles: listAllFiles,
        listTrash: listTrash,
        createFolder: createFolder,
        suggestBlankAtrName: suggestBlankAtrName,
        createBlankAtr: createBlankAtr,
        renameFolder: renameFolder,
        deleteFolder: deleteFolder,
        moveFile: moveFile,
        listFiles: listFiles,
        getFileInfo: getFileInfo,
        getStorageEstimate: getStorageEstimate,
        listRevisions: listRevisions,
        selectRevision: selectRevision,
        verifyFile: verifyFile,
        verifyLibrary: verifyLibrary,
        addFile: addFile,
        replaceFile: replaceFile,
        mountFile: mountFile,
        unmountFile: unmountFile,
        flush: flush,
        downloadFile: downloadFile,
        deleteFile: deleteFile,
        restoreTrash: restoreTrash,
        purgeTrash: purgeTrash,
        purgeAllTrash: purgeAllTrash,
        purgeTrashBefore: purgeTrashBefore,
        exportPackage: exportPackage,
        exportWorkspacePackage: exportWorkspacePackage,
        inspectPackage: inspectPackage,
        previewImport: previewImport,
        importPackage: importPackage,
        getLibraryVersion: function () { return libraryVersion; },
        restoreMounts: restoreMounts,
        reconcileMounts: reconcileMounts,
        onDiskMediaChanged: onDiskMediaChanged,
        onChange: onChange,
      };
    }

    return { create: create };
  }

  window.A8EDiskLibrary = { createApi: createApi };
})();
