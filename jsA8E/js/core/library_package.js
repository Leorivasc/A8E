(function () {
  "use strict";

  const FORMAT = "a8e-library-export";
  const SCHEMA_VERSION = 1;
  const HASH_LENGTH = 64;
  const DEFAULT_MAX_PACKAGE_BYTES = 256 * 1024 * 1024;
  const DEFAULT_MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
  const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;
  const DEFAULT_MAX_PAYLOAD_TOTAL = 256 * 1024 * 1024;

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

  function fail(message) {
    throw new Error("Invalid A8E library package: " + message);
  }

  function operationCanceled(options) {
    return options && ((options.signal && options.signal.aborted) ||
      (typeof options.isCanceled === "function" && options.isCanceled()));
  }

  function canceledError() {
    const error = new Error("A8E library operation canceled");
    error.code = "a8e_library_canceled";
    return error;
  }

  function packageLimits(options) {
    const config = options && typeof options === "object" ? options : {};
    function value(candidate, fallback) {
      return Number.isFinite(candidate) && candidate > 0
        ? Math.floor(candidate) : fallback;
    }
    return {
      maxPackageBytes: value(config.maxPackageBytes, DEFAULT_MAX_PACKAGE_BYTES),
      maxManifestBytes: value(config.maxManifestBytes, DEFAULT_MAX_MANIFEST_BYTES),
      maxPayloadBytes: value(config.maxPayloadBytes, DEFAULT_MAX_PAYLOAD_BYTES),
      maxPayloadTotal: value(config.maxPayloadTotal, DEFAULT_MAX_PAYLOAD_TOTAL),
    };
  }

  function enforcePackageLimits(entries, manifestBytes, options) {
    const limits = packageLimits(options);
    if (manifestBytes.length > limits.maxManifestBytes) {
      fail("manifest exceeds configured size limit");
    }
    let payloadTotal = 0;
    (entries || []).forEach(function (entry) {
      if (!entry || typeof entry.name !== "string" || !entry.name.startsWith("blobs/")) return;
      if (entry.bytes.length > limits.maxPayloadBytes) {
        fail("payload exceeds configured size limit");
      }
      payloadTotal += entry.bytes.length;
      if (payloadTotal > limits.maxPayloadTotal) {
        fail("payloads exceed configured size limit");
      }
    });
    return limits;
  }

  function reportProgress(options, phase, completed, total, current) {
    if (operationCanceled(options)) throw canceledError();
    if (options && typeof options.onProgress === "function") {
      options.onProgress({
        phase: phase,
        completed: completed,
        total: total,
        current: current || "",
      });
    }
    if (operationCanceled(options)) throw canceledError();
  }

  function readU32(bytes, offset) {
    return (
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]
    ) >>> 0;
  }

  function rotr(value, bits) {
    return (value >>> bits) | (value << (32 - bits));
  }

  function sha256(data) {
    const bytes = toUint8(data);
    const words = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
      0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
      0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
      0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
      0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
      0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    const h = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    const bitLength = bytes.length * 8;
    const paddedLength = (((bytes.length + 9) + 63) >> 6) << 6;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const high = Math.floor(bitLength / 0x100000000);
    const low = bitLength >>> 0;
    padded[paddedLength - 8] = (high >>> 24) & 0xff;
    padded[paddedLength - 7] = (high >>> 16) & 0xff;
    padded[paddedLength - 6] = (high >>> 8) & 0xff;
    padded[paddedLength - 5] = high & 0xff;
    padded[paddedLength - 4] = (low >>> 24) & 0xff;
    padded[paddedLength - 3] = (low >>> 16) & 0xff;
    padded[paddedLength - 2] = (low >>> 8) & 0xff;
    padded[paddedLength - 1] = low & 0xff;

    for (let offset = 0; offset < padded.length; offset += 64) {
      const schedule = new Uint32Array(64);
      for (let i = 0; i < 16; i++) schedule[i] = readU32(padded, offset + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = schedule[i - 15];
        const b = schedule[i - 2];
        const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
        const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
        schedule[i] = (schedule[i - 16] + s0 + schedule[i - 7] + s1) >>> 0;
      }
      let a = h[0]; let b = h[1]; let c = h[2]; let d = h[3];
      let e = h[4]; let f = h[5]; let g = h[6]; let k = h[7];
      for (let i = 0; i < 64; i++) {
        const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const choice = (e & f) ^ (~e & g);
        const temp1 = (k + s1 + choice + words[i] + schedule[i]) >>> 0;
        const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (s0 + majority) >>> 0;
        k = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
      h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
      h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + k) >>> 0;
    }
    return h.map(function (value) { return value.toString(16).padStart(8, "0"); }).join("");
  }

  function validTime(value) {
    return typeof value === "string" && !Number.isNaN(Date.parse(value));
  }

  function validId(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 256;
  }

  function validFolderName(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 256 &&
      value !== "." && value !== ".." && !value.includes("/");
  }

  function validateManifest(manifest) {
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) fail("manifest is not an object");
    if (manifest.format !== FORMAT) fail("unsupported format");
    if (!Number.isInteger(manifest.schemaVersion) || manifest.schemaVersion < SCHEMA_VERSION) {
      fail("unsupported schemaVersion");
    }
    if (!Number.isInteger(manifest.libraryVersion) || manifest.libraryVersion < 1) fail("invalid libraryVersion");
    if (manifest.scope !== undefined && manifest.scope !== "library" && manifest.scope !== "workspace") fail("invalid scope");
    if (!validTime(manifest.createdAt)) fail("invalid createdAt");
    if (!Array.isArray(manifest.library)) fail("library must be an array");
    const folderIds = new Set(["root"]);
    if (manifest.folders !== undefined) {
      if (!Array.isArray(manifest.folders)) fail("folders must be an array");
      manifest.folders.forEach(function (folder) {
        if (!folder || !validId(folder.id) || (folder.id !== "root" && folderIds.has(folder.id))) fail("duplicate or invalid folder id");
        if (!validFolderName(folder.name)) fail("invalid folder name");
        if (folder.parentId !== null && folder.parentId !== undefined && !validId(folder.parentId)) fail("invalid folder parent");
        if (!validTime(folder.createdAt) || !validTime(folder.modifiedAt)) fail("invalid folder timestamp");
        folderIds.add(folder.id);
      });
      const root = manifest.folders.find(function (folder) { return folder.id === "root"; });
      if (root && root.parentId !== null && root.parentId !== undefined) fail("root folder has a parent");
      manifest.folders.forEach(function (folder) {
        if (folder.parentId !== null && folder.parentId !== undefined && !folderIds.has(folder.parentId)) fail("missing folder parent");
      });
    }
    const ids = new Set();
    manifest.library.forEach(function (entry) {
      if (!entry || typeof entry !== "object") fail("invalid library entry");
      if (!validId(entry.id) || ids.has(entry.id)) fail("duplicate or invalid entry id");
      ids.add(entry.id);
      if (typeof entry.name !== "string" || !entry.name || entry.name.includes("/")) fail("invalid entry name");
      if (entry.type !== "atr" && entry.type !== "xex") fail("unsupported entry type");
      if (!/^blobs\/[0-9a-f]{64}\.(atr|xex)$/.test(entry.path)) fail("invalid blob path");
      if (entry.path.endsWith("." + entry.type) === false) fail("blob type mismatch");
      // Multiple library entries may intentionally reference the same
      // content-addressed blob. The archive stores that binary once while
      // preserving each entry's name, folder, timestamps, and identity.
      if (!Number.isInteger(entry.size) || entry.size < 0) fail("invalid entry size");
      if (!/^[0-9a-f]{64}$/.test(entry.sha256) || entry.sha256 !== entry.path.substring(6, 70)) fail("invalid entry sha256");
      if (!validTime(entry.createdAt) || !validTime(entry.modifiedAt)) fail("invalid entry timestamp");
      if (entry.mountedSlot !== undefined && (!Number.isInteger(entry.mountedSlot) || entry.mountedSlot < -1 || entry.mountedSlot > 7)) fail("invalid mountedSlot");
      if (entry.folderId !== undefined && !folderIds.has(entry.folderId)) fail("invalid entry folder");
      if (entry.revisions !== undefined) {
        if (!Array.isArray(entry.revisions)) fail("invalid entry revisions");
        const revisionIds = new Set();
        entry.revisions.forEach(function (revision) {
          if (!revision || !validId(revision.id) || revisionIds.has(revision.id)) fail("invalid revision id");
          revisionIds.add(revision.id);
          if (!/^blobs\/[0-9a-f]{64}\.(atr|xex)$/.test(revision.path)) fail("invalid revision blob path");
          if (!revision.path.endsWith("." + entry.type)) fail("revision blob type mismatch");
          if (!Number.isInteger(revision.size) || revision.size < 0) fail("invalid revision size");
          if (!/^[0-9a-f]{64}$/.test(revision.sha256) || revision.sha256 !== revision.path.substring(6, 70)) fail("invalid revision sha256");
          if (!validTime(revision.createdAt) || !validTime(revision.modifiedAt)) fail("invalid revision timestamp");
          if (revision.parentId !== undefined && revision.parentId !== null && !validId(revision.parentId)) fail("invalid revision parent");
        });
        if (entry.preferredRevisionId !== undefined && !revisionIds.has(entry.preferredRevisionId)) fail("invalid preferred revision");
      }
    });
    if (manifest.workspace !== undefined) {
      if (!manifest.workspace || typeof manifest.workspace !== "object") fail("invalid workspace");
      const devices = manifest.workspace.devices || {};
      const seenIds = new Set();
      Object.keys(devices).forEach(function (device) {
        if (!/^D[1-8]$/.test(device) || !validId(devices[device])) fail("invalid workspace device");
        if (seenIds.has(devices[device])) fail("entry mounted in two devices");
        seenIds.add(devices[device]);
      });
    }
    return true;
  }

  function makeManifest(records, options) {
    const config = options || {};
    const now = config.createdAt || new Date().toISOString();
    const library = (records || []).map(function (record) {
      const bytes = cloneBytes(record.bytes);
      const hash = sha256(bytes);
      const type = String(record.format || "").toLowerCase();
      if (type !== "atr" && type !== "xex") fail("unsupported record type");
      const result = {
        id: String(record.id || ""),
        name: String(record.name || ""),
        type: type,
        path: "blobs/" + hash + "." + type,
        size: bytes.length,
        sha256: hash,
        createdAt: new Date(record.created || Date.now()).toISOString(),
        modifiedAt: new Date(record.modified || Date.now()).toISOString(),
        mountedSlot: typeof record.mountedSlot === "number" ? record.mountedSlot | 0 : -1,
        folderId: record.folderId || "root",
      };
      if (Array.isArray(record.revisions) && record.revisions.length) {
        result.revisions = record.revisions.map(function (revision) {
          const revisionBytes = cloneBytes(revision.bytes);
          const revisionHash = sha256(revisionBytes);
          return {
            id: String(revision.id || "revision-" + revisionHash.substring(0, 12)),
            path: "blobs/" + revisionHash + "." + type,
            size: revisionBytes.length,
            sha256: revisionHash,
            createdAt: new Date(revision.created || Date.now()).toISOString(),
            modifiedAt: new Date(revision.modified || Date.now()).toISOString(),
            parentId: revision.parentId || null,
          };
        });
        if (record.preferredRevisionId) result.preferredRevisionId = String(record.preferredRevisionId);
      }
      return result;
    });
    const manifest = {
      format: FORMAT,
      schemaVersion: SCHEMA_VERSION,
      libraryVersion: Number.isInteger(config.libraryVersion) && config.libraryVersion > 0 ? config.libraryVersion : 1,
      createdAt: now,
      library: library,
    };
    if (config.scope) manifest.scope = config.scope;
    if (Array.isArray(config.folders)) {
      manifest.folders = config.folders.map(function (folder) {
        return {
          id: String(folder.id || ""),
          name: String(folder.name || ""),
          parentId: folder.parentId === undefined ? null : folder.parentId,
          createdAt: new Date(folder.created || Date.now()).toISOString(),
          modifiedAt: new Date(folder.modified || Date.now()).toISOString(),
        };
      });
      if (!manifest.folders.some(function (folder) { return folder.id === "root"; })) {
        manifest.folders.unshift({
          id: "root",
          name: "Library",
          parentId: null,
          createdAt: now,
          modifiedAt: now,
        });
      }
    }
    if (config.workspace) manifest.workspace = config.workspace;
    validateManifest(manifest);
    return manifest;
  }

  function importedName(name, format, usedNames, folderId) {
    const value = String(name || "disk." + format);
    const dot = value.lastIndexOf(".");
    const base = dot > 0 ? value.substring(0, dot) : value;
    const extension = dot > 0 ? value.substring(dot) : "." + format;
    let suffix = 1;
    let candidate = base + "(" + suffix + ")" + extension;
    while (usedNames.has(importedNameKey(folderId, candidate))) {
      suffix++;
      candidate = base + "(" + suffix + ")" + extension;
    }
    return candidate;
  }

  function importedNameKey(folderId, name) {
    return String(folderId || "root") + "\n" + String(name || "").toUpperCase();
  }

  function planImport(localRecords, importedPackage, localFolders, options) {
    if (!importedPackage || !importedPackage.manifest || !Array.isArray(importedPackage.entries)) {
      fail("import package is incomplete");
    }
    const localById = new Map();
    const localByHash = new Map();
    const usedNames = new Set();
    const localFolderById = new Map();
    const localFolderNames = new Map();
    (localFolders || [{ id: "root", name: "Library", parentId: null }]).forEach(function (folder) {
      const id = String(folder.id || "");
      if (!id) return;
      localFolderById.set(id, folder);
      const key = String(folder.parentId || "root") + "\n" + String(folder.name || "").toUpperCase();
      localFolderNames.set(key, id);
    });
    (localRecords || []).forEach(function (record) {
      const id = String(record.id || "");
      const name = String(record.name || "");
      const hash = record.sha256 || sha256(record.bytes);
      if (id) localById.set(id, Object.assign({}, record, { sha256: hash }));
      if (hash) localByHash.set(hash, Object.assign({}, record, { sha256: hash }));
      if (name) usedNames.add(importedNameKey(record.folderId, name));
    });
    const additions = [];
    const historyUpdates = [];
    const resolvedIds = new Map();
    const summary = {
      added: 0,
      duplicates: 0,
      conflicts: 0,
      renamed: 0,
      mounts: 0,
      foldersAdded: 0,
      newer: 0,
      older: 0,
      concurrent: 0,
      revisions: 0,
      payloads: 0,
    };

    const payloadPaths = new Set();
    importedPackage.entries.forEach(function (item) {
      if (item && item.manifest && item.manifest.path) payloadPaths.add(item.manifest.path);
      (item && item.revisions || []).forEach(function (revision) {
        if (revision && revision.manifest && revision.manifest.path) {
          payloadPaths.add(revision.manifest.path);
        }
      });
    });
    summary.payloads = payloadPaths.size;

    const folderMap = new Map([["root", "root"]]);
    const folders = [];
    const importedFolders = Array.isArray(importedPackage.manifest.folders)
      ? importedPackage.manifest.folders.slice()
      : [];
    importedFolders.sort(function (a, b) {
      return (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0);
    });
    importedFolders.forEach(function (folder) {
      if (folder.id === "root") return;
      const parentId = folderMap.get(folder.parentId || "root") || "root";
      const sameId = localFolderById.get(folder.id) || null;
      let id = folder.id;
      let name = folder.name;
      if (sameId && String(sameId.name).toUpperCase() === String(name).toUpperCase() && String(sameId.parentId || "root") === parentId) {
        folderMap.set(folder.id, sameId.id);
        return;
      }
      if (sameId) id = folder.id + "-import";
      while (localFolderById.has(id) || folders.some(function (item) { return item.id === id; })) id += "-2";
      let nameKey = parentId + "\n" + name.toUpperCase();
      if (localFolderNames.has(nameKey)) {
        let suffix = 1;
        const base = name;
        do {
          suffix++;
          name = base + "(" + (suffix - 1) + ")";
          nameKey = parentId + "\n" + name.toUpperCase();
        } while (localFolderNames.has(nameKey));
      }
      folderMap.set(folder.id, id);
      localFolderNames.set(nameKey, id);
      const addition = {
        id: id,
        name: name,
        parentId: parentId,
        created: Date.parse(folder.createdAt),
        modified: Date.parse(folder.modifiedAt),
      };
      folders.push(addition);
      summary.foldersAdded++;
    });

    importedPackage.entries.forEach(function (item, entryIndex) {
      reportProgress(options, "plan", entryIndex, importedPackage.entries.length, item.manifest.name);
      const manifest = item.manifest;
      const hash = manifest.sha256;
      const sameId = localById.get(manifest.id) || null;
      const sameHash = localByHash.get(hash) || null;
      const targetFolderId = folderMap.get(manifest.folderId || "root") || "root";
      if (sameId && sameId.sha256 === hash) {
        resolvedIds.set(manifest.id, sameId.id);
        summary.duplicates++;
        const knownRevisionIds = new Set((sameId.revisions || []).map(function (revision) { return revision.id; }));
        const missingRevisions = (item.revisions || []).filter(function (revision) {
          return !knownRevisionIds.has(revision.manifest.id);
        }).map(function (revision) {
          return {
            id: revision.manifest.id,
            bytes: cloneBytes(revision.bytes),
            created: Date.parse(revision.manifest.createdAt),
            modified: Date.parse(revision.manifest.modifiedAt),
            parentId: revision.manifest.parentId || null,
          };
        });
        if (missingRevisions.length) {
          historyUpdates.push({
            id: sameId.id,
            revisions: missingRevisions,
            preferredRevisionId: manifest.preferredRevisionId || null,
          });
          summary.revisions += missingRevisions.length;
        }
        return;
      }
      if (sameHash) {
        resolvedIds.set(manifest.id, sameHash.id);
        summary.duplicates++;
        return;
      }

      let id = manifest.id;
      let name = manifest.name;
      if (sameId) {
        id = manifest.id + "-import-" + hash.substring(0, 8);
        summary.conflicts++;
        const localModified = Number.isFinite(sameId.modified)
          ? sameId.modified
          : (Date.parse(sameId.modifiedAt || "") || 0);
        const importedModified = Date.parse(manifest.modifiedAt || "") || 0;
        if (importedModified > localModified) summary.newer++;
        else if (importedModified < localModified) summary.older++;
        else summary.concurrent++;
      }
      if (usedNames.has(importedNameKey(targetFolderId, name))) {
        name = importedName(name, manifest.type, usedNames, targetFolderId);
        summary.renamed++;
      }
      usedNames.add(importedNameKey(targetFolderId, name));
      resolvedIds.set(manifest.id, id);
      additions.push({
        id: id,
        name: name,
        format: manifest.type,
        bytes: cloneBytes(item.bytes),
        created: Date.parse(manifest.createdAt),
        modified: Date.parse(manifest.modifiedAt),
        mountedSlot: typeof manifest.mountedSlot === "number" ? manifest.mountedSlot : -1,
        folderId: targetFolderId,
        sha256: hash,
        preferredRevisionId: manifest.preferredRevisionId || null,
        revisions: (item.revisions || []).map(function (revision) {
          return {
            id: revision.manifest.id,
            bytes: cloneBytes(revision.bytes),
            created: Date.parse(revision.manifest.createdAt),
            modified: Date.parse(revision.manifest.modifiedAt),
            parentId: revision.manifest.parentId || null,
          };
        }),
      });
      summary.added++;
      summary.revisions += (item.revisions || []).length;
      localById.set(id, additions[additions.length - 1]);
      localByHash.set(hash, additions[additions.length - 1]);
    });

    const mounts = [];
    const occupiedSlots = new Set();
    const devices = importedPackage.manifest.workspace && importedPackage.manifest.workspace.devices
      ? importedPackage.manifest.workspace.devices
      : {};
    Object.keys(devices).forEach(function (device) {
      const slot = Number(device.substring(1)) - 1;
      const resolvedId = resolvedIds.get(devices[device]);
      if (slot < 0 || slot >= 8 || !resolvedId || occupiedSlots.has(slot)) return;
      occupiedSlots.add(slot);
      mounts.push({ id: resolvedId, slot: slot });
      summary.mounts++;
    });
    reportProgress(options, "plan", importedPackage.entries.length,
      importedPackage.entries.length, "");
    return {
      manifest: importedPackage.manifest,
      additions: additions,
      historyUpdates: historyUpdates,
      folders: folders,
      mounts: mounts,
      summary: summary,
    };
  }

  function exportPackage(records, options) {
    const archive = window.A8ELibraryArchive && window.A8ELibraryArchive.createApi
      ? window.A8ELibraryArchive.createApi()
      : null;
    if (!archive) return Promise.reject(new Error("A8E library archive codec is unavailable"));
    const config = options || {};
    const manifest = makeManifest(records, config);
    const entries = [{ name: "library.json", bytes: new TextEncoder().encode(JSON.stringify(manifest)) }];
    const seen = new Set();
    let total = 1;
    let completed = 0;
    (records || []).forEach(function (record) {
      total++;
      total += Array.isArray(record.revisions) ? record.revisions.length : 0;
    });
    reportProgress(config, "manifest", completed, total, "library.json");
    completed++;
    (records || []).forEach(function (record, index) {
      reportProgress(config, "export", completed, total, record.name);
      const bytes = cloneBytes(record.bytes);
      const type = manifest.library[index].type;
      const path = manifest.library[index].path;
      if (!seen.has(path)) {
        seen.add(path);
        entries.push({ name: path, bytes: bytes });
      }
      completed++;
      const revisions = manifest.library[index].revisions || [];
      (record.revisions || []).forEach(function (revision, revisionIndex) {
        reportProgress(config, "export", completed, total,
          revision.id || "revision");
        const revisionManifest = revisions[revisionIndex];
        completed++;
        if (!revisionManifest || seen.has(revisionManifest.path)) return;
        seen.add(revisionManifest.path);
        entries.push({ name: revisionManifest.path, bytes: cloneBytes(revision.bytes) });
      });
    });
    reportProgress(config, "archive", completed, total, config.fileName || "library.a8e");
    const manifestBytes = entries[0].bytes;
    const limits = enforcePackageLimits(entries, manifestBytes, config);
    return Promise.resolve(archive.write(entries)).then(function (bytes) {
      if (bytes.length > limits.maxPackageBytes) fail("archive exceeds configured size limit");
      return { bytes: cloneBytes(bytes), manifest: manifest, fileName: options && options.fileName || "library.a8e" };
    });
  }

  function importPackage(data, options) {
    const archive = window.A8ELibraryArchive && window.A8ELibraryArchive.createApi
      ? window.A8ELibraryArchive.createApi()
      : null;
    if (!archive) return Promise.reject(new Error("A8E library archive codec is unavailable"));
    const config = options || {};
    const packageBytes = toUint8(data);
    const limits = packageLimits(config);
    if (packageBytes.length > limits.maxPackageBytes) {
      return Promise.reject(new Error("Invalid A8E library package: archive exceeds configured size limit"));
    }
    reportProgress(config, "read", 0, 1, "library.json");
    return Promise.resolve().then(function () {
      const entries = archive.read(packageBytes);
      const byName = new Map();
      entries.forEach(function (entry) { byName.set(entry.name, entry.bytes); });
      const manifestBytes = byName.get("library.json");
      if (!manifestBytes) fail("library.json is missing");
      enforcePackageLimits(entries, manifestBytes, config);
      let manifest;
      try { manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)); }
      catch (err) { fail("library.json is not valid UTF-8 JSON"); }
      validateManifest(manifest);
      const result = [];
      const total = manifest.library.reduce(function (count, entry) {
        return count + 1 + (entry.revisions ? entry.revisions.length : 0);
      }, 0);
      let completed = 0;
      manifest.library.forEach(function (entry) {
        reportProgress(config, "validate", completed, total, entry.name);
        const bytes = byName.get(entry.path);
        if (!bytes) fail("missing blob for " + entry.id);
        if (bytes.length !== entry.size) fail("size mismatch for " + entry.id);
        if (sha256(bytes) !== entry.sha256) fail("SHA-256 mismatch for " + entry.id);
        const revisions = [];
        (entry.revisions || []).forEach(function (revision) {
          const revisionBytes = byName.get(revision.path);
          if (!revisionBytes) fail("missing revision blob for " + entry.id);
          if (revisionBytes.length !== revision.size) fail("revision size mismatch for " + entry.id);
          if (sha256(revisionBytes) !== revision.sha256) fail("revision SHA-256 mismatch for " + entry.id);
          revisions.push({ manifest: revision, bytes: cloneBytes(revisionBytes) });
          completed++;
          reportProgress(config, "validate", completed, total, revision.id);
        });
        result.push({ manifest: entry, bytes: cloneBytes(bytes), revisions: revisions });
        completed++;
        reportProgress(config, "validate", completed, total, entry.name);
      });
      reportProgress(config, "validated", total, total, "");
      return {
        manifest: manifest,
        entries: result,
        schemaWarning: manifest.schemaVersion > SCHEMA_VERSION
          ? "The imported schema is newer; known fields only will be imported."
          : "",
      };
    });
  }

  window.A8ELibraryPackage = {
    createApi: function () {
      return {
        format: FORMAT,
        schemaVersion: SCHEMA_VERSION,
        sha256: sha256,
        validateManifest: validateManifest,
        makeManifest: makeManifest,
        planImport: planImport,
        exportPackage: exportPackage,
        importPackage: importPackage,
      };
    },
  };
})();
