(function () {
  "use strict";

  /* Remote workspace synchronization (MVP, see implementation/OnlineDrive.md).
   *
   * One `workspace.a8e` package plus a `.a8e-remote.json` identity file live in
   * a WebDAV folder. Every write is guarded by ETag preconditions (If-Match /
   * If-None-Match), so a concurrent publisher is detected instead of
   * overwritten. Remote content is merged through the library's existing
   * non-destructive import; nothing is ever replaced silently.
   *
   * The module only needs `fetch` and the disk-library API, so it behaves the
   * same with and without the worker proxy. The password is held in memory by
   * the caller and is never persisted by this module. */

  const IDENTITY_FILE = ".a8e-remote.json";
  const WORKSPACE_FILE = "workspace.a8e";
  const IDENTITY_FORMAT = "a8e-remote";
  const PROTOCOL = 1;
  const MAX_ATTEMPTS = 5;

  class RemoteError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "RemoteError";
      this.code = code;
    }
  }

  function isLocalHost(hostname) {
    return hostname === "localhost" || hostname === "127.0.0.1" ||
      hostname === "[::1]" || hostname === "::1";
  }

  /* Returns the normalized folder URL (always ending in "/") or throws. */
  function normalizeUrl(value) {
    let url;
    try {
      url = new URL(String(value || "").trim());
    } catch (err) {
      throw new RemoteError("bad-url", "The WebDAV folder URL is not valid.");
    }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalHost(url.hostname))) {
      throw new RemoteError("insecure", "HTTPS is required (plain HTTP is only allowed for localhost).");
    }
    if (url.username || url.password) {
      throw new RemoteError("bad-url", "Do not put credentials in the URL.");
    }
    url.hash = "";
    url.search = "";
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    return url.toString();
  }

  function basicAuth(user, password) {
    const bytes = new TextEncoder().encode(String(user) + ":" + String(password));
    let binary = "";
    bytes.forEach(function (byte) { binary += String.fromCharCode(byte); });
    return "Basic " + btoa(binary);
  }

  function createClient(options) {
    const config = options || {};
    const baseUrl = normalizeUrl(config.url);
    const fetchFn = config.fetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    if (!fetchFn) throw new RemoteError("unsupported", "fetch is unavailable.");
    const authorization = basicAuth(config.user || "", config.password || "");

    function request(method, name, extra) {
      const headers = Object.assign({ Authorization: authorization }, extra && extra.headers);
      const init = {
        method: method,
        headers: headers,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
      };
      if (extra && extra.body !== undefined) init.body = extra.body;
      return Promise.resolve(fetchFn(baseUrl + name, init)).catch(function (err) {
        throw new RemoteError("network",
          "Could not reach the server. Check the URL, the network and that the " +
          "server allows CORS for this origin (" + (err && err.message ? err.message : err) + ").");
      }).then(function (response) {
        if (response.status === 401) {
          throw new RemoteError("auth", "The server rejected the user name or application password.");
        }
        if (response.status === 403) {
          throw new RemoteError("forbidden", "The account has no permission for this operation.");
        }
        return response;
      });
    }

    function etagOf(response) {
      return response.headers.get("ETag") || "";
    }

    /* Resolves to {status:"missing"} | {status:"unchanged", etag} |
     * {status:"ok", etag, bytes}. */
    function getFile(name, knownEtag, getOptions) {
      const requireEtag = !(getOptions && getOptions.requireEtag === false);
      const headers = knownEtag ? { "If-None-Match": knownEtag } : {};
      return request("GET", name, { headers: headers }).then(function (response) {
        if (response.status === 404) return { status: "missing" };
        if (response.status === 304) return { status: "unchanged", etag: knownEtag };
        if (!response.ok) throw new RemoteError("http", "Server error " + response.status + " reading " + name + ".");
        const etag = etagOf(response);
        if (!etag && requireEtag) {
          throw new RemoteError("no-etag",
            "The server did not expose an ETag header (CORS must expose ETag).");
        }
        return response.arrayBuffer().then(function (buffer) {
          return { status: "ok", etag: etag, bytes: new Uint8Array(buffer) };
        });
      });
    }

    /* `precondition` is {ifMatch: etag} or {ifNoneMatch: "*"}.
     * Resolves to {status:"ok", etag} or {status:"conflict"} on 412/409. */
    function putFile(name, bytes, precondition, putOptions) {
      const skipEtag = !!(putOptions && putOptions.skipEtag);
      const headers = { "Content-Type": "application/octet-stream" };
      if (precondition && precondition.ifMatch) headers["If-Match"] = precondition.ifMatch;
      if (precondition && precondition.ifNoneMatch) headers["If-None-Match"] = precondition.ifNoneMatch;
      return request("PUT", name, { headers: headers, body: bytes }).then(function (response) {
        if (response.status === 412 || response.status === 409) {
          return { status: "conflict", httpStatus: response.status };
        }
        if (response.status === 404 || response.status === 405) {
          throw new RemoteError("missing-folder", "The WebDAV folder does not exist or does not accept uploads.");
        }
        if (!response.ok) throw new RemoteError("http", "Server error " + response.status + " writing " + name + ".");
        let etag = etagOf(response);
        if (etag || skipEtag) return { status: "ok", etag: etag };
        // Some servers omit the ETag on PUT; read it back (same CORS rule).
        return request("HEAD", name).then(function (head) {
          etag = etagOf(head);
          if (!etag) {
            throw new RemoteError("no-etag",
              "The server did not expose an ETag header (CORS must expose ETag).");
          }
          return { status: "ok", etag: etag };
        });
      });
    }

    /* True when the file exists (HEAD), without transferring its content. */
    function exists(name) {
      return request("HEAD", name).then(function (response) {
        if (response.status === 404) return false;
        if (!response.ok) throw new RemoteError("http", "Server error " + response.status + " checking " + name + ".");
        return true;
      });
    }

    /* Creates a collection; an existing one (405) is fine. */
    function mkcol(name) {
      return request("MKCOL", name).then(function (response) {
        if (response.status === 201 || response.status === 405) return;
        if (response.status === 409) {
          throw new RemoteError("missing-folder", "The WebDAV folder does not exist.");
        }
        throw new RemoteError("http", "Server error " + response.status + " creating " + name + " (does CORS allow MKCOL?).");
      });
    }

    function identityBytes(repoId) {
      return new TextEncoder().encode(JSON.stringify({
        format: IDENTITY_FORMAT,
        protocol: PROTOCOL,
        kind: "workspace",
        repoId: repoId,
        createdAt: new Date().toISOString(),
      }));
    }

    function newRepoId() {
      if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
      }
      return "repo-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }

    /* Verifies connectivity, authentication, ETag support and repository
     * identity. Creates the identity file when the folder is empty. Resolves to
     * {repoId, created}. */
    function connect() {
      return getFile(IDENTITY_FILE).then(function (identity) {
        if (identity.status === "ok") {
          let parsed = null;
          try {
            parsed = JSON.parse(new TextDecoder().decode(identity.bytes));
          } catch (err) {
            parsed = null;
          }
          if (!parsed || parsed.format !== IDENTITY_FORMAT || typeof parsed.repoId !== "string") {
            throw new RemoteError("not-repository", "This folder contains " + IDENTITY_FILE +
              " but it is not an A8E remote repository.");
          }
          if (parsed.protocol > PROTOCOL) {
            throw new RemoteError("newer-protocol", "This repository uses a newer protocol; update A8E.");
          }
          return { repoId: parsed.repoId, created: false };
        }
        const repoId = newRepoId();
        return putFile(IDENTITY_FILE, identityBytes(repoId), { ifNoneMatch: "*" })
          .then(function (result) {
            if (result.status === "conflict") return connect();
            return { repoId: repoId, created: true };
          });
      });
    }

    return {
      baseUrl: baseUrl,
      getFile: getFile,
      putFile: putFile,
      exists: exists,
      mkcol: mkcol,
      connect: connect,
    };
  }

  /* Deterministic description of the workspace content: independent of export
   * timestamps, so equal fingerprints mean "nothing to publish". */
  function fingerprint(manifest) {
    const library = (manifest && manifest.library || []).map(function (entry) {
      return [
        entry.id, entry.folderId || "root", entry.name, entry.sha256,
        entry.preferredRevisionId || "",
        (entry.revisions || []).map(function (revision) {
          return revision.id + ":" + revision.sha256 + ":" + (revision.parentId || "");
        }),
      ];
    }).sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    const folders = (manifest && manifest.folders || []).map(function (folder) {
      return [folder.id, folder.name, folder.parentId || ""];
    }).sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    const workspace = manifest && manifest.workspace || {};
    return JSON.stringify([library, folders, workspace.devices || {}, workspace.writeProtected || {}]);
  }

  /* Synchronization coordinator. `state` is the persisted per-connection
   * record {repoId, lastEtag, lastFingerprint}; `save(state)` persists it. */
  function createSync(options) {
    const config = options || {};
    const client = config.client;
    const library = config.library;
    const state = Object.assign(
      { repoId: "", lastEtag: "", lastFingerprint: "", syncedAt: 0 }, config.state);

    function persist() {
      if (typeof config.save === "function") config.save(Object.assign({}, state));
    }

    function exportLocal() {
      return Promise.resolve(library.flush ? library.flush() : null).then(function () {
        return library.exportWorkspacePackage({ fileName: WORKSPACE_FILE });
      }).then(function (result) {
        const raw = result.bytes || (result.buffer && new Uint8Array(result.buffer));
        if (!raw) throw new RemoteError("export", "Workspace export returned no data.");
        return {
          bytes: new Uint8Array(raw),
          fingerprint: fingerprint(result.manifest),
          entries: result.manifest && result.manifest.library ? result.manifest.library.length : 0,
        };
      });
    }

    // An empty workspace that never synced has nothing to publish.
    function isDirty(local) {
      if (!state.syncedAt && !local.entries) return false;
      return local.fingerprint !== state.lastFingerprint;
    }

    /* Pulls remote changes, merges them non-destructively and publishes local
     * changes. `confirmMerge(preview)` may veto a merge (resolve false). */
    function sync(syncOptions) {
      const opts = syncOptions || {};
      const report = { pulled: false, pushed: false, conflicts: 0, summary: null };

      function attempt(count) {
        if (count > MAX_ATTEMPTS) {
          return Promise.reject(new RemoteError("busy",
            "The remote workspace keeps changing; try again in a moment."));
        }
        return exportLocal().then(function (local) {
          return client.getFile(WORKSPACE_FILE, state.lastEtag).then(function (remote) {
            if (remote.status === "missing") {
              if (!local.entries) {
                report.empty = true;
                return null;
              }
              return publish(local, { ifNoneMatch: "*" }, count);
            }
            const remoteChanged = remote.status === "ok" && remote.etag !== state.lastEtag;
            if (!remoteChanged) {
              if (!isDirty(local)) return null;
              return publish(local, { ifMatch: state.lastEtag }, count);
            }
            return mergeRemote(remote, local).then(function (merged) {
              if (merged === null) {
                report.canceled = true;
                return null;
              }
              return exportLocal().then(function (after) {
                // A clean local workspace that merged remote content is
                // already identical to the remote: nothing to publish.
                if (!isDirty(local)) {
                  state.lastEtag = remote.etag;
                  state.lastFingerprint = after.fingerprint;
                  persist();
                  return null;
                }
                return publish(after, { ifMatch: remote.etag }, count);
              });
            });
          });
        });
      }

      function mergeRemote(remote, local) {
        const previewBytes = new Uint8Array(remote.bytes);
        const commitBytes = new Uint8Array(remote.bytes);
        return library.previewImport(previewBytes.buffer, {}).then(function (preview) {
          const firstSync = !state.syncedAt && local.entries > 0;
          const veto = typeof opts.confirmMerge === "function" && firstSync
            ? Promise.resolve(opts.confirmMerge(preview))
            : Promise.resolve(true);
          return veto.then(function (accepted) {
            if (!accepted) return null;
            return library.importPackage(commitBytes.buffer, {}).then(function (result) {
              report.pulled = true;
              report.summary = result.summary || preview.summary || {};
              report.conflicts = report.summary.conflicts | 0;
              return { summary: report.summary };
            });
          });
        });
      }

      function publish(local, precondition, count) {
        return client.putFile(WORKSPACE_FILE, local.bytes, precondition).then(function (result) {
          if (result.status === "conflict") {
            // Another client published first: forget the stale ETag so the
            // next attempt downloads and merges the newer remote.
            state.lastEtag = "";
            return attempt(count + 1);
          }
          state.lastEtag = result.etag;
          state.lastFingerprint = local.fingerprint;
          report.pushed = true;
          persist();
          return null;
        });
      }

      return attempt(1).then(function () {
        if (report.canceled) return report;
        state.syncedAt = Date.now();
        persist();
        return report;
      });
    }

    /* True when the local workspace differs from the last synchronized one. */
    function hasLocalChanges() {
      return exportLocal().then(isDirty);
    }

    return {
      sync: sync,
      hasLocalChanges: hasLocalChanges,
      getState: function () { return Object.assign({}, state); },
    };
  }

  window.A8ERemoteWorkspace = {
    IDENTITY_FILE: IDENTITY_FILE,
    WORKSPACE_FILE: WORKSPACE_FILE,
    RemoteError: RemoteError,
    normalizeUrl: normalizeUrl,
    createClient: createClient,
    createSync: createSync,
    fingerprint: fingerprint,
  };
})();
