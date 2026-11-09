(function () {
  "use strict";

  /* Title-bar control, LED and connection dialog for remote workspace sync.
   * Sync is manual. Only URL and user name are persisted (localStorage, per-viewer); the
   * application password stays in memory for the page session. */

  const STORAGE_KEY = "a8e.remoteWorkspace.v1";

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function saveConfig(config) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (err) {
      /* Persistence is a convenience; sync still works for this session. */
    }
  }

  function clearConfig() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      /* Ignore. */
    }
  }

  function ago(timestamp) {
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 60) return "moments ago";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + " min ago";
    return Math.round(minutes / 60) + " h ago";
  }

  function init(opts) {
    const config = opts && typeof opts === "object" ? opts : {};
    const app = config.app;
    const panel = config.panel;
    const remoteApi = window.A8ERemoteWorkspace;
    if (!app || !panel || !remoteApi || panel.__a8eRemoteSyncInitialized) return;
    const library = typeof app.getDiskLibrary === "function" ? app.getDiskLibrary() : app.diskLibrary;
    if (!library || typeof library.exportWorkspacePackage !== "function") return;
    panel.__a8eRemoteSyncInitialized = true;

    const controlBtn = panel.querySelector(".disklib-remote-btn");
    const settingsBtn = panel.querySelector(".disklib-remote-settings-btn");
    const panelLed = panel.querySelector(".disklib-remote-btn .remote-led");
    const labelEl = panel.querySelector(".disklib-remote-label");
    const dialog = document.querySelector(".remoteSyncDialog");
    if (!controlBtn || !dialog) return;
    const urlInput = dialog.querySelector(".remote-url");
    const scopeSelect = dialog.querySelector(".remote-scope");
    const userInput = dialog.querySelector(".remote-user");
    const passwordInput = dialog.querySelector(".remote-password");
    const messageEl = dialog.querySelector(".remote-message");
    const connectBtn = dialog.querySelector(".remote-connect");
    const forgetBtn = dialog.querySelector(".remote-forget");
    const closeBtn = dialog.querySelector(".remote-close");

    const badges = [];
    (config.buttons || []).forEach(function (host) {
      if (!host) return;
      host.classList.add("remote-led-host");
      const badge = document.createElement("span");
      badge.className = "remote-led remote-led-badge";
      badge.dataset.state = "off";
      badge.setAttribute("aria-hidden", "true");
      host.appendChild(badge);
      badges.push(badge);
    });

    let saved = loadConfig();
    let password = "";          // in memory only
    let sync = null;            // active coordinator while connected
    let phase = saved.url ? "disconnected" : "unconfigured";
    let errorText = "";
    let pending = false;
    let running = false;

    function describe() {
      switch (phase) {
        case "unconfigured":
          return { led: "off", label: "Configure", tip: "Remote sync: not configured" };
        case "disconnected":
          return { led: "off", label: "Connect", tip: "Remote sync: not connected (password is asked each session)" };
        case "syncing":
          return { led: "syncing", label: "Syncing", tip: "Remote sync: synchronizing..." };
        case "error":
          return { led: "error", label: "Review", tip: "Remote sync: " + errorText };
        default: {
          const when = saved.syncedAt ? "synchronized " + ago(saved.syncedAt) : "not synchronized yet";
          return pending
            ? { led: "pending", label: "Sync", tip: "Remote sync: local changes pending (" + when + ")" }
            : { led: "synced", label: "Sync", tip: "Remote sync: connected; " + when };
        }
      }
    }

    function refresh() {
      const view = describe();
      if (panelLed) panelLed.dataset.state = view.led;
      badges.forEach(function (badge) { badge.dataset.state = view.led; });
      if (labelEl) labelEl.textContent = view.label;
      controlBtn.title = view.tip;
      controlBtn.setAttribute("aria-label", view.tip);
    }

    function showMessage(text, kind) {
      messageEl.textContent = text || "";
      messageEl.className = "remote-message" + (kind ? " " + kind : "");
    }

    function setStatus(text, kind) {
      const statusEl = panel.querySelector(".disklib-status");
      if (!statusEl) return;
      statusEl.textContent = text || "";
      statusEl.className = "disklib-status" + (kind ? " " + kind : "");
    }

    function persistState(state) {
      saved = Object.assign({}, saved, {
        repoId: state.repoId,
        lastEtag: state.lastEtag,
        lastFingerprint: state.lastFingerprint,
        syncedAt: state.syncedAt,
        remoteBlobs: state.remoteBlobs || [],
      });
      saveConfig(saved);
    }

    function openDialog() {
      urlInput.value = saved.url || "";
      userInput.value = saved.user || "";
      scopeSelect.value = saved.scope === "library" ? "library" : "workspace";
      passwordInput.value = "";
      showMessage(phase === "error" ? errorText : "", phase === "error" ? "error" : "");
      if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
      (password || !saved.url ? urlInput : passwordInput).focus();
    }

    function errorMessage(err) {
      return err && err.message ? err.message : String(err);
    }

    function connect() {
      let url;
      try {
        url = remoteApi.normalizeUrl(urlInput.value);
      } catch (err) {
        showMessage(errorMessage(err), "error");
        return;
      }
      const user = userInput.value.trim();
      const pass = passwordInput.value;
      if (!user || !pass) {
        showMessage("Enter the user name and an application password.", "error");
        return;
      }
      showMessage("Testing connection...", "");
      connectBtn.disabled = true;
      let client;
      try {
        client = remoteApi.createClient({ url: url, user: user, password: pass });
      } catch (err) {
        connectBtn.disabled = false;
        showMessage(errorMessage(err), "error");
        return;
      }
      const scope = scopeSelect.value === "library" ? "library" : "workspace";
      client.connect().then(function (identity) {
        const sameRemote = saved.url === url && saved.user === user &&
          saved.repoId === identity.repoId && (saved.scope || "workspace") === scope;
        saved = {
          url: url,
          user: user,
          scope: scope,
          repoId: identity.repoId,
          lastEtag: sameRemote ? saved.lastEtag : "",
          lastFingerprint: sameRemote ? saved.lastFingerprint : "",
          syncedAt: sameRemote ? saved.syncedAt : 0,
          remoteBlobs: sameRemote ? saved.remoteBlobs || [] : [],
        };
        saveConfig(saved);
        password = pass;
        const factory = scope === "library" ? window.A8ERemoteLibrary : remoteApi;
        if (!factory) throw new Error("Library synchronization is unavailable in this build.");
        sync = factory.createSync({ client: client, library: library, state: saved, save: persistState });
        return (sync.prepare ? sync.prepare() : Promise.resolve()).then(function () {
          phase = "connected";
          pending = true;
          errorText = "";
          passwordInput.value = "";
          showMessage(identity.created ? "Connected. A new remote repository was initialized." : "Connected.", "success");
          refresh();
          dialog.close();
          runSync();
        });
      }).catch(function (err) {
        sync = null;
        showMessage(errorMessage(err), "error");
      }).then(function () {
        connectBtn.disabled = false;
      });
    }

    function confirmMerge(preview) {
      const summary = preview && preview.summary || {};
      return Promise.resolve(confirm(
        "The remote workspace already contains data and so does this library.\n\n" +
        "Merge it? Entries not yet present (" + (summary.added || 0) + ") will be added, " +
        (summary.duplicates || 0) + " duplicate(s) skipped and " + (summary.conflicts || 0) +
        " divergent copy(ies) kept side by side. Nothing local is overwritten."));
    }

    function runSync() {
      if (!sync || running) return Promise.resolve();
      running = true;
      phase = "syncing";
      refresh();
      setStatus("Syncing with remote...", "busy");
      return sync.sync({
        confirmMerge: confirmMerge,
        onProgress: function (progress) {
          setStatus("Remote sync: " + progress.phase + " " + progress.completed + "/" +
            (progress.total || "?") + (progress.current ? " " + progress.current : ""), "busy");
        },
      }).then(function (report) {
        phase = "connected";
        if (report.canceled) {
          pending = true;
          setStatus("Remote merge canceled", "success");
        } else {
          pending = false;
          const parts = [];
          if (report.empty) parts.push("remote is empty and there is nothing to publish");
          if (report.pulled) parts.push("pulled");
          if (report.pushed) parts.push("published");
          if (report.downloaded) parts.push(report.downloaded + " file(s) downloaded");
          if (report.uploaded) parts.push(report.uploaded + " file(s) uploaded");
          if (report.conflicts) parts.push(report.conflicts + " divergent copy(ies) kept");
          setStatus("Remote sync: " + (parts.length ? parts.join(", ") : "up to date"), "success");
        }
      }).catch(function (err) {
        phase = "error";
        errorText = errorMessage(err);
        setStatus("Remote sync failed: " + errorText, "error");
        if (err && (err.code === "auth" || err.code === "forbidden")) {
          password = "";
          sync = null;
        }
      }).then(function () {
        running = false;
        refresh();
      });
    }

    controlBtn.addEventListener("click", function () {
      if (phase === "unconfigured" || phase === "disconnected" || (phase === "error" && !sync)) {
        openDialog();
      } else {
        runSync();
      }
    });
    settingsBtn.addEventListener("click", openDialog);
    connectBtn.addEventListener("click", connect);
    closeBtn.addEventListener("click", function () { dialog.close(); });
    forgetBtn.addEventListener("click", function () {
      clearConfig();
      saved = {};
      password = "";
      sync = null;
      pending = false;
      phase = "unconfigured";
      urlInput.value = "";
      userInput.value = "";
      showMessage("Remote sync disconnected; stored settings removed.", "success");
      refresh();
    });
    passwordInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        connect();
      }
    });

    // Local edits only mark the workspace as pending (yellow LED); sync is
    // manual in this first version. Sector writes never touch the network.
    if (typeof library.onChange === "function") {
      library.onChange(function () {
        if (running || !sync || phase !== "connected" || pending) return;
        pending = true;
        refresh();
      });
    }
    setInterval(refresh, 60000);
    refresh();
  }

  window.A8ERemoteSyncUI = { init: init };
})();
