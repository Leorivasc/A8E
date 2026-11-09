(function () {
  "use strict";

  /* Remote full-library synchronization (Phase 2a, see
   * implementation/OnlineDrive.md).
   *
   * Remote layout (next to `.a8e-remote.json`):
   *   library.json            the schema-v1 manifest, guarded by its ETag
   *   blobs/<sha256>.<type>   immutable content-addressed payloads
   *
   * Only blobs the other side lacks are transferred. Remote entries are merged
   * through the library's existing non-destructive import, so conflicts keep
   * both variants. This slice is additive: new entries, new revisions and new
   * folders propagate; deletes, renames and moves do not (tombstones and
   * metadata merge are Phase 2b). Mounts are intentionally not synchronized. */

  const MANIFEST_FILE = "library.json";
  const BLOB_DIR = "blobs/";
  const MAX_ATTEMPTS = 5;
  const BATCH_BYTES = 48 * 1024 * 1024;

  function remoteError(code, message) {
    return new window.A8ERemoteWorkspace.RemoteError(code, message);
  }

  /* Every blob a manifest references: sha -> {path, size}. */
  function blobsOf(manifest) {
    const blobs = new Map();
    (manifest.library || []).forEach(function (entry) {
      blobs.set(entry.sha256, { path: entry.path, size: entry.size });
      (entry.revisions || []).forEach(function (revision) {
        blobs.set(revision.sha256, { path: revision.path, size: revision.size });
      });
    });
    return blobs;
  }

  function blobsOfEntry(entry) {
    return blobsOf({ library: [entry] });
  }

  /* True when the local entry already holds everything the remote one has. */
  function sameContent(local, remote) {
    if (!local || local.sha256 !== remote.sha256) return false;
    const have = new Set((local.revisions || []).map(function (revision) {
      return revision.id + ":" + revision.sha256;
    }));
    return (remote.revisions || []).every(function (revision) {
      return have.has(revision.id + ":" + revision.sha256);
    });
  }

  function createSync(options) {
    const config = options || {};
    const client = config.client;
    const library = config.library;
    const packageApi = window.A8ELibraryPackage.createApi();
    const archiveApi = window.A8ELibraryArchive.createApi();
    const fingerprint = window.A8ERemoteWorkspace.fingerprint;
    const state = Object.assign(
      { repoId: "", lastEtag: "", lastFingerprint: "", syncedAt: 0, remoteBlobs: [] }, config.state);

    function persist() {
      if (typeof config.save === "function") config.save(Object.assign({}, state));
    }

    function stripManifest(manifest) {
      const copy = Object.assign({}, manifest);
      delete copy.workspace; // mounts are per browser, never synchronized
      return copy;
    }

    function localManifest() {
      return Promise.resolve(library.flush ? library.flush() : null).then(function () {
        return library.getManifest();
      }).then(stripManifest);
    }

    function isDirty(manifest) {
      if (!state.syncedAt && !(manifest.library || []).length) return false;
      return fingerprint(manifest) !== state.lastFingerprint;
    }

    function progress(opts, phase, completed, total, current) {
      if (opts && typeof opts.onProgress === "function") {
        opts.onProgress({ phase: phase, completed: completed, total: total, current: current || "" });
      }
    }

    function downloadBlob(sha, blob, opts, counters) {
      progress(opts, "download", counters.done, counters.total, blob.path);
      return client.getFile(blob.path, "", { requireEtag: false }).then(function (result) {
        if (result.status !== "ok") {
          throw remoteError("missing-blob", "The remote is missing " + blob.path + ".");
        }
        if (packageApi.sha256(result.bytes) !== sha) {
          throw remoteError("corrupt-blob", "The remote blob " + blob.path + " failed its SHA-256 check.");
        }
        counters.done++;
        return result.bytes;
      });
    }

    /* Merges the remote manifest into the local library, downloading only the
     * blobs that are missing. Resolves to {added, conflicts, downloaded} or
     * null when `confirmMerge` vetoed it. */
    function pull(remoteManifest, localMan, opts) {
      const localEntries = new Map();
      (localMan.library || []).forEach(function (entry) { localEntries.set(entry.id, entry); });
      const localHashes = new Set(blobsOf(localMan).keys());
      const pending = (remoteManifest.library || []).filter(function (entry) {
        return !sameContent(localEntries.get(entry.id), entry);
      });
      const added = pending.filter(function (entry) { return !localEntries.has(entry.id); }).length;
      const summary = { added: added, conflicts: pending.length - added, duplicates: 0 };
      const result = { added: added, conflicts: summary.conflicts, downloaded: 0 };
      if (!pending.length) return Promise.resolve(result);

      const firstSync = !state.syncedAt && (localMan.library || []).length > 0;
      const veto = typeof opts.confirmMerge === "function" && firstSync
        ? Promise.resolve(opts.confirmMerge({ summary: summary }))
        : Promise.resolve(true);
      return veto.then(function (accepted) {
        if (!accepted) return null;
        const wanted = new Map();
        pending.forEach(function (entry) {
          blobsOfEntry(entry).forEach(function (blob, sha) {
            if (!localHashes.has(sha)) wanted.set(sha, blob);
          });
        });
        const counters = { done: 0, total: wanted.size };
        // Batches keep memory and the importer's per-archive limits bounded.
        const batches = [];
        let batch = [];
        let batchBytes = 0;
        pending.forEach(function (entry) {
          let size = 0;
          blobsOfEntry(entry).forEach(function (blob) { size += blob.size; });
          if (batch.length && batchBytes + size > BATCH_BYTES) {
            batches.push(batch);
            batch = [];
            batchBytes = 0;
          }
          batch.push(entry);
          batchBytes += size;
        });
        batches.push(batch);

        let chain = Promise.resolve();
        batches.forEach(function (group) {
          chain = chain.then(function () { return importBatch(group, remoteManifest, localHashes, wanted, counters, opts); });
        });
        return chain.then(function () {
          result.downloaded = counters.done;
          return result;
        });
      });
    }

    function importBatch(group, remoteManifest, localHashes, wanted, counters, opts) {
      const files = new Map();
      const manifest = Object.assign({}, remoteManifest, { library: group });
      let chain = Promise.resolve();
      group.forEach(function (entry) {
        blobsOfEntry(entry).forEach(function (blob, sha) {
          if (files.has(blob.path)) return;
          files.set(blob.path, null);
          chain = chain.then(function () {
            if (localHashes.has(sha)) return library.readBlob(sha);
            return downloadBlob(sha, wanted.get(sha) || blob, opts, counters);
          }).then(function (bytes) {
            if (!bytes) throw remoteError("missing-blob", "Local blob " + blob.path + " is unavailable.");
            files.set(blob.path, bytes);
          });
        });
      });
      return chain.then(function () {
        const entries = [{ name: "library.json", bytes: new TextEncoder().encode(JSON.stringify(manifest)) }];
        files.forEach(function (bytes, path) { entries.push({ name: path, bytes: bytes }); });
        return archiveApi.write(entries);
      }).then(function (zip) {
        progress(opts, "import", 0, 1, "");
        return library.importPackage(new Uint8Array(zip).buffer, {});
      });
    }

    /* Uploads blobs the remote does not have yet, then the manifest. */
    function publish(manifest, knownRemote, precondition, opts, report) {
      const blobs = blobsOf(manifest);
      const missing = [];
      blobs.forEach(function (blob, sha) {
        if (!knownRemote.has(sha)) missing.push({ sha: sha, blob: blob });
      });
      let done = 0;
      let chain = Promise.resolve();
      missing.forEach(function (item) {
        chain = chain.then(function () {
          progress(opts, "upload", done, missing.length, item.blob.path);
          return client.exists(item.blob.path).then(function (present) {
            if (present) return null;
            return library.readBlob(item.sha).then(function (bytes) {
              if (!bytes) throw remoteError("missing-blob", "Local blob " + item.blob.path + " is unavailable.");
              return client.putFile(item.blob.path, bytes, { ifNoneMatch: "*" }, { skipEtag: true });
            }).then(function (result) {
              if (result.status === "conflict" && result.httpStatus === 409) {
                throw remoteError("missing-folder", "The remote blobs/ folder is missing.");
              }
              if (result.status === "ok") report.uploaded++;
            });
          }).then(function () {
            knownRemote.add(item.sha);
            done++;
          });
        });
      });
      return chain.then(function () {
        const bytes = new TextEncoder().encode(JSON.stringify(manifest));
        return client.putFile(MANIFEST_FILE, bytes, precondition);
      }).then(function (result) {
        if (result.status === "conflict") return false;
        state.lastEtag = result.etag;
        state.lastFingerprint = fingerprint(manifest);
        state.remoteBlobs = Array.from(knownRemote);
        report.pushed = true;
        persist();
        return true;
      });
    }

    function sync(syncOptions) {
      const opts = syncOptions || {};
      const report = { pulled: false, pushed: false, conflicts: 0, downloaded: 0, uploaded: 0, summary: null };

      function attempt(count) {
        if (count > MAX_ATTEMPTS) {
          return Promise.reject(remoteError("busy", "The remote library keeps changing; try again in a moment."));
        }
        return localManifest().then(function (local) {
          return client.getFile(MANIFEST_FILE, state.lastEtag).then(function (remote) {
            const known = new Set(state.remoteBlobs);
            if (remote.status === "missing") {
              if (!(local.library || []).length) {
                report.empty = true;
                return null;
              }
              return publishOrRetry(local, known, { ifNoneMatch: "*" }, count);
            }
            const remoteChanged = remote.status === "ok" && remote.etag !== state.lastEtag;
            if (!remoteChanged) {
              if (!isDirty(local)) return null;
              return publishOrRetry(local, known, { ifMatch: state.lastEtag }, count);
            }
            let remoteManifest;
            try {
              remoteManifest = JSON.parse(new TextDecoder().decode(remote.bytes));
              packageApi.validateManifest(remoteManifest);
            } catch (err) {
              throw remoteError("bad-manifest", "The remote library.json is not valid: " + (err && err.message ? err.message : err));
            }
            blobsOf(remoteManifest).forEach(function (blob, sha) { known.add(sha); });
            return pull(remoteManifest, local, opts).then(function (pulled) {
              if (pulled === null) {
                report.canceled = true;
                return null;
              }
              report.pulled = pulled.added > 0 || pulled.conflicts > 0;
              report.conflicts = pulled.conflicts;
              report.downloaded = pulled.downloaded;
              report.summary = pulled;
              return localManifest().then(function (after) {
                if (!isDirty(local)) {
                  state.lastEtag = remote.etag;
                  state.lastFingerprint = fingerprint(after);
                  state.remoteBlobs = Array.from(known);
                  persist();
                  return null;
                }
                return publishOrRetry(after, known, { ifMatch: remote.etag }, count);
              });
            });
          });
        });
      }

      function publishOrRetry(manifest, known, precondition, count) {
        return publish(manifest, known, precondition, opts, report).then(function (ok) {
          if (ok) return null;
          // Another client published first: drop the stale ETag so the next
          // attempt downloads and merges the newer manifest.
          state.lastEtag = "";
          state.remoteBlobs = Array.from(known);
          return attempt(count + 1);
        });
      }

      return attempt(1).then(function () {
        if (report.canceled) return report;
        state.syncedAt = Date.now();
        persist();
        return report;
      });
    }

    return {
      sync: sync,
      /* Creates blobs/ when the library repository is first used. */
      prepare: function () { return client.mkcol(BLOB_DIR); },
      getState: function () { return Object.assign({}, state); },
    };
  }

  window.A8ERemoteLibrary = { createSync: createSync, MANIFEST_FILE: MANIFEST_FILE };
})();
