(function () {
  "use strict";

  /* Atari DOS layouts commonly expose D1:-D4:. The library core still
   * preserves all eight internal device slots for newer software and package
   * interoperability; this panel intentionally presents only the classic
   * four-drive view. */
  const DRIVE_COUNT = 4;
  const SUPPORTED_EXTENSIONS = new Set(["atr", "xex"]);

  function extension(name) {
    const value = String(name || "");
    const dot = value.lastIndexOf(".");
    return dot >= 0 ? value.substring(dot + 1).toLowerCase() : "";
  }

  function formatSize(bytes) {
    const size = Math.max(0, bytes | 0);
    if (size < 1024) return size + " B";
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
    return (size / (1024 * 1024)).toFixed(1) + " MB";
  }

  function triggerDownload(result) {
    if (!result) return;
    const bytes = result.bytes || result.buffer;
    if (!bytes) return;
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.name || "disk.atr";
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function init(opts) {
    const config = opts && typeof opts === "object" ? opts : {};
    const app = config.app;
    const panel = config.panel;
    const button = config.button;
    if (!app || !panel || !button) return;
    if (panel.__a8eDiskLibraryInitialized) return;

    const library =
      typeof app.getDiskLibrary === "function"
        ? app.getDiskLibrary()
        : app.diskLibrary;
    if (!library) return;
    panel.__a8eDiskLibraryInitialized = true;

    const listEl = panel.querySelector(".disklib-list");
    const dropZone = panel.querySelector(".disklib-drop-zone");
    const uploadBtn = panel.querySelector(".disklib-upload-btn");
    const uploadInput = panel.querySelector(".disklib-upload-input");
    const masterChk = panel.querySelector(".disklib-master-chk");
    const selectAllBtn = panel.querySelector(".disklib-sel-all-btn");
    const selectNoneBtn = panel.querySelector(".disklib-sel-none-btn");
    const downloadBtn = panel.querySelector(".disklib-dl-sel-btn");
    const deleteBtn = panel.querySelector(".disklib-del-sel-btn");
    const trashBtn = panel.querySelector(".disklib-trash-btn");
    const purgeTrashBtn = panel.querySelector(".disklib-purge-trash-btn");
    const purgeOldTrashBtn = panel.querySelector(".disklib-purge-old-trash-btn");
    const newFolderBtn = panel.querySelector(".disklib-new-folder-btn");
    const newAtrBtn = panel.querySelector(".disklib-new-atr-btn");
    const currentPathEl = panel.querySelector(".disklib-current-path");
    const mountedListEl = panel.querySelector(".disklib-mounted-list");
    const searchInput = panel.querySelector(".disklib-search-input");
    const typeFilter = panel.querySelector(".disklib-filter-type");
    const statusFilter = panel.querySelector(".disklib-filter-status");
    const sortSelect = panel.querySelector(".disklib-sort");
    const exportBtn = panel.querySelector(".disklib-export-btn");
    const workspaceExportBtn = panel.querySelector(".disklib-workspace-export-btn");
    const storageBtn = panel.querySelector(".disklib-storage-btn");
    const importBtn = panel.querySelector(".disklib-import-btn");
    const cancelBtn = panel.querySelector(".disklib-cancel-btn");
    const importInput = panel.querySelector(".disklib-import-input");
    const statusEl = panel.querySelector(".disklib-status");
    const countEl = panel.querySelector(".disklib-stat-count");
    const selectedEl = panel.querySelector(".disklib-stat-sel");
    const infoEl = panel.querySelector(".disklib-stat-info");
    const totalEl = panel.querySelector(".disklib-stat-total");
    const atrView = panel.querySelector(".disklib-atr-view");
    const atrBackBtn = panel.querySelector(".disklib-atr-back-btn");
    const atrDownloadBtn = panel.querySelector(".disklib-atr-download-btn");
    const atrTitleEl = panel.querySelector(".disklib-atr-title");
    const atrInfoEl = panel.querySelector(".disklib-atr-info");
    const atrListEl = panel.querySelector(".disklib-atr-list");
    const atrPreviewEl = panel.querySelector(".disklib-atr-preview");
    const atrPreviewTitleEl = panel.querySelector(".disklib-atr-preview-title");
    const atrPreviewTextEl = panel.querySelector(".disklib-atr-preview-text");

    const selected = new Set();
    const pending = new Set();
    let files = [];
    let currentFolderId = "root";
    let searchQuery = "";
    let typeQuery = "all";
    let statusQuery = "all";
    let sortBy = "name";
    let sortAsc = true;
    let trashMode = false;
    let atrState = null;
    let activeOperation = null;
    const mountedActivity = new Map();
    const mountedActivityTimers = new Map();

    function setStatus(message, kind) {
      if (!statusEl) return;
      statusEl.textContent = message || "";
      statusEl.className = "disklib-status" + (kind ? " " + kind : "");
    }

    function beginOperation() {
      const operation = { canceled: false };
      activeOperation = operation;
      if (cancelBtn) cancelBtn.disabled = false;
      return operation;
    }

    function finishOperation(operation) {
      if (activeOperation !== operation) return;
      activeOperation = null;
      if (cancelBtn) cancelBtn.disabled = true;
    }

    function operationProgress(operation, progress) {
      if (activeOperation !== operation || !progress) return;
      const total = progress.total > 0 ? progress.total : "?";
      setStatus(String(progress.phase || "working").toUpperCase() + " " +
        progress.completed + "/" + total +
        (progress.current ? " " + progress.current : ""), "busy");
    }

    function fileById(id) {
      for (let i = 0; i < files.length; i++) {
        if (files[i].id === id) return files[i];
      }
      return null;
    }

    function updateSelectionInfo() {
      if (!infoEl) return;
      if (selected.size !== 1) {
        infoEl.textContent = "";
        infoEl.title = "";
        return;
      }
      const info = fileById(Array.from(selected)[0]);
      if (!info) {
        infoEl.textContent = "";
        infoEl.title = "";
        return;
      }
      const revisions = typeof library.listRevisions === "function"
        ? library.listRevisions(info.id) : [];
      const preferred = revisions.find(function (revision) { return revision.preferred; });
      const modified = info.modified ? new Date(info.modified).toLocaleString() : "unknown";
      const parts = [String(info.format || "").toUpperCase()];
      if (preferred) parts.push("Revision " + preferred.id);
      parts.push(revisions.length + (revisions.length === 1 ? " revision" : " revisions"));
      parts.push("Modified " + modified);
      parts.push(info.dirty ? "DIRTY" : "CLEAN");
      if (info.mountedSlot >= 0) parts.push("D" + (info.mountedSlot + 1));
      infoEl.textContent = parts.join(" | ");
      infoEl.title = infoEl.textContent;
    }

    function updateToolbar() {
      selected.forEach(function (id) {
        if (!fileById(id)) selected.delete(id);
      });
      const hasSelection = selected.size > 0;
      if (downloadBtn) downloadBtn.disabled = trashMode || !hasSelection;
      if (deleteBtn) deleteBtn.disabled = trashMode || !hasSelection;
      if (masterChk) masterChk.disabled = trashMode;
      if (selectAllBtn) selectAllBtn.disabled = trashMode;
      if (selectNoneBtn) selectNoneBtn.disabled = trashMode;
      if (purgeTrashBtn) purgeTrashBtn.disabled = !trashMode ||
        typeof library.listTrash !== "function" || library.listTrash().length === 0;
      if (purgeOldTrashBtn) purgeOldTrashBtn.disabled = !trashMode ||
        typeof library.listTrash !== "function" || library.listTrash().length === 0;
      if (trashBtn) {
        trashBtn.title = trashMode ? "Return to library" : "Open recoverable trash";
        trashBtn.setAttribute("aria-label", trashBtn.title);
      }
      if (selectedEl) {
        selectedEl.hidden = !hasSelection;
        selectedEl.textContent = hasSelection
          ? selected.size + " selected"
          : "";
      }
      if (masterChk) {
        masterChk.checked = files.length > 0 && selected.size === files.length;
        masterChk.indeterminate = selected.size > 0 && selected.size < files.length;
      }
      updateSelectionInfo();
    }

    function createTextCell(className, text) {
      const cell = document.createElement("span");
      cell.className = "disklib-col " + className;
      cell.textContent = text;
      return cell;
    }

    function collectFolderChoices(parentId, prefix, result) {
      const children = typeof library.listFolders === "function"
        ? library.listFolders(parentId)
        : [];
      children.forEach(function (folder) {
        result.push({ id: folder.id, label: prefix + folder.name });
        collectFolderChoices(folder.id, prefix + folder.name + " / ", result);
      });
    }

    function chooseFolder(info) {
      const choices = [{ id: "root", label: "Library" }];
      collectFolderChoices("root", "Library / ", choices);
      const lines = choices.map(function (choice, index) {
        return index + ": " + choice.label;
      }).join("\n");
      const currentIndex = Math.max(0, choices.findIndex(function (choice) {
        return choice.id === info.folderId;
      }));
      const answer = prompt(
        "Move " + info.name + " to folder. Enter a folder number:\n\n" + lines,
        String(currentIndex),
      );
      if (answer === null) return Promise.resolve(false);
      const index = Number.parseInt(answer, 10);
      if (!Number.isInteger(index) || index < 0 || index >= choices.length) {
        setStatus("Invalid destination folder", "error");
        return Promise.resolve(false);
      }
      const target = choices[index];
      if (target.id === info.folderId) {
        setStatus(info.name + " is already in " + target.label, "success");
        return Promise.resolve(false);
      }
      setStatus("Moving " + info.name + "...", "busy");
      return library.moveFile(info.id, target.id).then(function () {
        setStatus("Moved " + info.name + " to " + target.label, "success");
        return true;
      });
    }

    function mountedPath(info) {
      const path = typeof library.getFolderPath === "function"
        ? library.getFolderPath(info.folderId)
        : [];
      const names = path.map(function (item) { return item.name; });
      names.push(info.name);
      return names.join(" / ");
    }

    function renderMounted(allFiles) {
      if (!mountedListEl) return;
      mountedListEl.textContent = "";
      const mounted = (allFiles || []).filter(function (info) {
        return info && info.mountedSlot >= 0 && info.mountedSlot < 8;
      }).sort(function (a, b) { return a.mountedSlot - b.mountedSlot; });
      if (!mounted.length) {
        const empty = document.createElement("span");
        empty.className = "disklib-mounted-empty";
        empty.textContent = "No disk images mounted";
        mountedListEl.appendChild(empty);
        return;
      }
      mounted.forEach(function (info) {
        const row = document.createElement("div");
        row.className = "disklib-mounted-row";
        const unit = document.createElement("span");
        unit.className = "disklib-mounted-unit";
        unit.textContent = "D" + (info.mountedSlot + 1) + ":";
        row.appendChild(unit);
        const path = document.createElement("span");
        path.className = "disklib-mounted-path";
        path.textContent = mountedPath(info);
        path.title = path.textContent;
        row.appendChild(path);
        const activity = document.createElement("span");
        const activeActivity = mountedActivity.get(info.mountedSlot);
        activity.className = "disklib-mounted-activity" +
          (activeActivity ? " active " + activeActivity.className : "");
        activity.title = activeActivity
          ? activeActivity.title
          : "No active media operation";
        activity.setAttribute("aria-label", activity.title);
        row.appendChild(activity);
        const unmount = document.createElement("button");
        unmount.type = "button";
        unmount.className = "disklib-action-btn";
        unmount.title = "Unmount from D" + (info.mountedSlot + 1) + ":";
        unmount.innerHTML = '<i class="fa-solid fa-eject"></i> Unmount';
        unmount.addEventListener("click", function () {
          setStatus("Unmounting " + info.name + "...", "busy");
          library.unmountFile(info.id).then(function () {
            setStatus("Unmounted " + info.name, "success");
            render();
          }).catch(function (err) {
            setStatus(err && err.message ? err.message : "Unmount failed", "error");
          });
        });
        row.appendChild(unmount);
        mountedListEl.appendChild(row);
      });
    }

    function hexPreview(bytes, limit) {
      const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
      const length = Math.min(view.length, limit || 4096);
      const lines = [];
      for (let offset = 0; offset < length; offset += 16) {
        const hex = [];
        let ascii = "";
        for (let i = 0; i < 16; i++) {
          if (offset + i < length) {
            const value = view[offset + i];
            hex.push(value.toString(16).padStart(2, "0"));
            ascii += value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : ".";
          } else {
            hex.push("  ");
            ascii += " ";
          }
        }
        lines.push(offset.toString(16).padStart(6, "0") + "  " + hex.join(" ") + "  |" + ascii + "|");
      }
      if (view.length > length) lines.push("... " + (view.length - length) + " more bytes");
      return lines.join("\n");
    }

    function showAtrPreview(name, bytes) {
      if (!atrPreviewEl || !atrPreviewTitleEl || !atrPreviewTextEl) return;
      const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
      let printable = 0;
      for (let i = 0; i < Math.min(view.length, 4096); i++) {
        const code = view[i] & 0x7f;
        if (code === 0x09 || code === 0x0a || code === 0x0d || (code >= 0x20 && code <= 0x7e)) printable++;
      }
      const textLike = /\.(txt|doc|lst|bas|asm|atrw|cfg)$/i.test(name || "") ||
        (view.length > 0 && printable / Math.min(view.length, 4096) >= 0.85);
      atrPreviewTitleEl.textContent = (textLike ? "ATASCII preview: " : "Hexadecimal preview: ") + name;
      atrPreviewTextEl.textContent = textLike && typeof window.A8EAtrInspector.decodeAtascii === "function"
        ? window.A8EAtrInspector.decodeAtascii(view)
        : hexPreview(view);
      atrPreviewEl.hidden = false;
    }

    function renderAtrView() {
      if (!atrState || !atrView || !atrListEl) return;
      panel.classList.add("disklib-atr-view-mode");
      atrView.hidden = false;
      const info = atrState.info;
      const inspection = atrState.inspection;
      if (atrTitleEl) atrTitleEl.textContent = info.name;
      if (currentPathEl) {
        const path = typeof library.getFolderPath === "function"
          ? library.getFolderPath(info.folderId)
          : [];
        currentPathEl.textContent = path.map(function (item) { return item.name; }).concat(info.name).join(" / ");
      }
      if (atrInfoEl) {
        if (!inspection.valid) {
          atrInfoEl.textContent = "Invalid ATR: " + inspection.error;
        } else {
          const header = inspection.header;
          const filesystem = inspection.filesystem
            ? inspection.filesystem.name
            : "Unrecognized filesystem";
          atrInfoEl.textContent = "Filesystem: " + filesystem +
            "  |  " + header.sectorSize + "-byte sectors  |  " +
            header.totalSectors + " sectors  |  Read-only inspection";
        }
      }
      atrListEl.textContent = "";
      if (!inspection.valid) return;
      if (!inspection.filesystem) {
        const raw = document.createElement("div");
        raw.className = "disklib-atr-raw";
        raw.textContent = hexPreview(atrState.bytes);
        atrListEl.appendChild(raw);
        if (atrPreviewEl) atrPreviewEl.hidden = true;
        return;
      }
      inspection.entries.forEach(function (entry) {
        const row = document.createElement("div");
        row.className = "disklib-atr-row";
        const name = document.createElement("span");
        name.className = "disklib-atr-name";
        name.textContent = entry.name;
        row.appendChild(name);
        const sectors = document.createElement("span");
        sectors.textContent = String(entry.sectors);
        row.appendChild(sectors);
        const start = document.createElement("span");
        start.textContent = String(entry.startSector);
        row.appendChild(start);
        const status = document.createElement("span");
        status.textContent = entry.locked ? "LOCKED" : (entry.open ? "OPEN" : "READY");
        row.appendChild(status);
        const actions = document.createElement("span");
        actions.className = "disklib-atr-actions";
        const preview = document.createElement("button");
        preview.type = "button";
        preview.className = "disklib-action-btn";
        preview.title = "Preview " + entry.name;
        preview.setAttribute("aria-label", "Preview " + entry.name);
        preview.innerHTML = '<i class="fa-solid fa-eye"></i>';
        preview.addEventListener("click", function () {
          try {
            showAtrPreview(entry.name, window.A8EAtrInspector.extractFile(
              atrState.bytes,
              inspection,
              entry,
            ));
          } catch (err) {
            setStatus(err && err.message ? err.message : "Unable to preview file", "error");
          }
        });
        actions.appendChild(preview);
        const download = document.createElement("button");
        download.type = "button";
        download.className = "disklib-action-btn";
        download.title = "Download " + entry.name;
        download.setAttribute("aria-label", "Download " + entry.name);
        download.innerHTML = '<i class="fa-solid fa-download"></i>';
        download.addEventListener("click", function () {
          try {
            const bytes = window.A8EAtrInspector.extractFile(atrState.bytes, inspection, entry);
            triggerDownload({ bytes: bytes, name: entry.name || "file.bin" });
            setStatus("Downloaded " + entry.name, "success");
          } catch (err) {
            setStatus(err && err.message ? err.message : "Unable to extract file", "error");
          }
        });
        actions.appendChild(download);
        row.appendChild(actions);
        row.addEventListener("dblclick", function () { preview.click(); });
        atrListEl.appendChild(row);
      });
      if (!inspection.entries.length) {
        const empty = document.createElement("div");
        empty.className = "disklib-empty";
        empty.textContent = "No files in the recognized directory";
        atrListEl.appendChild(empty);
      }
      if (atrPreviewEl) atrPreviewEl.hidden = true;
    }

    function closeAtrView() {
      atrState = null;
      if (atrView) atrView.hidden = true;
      panel.classList.remove("disklib-atr-view-mode");
      render();
    }

    function openAtrView(info) {
      if (!window.A8EAtrInspector || info.format !== "atr") return;
      setStatus("Inspecting " + info.name + "...", "busy");
      library.downloadFile(info.id).then(function (result) {
        const bytes = result && result.buffer
          ? new Uint8Array(result.buffer)
          : new Uint8Array(result && result.bytes ? result.bytes : 0);
        atrState = {
          info: info,
          bytes: bytes,
          inspection: window.A8EAtrInspector.inspect(bytes),
        };
        setStatus("Opened " + info.name, "success");
        renderAtrView();
      }).catch(function (err) {
        setStatus(err && err.message ? err.message : "Unable to inspect ATR", "error");
      });
    }

    function renderTrash() {
      const items = typeof library.listTrash === "function" ? library.listTrash() : [];
      files = [];
      panel.classList.remove("disklib-search-mode");
      if (currentPathEl) currentPathEl.textContent = "Trash";
      if (listEl) {
        listEl.textContent = "";
        items.forEach(function (info) {
          const row = document.createElement("div");
          row.className = "disklib-row disklib-trash-row";
          row.appendChild(createTextCell("disklib-col-chk", ""));
          const nameCell = document.createElement("span");
          nameCell.className = "disklib-col disklib-col-name";
          nameCell.textContent = String(info.format || "").toUpperCase() + " " + info.name;
          nameCell.title = "Deleted " + new Date(info.deletedAt || 0).toLocaleString();
          row.appendChild(nameCell);
          for (let drive = 0; drive < DRIVE_COUNT; drive++) row.appendChild(createTextCell("disklib-col-drive", ""));
          const actions = document.createElement("span");
          actions.className = "disklib-col disklib-col-actions";
          const restore = document.createElement("button");
          restore.type = "button";
          restore.className = "disklib-action-btn";
          restore.title = "Restore " + info.name;
          restore.innerHTML = '<i class="fa-solid fa-trash-can-arrow-up"></i>';
          restore.addEventListener("click", function (event) {
            event.stopPropagation();
            library.restoreTrash(info.id).then(function () {
              setStatus("Restored " + info.name, "success");
              render();
            }).catch(function (err) {
              setStatus(err && err.message ? err.message : "Restore failed", "error");
            });
          });
          actions.appendChild(restore);
          const purge = document.createElement("button");
          purge.type = "button";
          purge.className = "disklib-action-btn disklib-btn-danger";
          purge.title = "Purge " + info.name;
          purge.innerHTML = '<i class="fa-solid fa-fire"></i>';
          purge.addEventListener("click", function (event) {
            event.stopPropagation();
            if (!confirm("Permanently purge " + info.name + "?")) return;
            library.purgeTrash(info.id).then(function () {
              setStatus("Purged " + info.name, "success");
              render();
            }).catch(function (err) {
              setStatus(err && err.message ? err.message : "Purge failed", "error");
            });
          });
          actions.appendChild(purge);
          row.appendChild(actions);
          listEl.appendChild(row);
        });
        if (!items.length) {
          const empty = document.createElement("div");
          empty.className = "disklib-empty";
          empty.innerHTML = '<i class="fa-solid fa-trash-can"></i><br>Trash is empty';
          listEl.appendChild(empty);
        }
      }
      if (countEl) countEl.textContent = items.length + (items.length === 1 ? " trashed item" : " trashed items");
      if (totalEl) totalEl.textContent = formatSize(items.reduce(function (sum, item) { return sum + (item.size | 0); }, 0)) + " recoverable";
      updateToolbar();
    }

    function render() {
      const allFiles = typeof library.listFiles === "function" ? library.listFiles() : [];
      renderMounted(allFiles);
      if (atrState) {
        renderAtrView();
        return;
      }
      if (trashMode) {
        renderTrash();
        return;
      }
      const searching = !!searchQuery;
      panel.classList.toggle("disklib-search-mode", searching);
      files = searching
        ? allFiles.filter(function (info) {
          return String(info.name || "").toLocaleLowerCase().includes(searchQuery);
        })
        : (typeof library.listFiles === "function" ? library.listFiles(currentFolderId) : []);
      files = files.filter(function (info) {
        if (typeQuery !== "all" && info.format !== typeQuery) return false;
        if (statusQuery === "mounted" && info.mountedSlot < 0) return false;
        if (statusQuery === "dirty" && !info.dirty) return false;
        if (statusQuery === "clean" && info.dirty) return false;
        return true;
      });
      files.sort(function (a, b) {
        let comparison = 0;
        if (sortBy === "size") comparison = (a.size | 0) - (b.size | 0);
        else if (sortBy === "type") comparison = String(a.format).localeCompare(String(b.format));
        else if (sortBy === "modified") comparison = (a.modified || 0) - (b.modified || 0);
        else comparison = String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" });
        if (!comparison) comparison = String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" });
        return sortAsc ? comparison : -comparison;
      });
      const childFolders = searching
        ? []
        : (typeof library.listFolders === "function" ? library.listFolders(currentFolderId) : []);
      const currentFolder = typeof library.getFolder === "function" ? library.getFolder(currentFolderId) : null;
      const path = typeof library.getFolderPath === "function" ? library.getFolderPath(currentFolderId) : [];
      if (currentPathEl) {
        currentPathEl.textContent = searching
          ? "Search: " + searchQuery
          : (path.map(function (item) { return item.name; }).join(" / ") || "Library");
      }
      if (!listEl) return;
      listEl.textContent = "";
      let total = 0;

      function appendEmptyCell(row, className) {
        row.appendChild(createTextCell(className, ""));
      }

      if (currentFolder && currentFolder.parentId) {
        const parent = library.getFolder(currentFolder.parentId);
        const row = document.createElement("div");
        row.className = "disklib-row disklib-folder-row";
        appendEmptyCell(row, "disklib-col-chk");
        const nameCell = document.createElement("span");
        nameCell.className = "disklib-col disklib-col-name";
        nameCell.innerHTML = '<i class="fa-solid fa-folder disklib-folder-icon"></i><span class="disklib-name">..</span>';
        row.appendChild(nameCell);
        for (let drive = 0; drive < DRIVE_COUNT; drive++) appendEmptyCell(row, "disklib-col-drive");
        const parentActions = document.createElement("span");
        parentActions.className = "disklib-col disklib-col-actions";
        row.appendChild(parentActions);
        row.title = "Go to " + (parent ? parent.name : "parent folder");
        row.addEventListener("click", function () {
          currentFolderId = currentFolder.parentId;
          selected.clear();
          render();
        });
        listEl.appendChild(row);
      }

      childFolders.forEach(function (folder) {
        const row = document.createElement("div");
        row.className = "disklib-row disklib-folder-row";
        appendEmptyCell(row, "disklib-col-chk");
        const nameCell = document.createElement("span");
        nameCell.className = "disklib-col disklib-col-name";
        nameCell.innerHTML = '<i class="fa-solid fa-folder disklib-folder-icon"></i>';
        const name = document.createElement("span");
        name.className = "disklib-name";
        name.textContent = folder.name;
        nameCell.appendChild(name);
        row.appendChild(nameCell);
        for (let drive = 0; drive < DRIVE_COUNT; drive++) appendEmptyCell(row, "disklib-col-drive");
        const folderActions = document.createElement("span");
        folderActions.className = "disklib-col disklib-col-actions";
        const renameFolder = document.createElement("button");
        renameFolder.type = "button";
        renameFolder.className = "disklib-action-btn";
        renameFolder.title = "Rename " + folder.name;
        renameFolder.innerHTML = '<i class="fa-solid fa-pen"></i>';
        renameFolder.addEventListener("click", function (event) {
          event.stopPropagation();
          const name = prompt("Folder name:", folder.name);
          if (!name || name === folder.name) return;
          library.renameFolder(folder.id, name).then(function () {
            setStatus("Renamed folder to " + name, "success");
            render();
          }).catch(function (err) {
            setStatus(err && err.message ? err.message : "Unable to rename folder", "error");
          });
        });
        folderActions.appendChild(renameFolder);
        const deleteFolder = document.createElement("button");
        deleteFolder.type = "button";
        deleteFolder.className = "disklib-action-btn disklib-btn-danger";
        deleteFolder.title = "Delete " + folder.name;
        deleteFolder.innerHTML = '<i class="fa-solid fa-trash"></i>';
        deleteFolder.addEventListener("click", function (event) {
          event.stopPropagation();
          if (!confirm("Delete empty folder " + folder.name + "?")) return;
          library.deleteFolder(folder.id).then(function () {
            setStatus("Deleted folder " + folder.name, "success");
            render();
          }).catch(function (err) {
            setStatus(err && err.message ? err.message : "Unable to delete folder", "error");
          });
        });
        folderActions.appendChild(deleteFolder);
        row.appendChild(folderActions);
        row.title = "Open folder " + folder.name;
        row.addEventListener("click", function () {
          currentFolderId = folder.id;
          selected.clear();
          render();
        });
        listEl.appendChild(row);
      });

      files.forEach(function (info) {
        total += info.size | 0;
        const row = document.createElement("div");
        row.className = "disklib-row" + (selected.has(info.id) ? " selected" : "");

        const selectCell = document.createElement("span");
        selectCell.className = "disklib-col disklib-col-chk";
        const selectChk = document.createElement("input");
        selectChk.type = "checkbox";
        selectChk.className = "disklib-row-chk";
        selectChk.checked = selected.has(info.id);
        selectChk.title = "Select file";
        selectChk.addEventListener("change", function () {
          if (selectChk.checked) selected.add(info.id);
          else selected.delete(info.id);
          render();
        });
        selectCell.appendChild(selectChk);
        row.appendChild(selectCell);

        const nameCell = document.createElement("span");
        nameCell.className = "disklib-col disklib-col-name";
        const type = document.createElement("span");
        type.className = "disklib-type disklib-type-" + info.format;
        type.textContent = String(info.format || "").toUpperCase();
        nameCell.appendChild(type);
        const name = document.createElement("span");
        name.className = "disklib-name";
        name.textContent = info.name;
        nameCell.appendChild(name);
        if (searching) {
          const sourcePath = document.createElement("span");
          sourcePath.className = "disklib-source-path";
          const folderPath = typeof library.getFolderPath === "function"
            ? library.getFolderPath(info.folderId)
            : [];
          sourcePath.textContent = folderPath.map(function (item) { return item.name; }).join(" / ");
          sourcePath.title = sourcePath.textContent;
          nameCell.appendChild(sourcePath);
        }
        if (info.dirty) {
          const dirty = document.createElement("span");
          dirty.className = "disklib-dirty";
          dirty.title = "Changes pending persistence";
          dirty.textContent = "*";
          nameCell.appendChild(dirty);
        }
        if (info.format === "atr") {
          nameCell.classList.add("disklib-open-atr");
          nameCell.title = "Open ATR contents";
          nameCell.addEventListener("click", function (event) {
            event.stopPropagation();
            openAtrView(info);
          });
        }
        row.appendChild(nameCell);

        for (let drive = 0; drive < DRIVE_COUNT; drive++) {
          const driveCell = document.createElement("span");
          driveCell.className = "disklib-col disklib-col-drive";
          const driveChk = document.createElement("input");
          driveChk.type = "checkbox";
          driveChk.className = "disklib-drive-chk";
          driveChk.checked = info.mountedSlot === drive;
          driveChk.disabled = pending.has(info.id + ":" + drive);
          driveChk.title =
            driveChk.checked ? "Unmount from D" + (drive + 1) + ":" : "Mount in D" + (drive + 1) + ":";
          driveChk.addEventListener("change", function () {
            const key = info.id + ":" + drive;
            pending.add(key);
            render();
            const operation = driveChk.checked
              ? library.mountFile(info.id, drive)
              : library.unmountFile(info.id);
            Promise.resolve(operation)
              .then(function () {
                const message = driveChk.checked
                  ? "Mounted " + info.name + " in D" + (drive + 1) + ":"
                  : "Unmounted " + info.name;
                setStatus(message, "success");
              })
              .catch(function (err) {
                setStatus(err && err.message ? err.message : "Unable to change drive mount", "error");
              })
              .finally(function () {
                pending.delete(key);
                render();
              });
          });
          driveCell.appendChild(driveChk);
          row.appendChild(driveCell);
        }

        const actionCell = document.createElement("span");
        actionCell.className = "disklib-col disklib-col-actions";
        if (info.format === "atr") {
          const openOne = document.createElement("button");
          openOne.type = "button";
          openOne.className = "disklib-action-btn";
          openOne.title = "Open ATR contents";
          openOne.setAttribute("aria-label", "Open ATR contents");
          openOne.innerHTML = '<i class="fa-solid fa-folder-open"></i>';
          openOne.addEventListener("click", function (event) {
            event.stopPropagation();
            openAtrView(info);
          });
          actionCell.appendChild(openOne);
          if (typeof library.verifyFile === "function") {
            const verifyOne = document.createElement("button");
            verifyOne.type = "button";
            verifyOne.className = "disklib-action-btn";
            verifyOne.title = "Verify ATR integrity";
            verifyOne.setAttribute("aria-label", "Verify ATR integrity");
            verifyOne.innerHTML = '<i class="fa-solid fa-shield-halved"></i>';
            verifyOne.addEventListener("click", function (event) {
              event.stopPropagation();
              setStatus("Verifying " + info.name + "...", "busy");
              library.verifyFile(info.id).then(function (report) {
                if (report.valid && (!report.warnings || !report.warnings.length)) {
                  setStatus("Integrity OK: " + info.name, "success");
                } else if (report.valid) {
                  setStatus("Integrity OK with warning: " + info.name, "success");
                } else {
                  setStatus("Integrity error: " + ((report.errors && report.errors[0]) || info.name), "error");
                }
              }).catch(function (err) {
                setStatus(err && err.message ? err.message : "ATR verification failed", "error");
              });
            });
            actionCell.appendChild(verifyOne);
          }
        }
        const downloadOne = document.createElement("button");
        downloadOne.type = "button";
        downloadOne.className = "disklib-action-btn";
        downloadOne.title = "Download current image";
        downloadOne.innerHTML = '<i class="fa-solid fa-download"></i>';
        downloadOne.addEventListener("click", function () {
          setStatus("Saving " + info.name + "...", "busy");
          library.downloadFile(info.id)
            .then(function (result) {
              triggerDownload(result);
              setStatus("Downloaded " + (result.name || info.name), "success");
            })
            .catch(function (err) {
              setStatus(err && err.message ? err.message : "Download failed", "error");
            });
        });
        actionCell.appendChild(downloadOne);
        const moveOne = document.createElement("button");
        moveOne.type = "button";
        moveOne.className = "disklib-action-btn";
        moveOne.title = "Move " + info.name;
        moveOne.innerHTML = '<i class="fa-solid fa-folder-tree"></i>';
        moveOne.addEventListener("click", function (event) {
          event.stopPropagation();
          chooseFolder(info).catch(function (err) {
            setStatus(err && err.message ? err.message : "Move failed", "error");
          });
        });
        actionCell.appendChild(moveOne);
        if (typeof library.listRevisions === "function" && typeof library.selectRevision === "function") {
          const revisions = library.listRevisions(info.id);
          if (revisions.length > 1) {
            const historyOne = document.createElement("button");
            historyOne.type = "button";
            historyOne.className = "disklib-action-btn";
            historyOne.title = "Select a retained revision";
            historyOne.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i>';
            historyOne.addEventListener("click", function (event) {
              event.stopPropagation();
              const lines = revisions.map(function (revision, index) {
                return index + ": " + new Date(revision.modified || 0).toLocaleString() +
                  (revision.preferred ? " (current)" : "") + " / " + formatSize(revision.size);
              }).join("\n");
              const answer = prompt("Select revision for " + info.name + ":\n\n" + lines, "0");
              if (answer === null) return;
              const index = Number.parseInt(answer, 10);
              if (!Number.isInteger(index) || index < 0 || index >= revisions.length) {
                setStatus("Invalid revision selection", "error");
                return;
              }
              setStatus("Selecting retained revision...", "busy");
              library.selectRevision(info.id, revisions[index].id).then(function () {
                setStatus("Revision selected for " + info.name, "success");
                render();
              }).catch(function (err) {
                setStatus(err && err.message ? err.message : "Revision selection failed", "error");
              });
            });
            actionCell.appendChild(historyOne);
          }
        }
        const deleteOne = document.createElement("button");
        deleteOne.type = "button";
        deleteOne.className = "disklib-action-btn disklib-btn-danger";
        deleteOne.title = "Delete " + info.name;
        deleteOne.innerHTML = '<i class="fa-solid fa-trash"></i>';
        deleteOne.addEventListener("click", function () {
          if (!confirm("Delete " + info.name + "?")) return;
          setStatus("Deleting " + info.name + "...", "busy");
          library.deleteFile(info.id).then(function () {
            selected.delete(info.id);
            setStatus("Moved " + info.name + " to trash", "success");
            render();
          }).catch(function (err) {
            setStatus(err && err.message ? err.message : "Delete failed", "error");
          });
        });
        actionCell.appendChild(deleteOne);
        row.appendChild(actionCell);
        listEl.appendChild(row);
      });

      if (!files.length && !childFolders.length) {
        const empty = document.createElement("div");
        empty.className = "disklib-empty";
        empty.innerHTML = searching
          ? '<i class="fa-solid fa-magnifying-glass"></i><br>No matching ATR or XEX files'
          : '<i class="fa-solid fa-floppy-disk"></i><br>No ATR or XEX files in the library';
        listEl.appendChild(empty);
      }

      if (countEl) countEl.textContent = files.length + (files.length === 1 ? " file" : " files");
      if (totalEl) totalEl.textContent = formatSize(total) + " stored";
      updateToolbar();
    }

    function readFiles(fileList) {
      const input = Array.from(fileList || []);
      const supported = input.filter(function (file) {
        return SUPPORTED_EXTENSIONS.has(extension(file.name));
      });
      if (supported.length !== input.length) {
        setStatus("Only ATR and XEX files can be added", "error");
      }
      return supported.reduce(function (chain, file) {
        return chain.then(function () {
          const relativePath = String(file.webkitRelativePath || file.relativePath || "");
          const pathParts = relativePath.split("/").filter(function (part) {
            return part && part !== "." && part !== "..";
          });
          pathParts.pop();
          let targetFolderPromise = Promise.resolve(currentFolderId);
          pathParts.forEach(function (part) {
            targetFolderPromise = targetFolderPromise.then(function (parentId) {
              const child = (typeof library.listFolders === "function" ? library.listFolders(parentId) : [])
                .find(function (folder) {
                  return folder.name.toUpperCase() === part.toUpperCase();
                });
              return child
                ? child.id
                : library.createFolder(part, parentId).then(function (folder) { return folder.id; });
            });
          });
          return file.arrayBuffer().then(function (buffer) {
            return targetFolderPromise.then(function (targetFolderId) {
              const existing = (typeof library.listFiles === "function" ? library.listFiles(targetFolderId) : [])
                .find(function (item) {
                  return item.name.toUpperCase() === file.name.toUpperCase();
                });
              const operation = existing
                ? (confirm("Replace " + existing.name + "?\nFolder: " + targetFolderId)
                  ? library.replaceFile(existing.id, file.name, buffer)
                  : Promise.resolve(null))
                : library.addFile(file.name, buffer, targetFolderId);
              return Promise.resolve(operation).then(function () {
                setStatus("Added " + file.name, "success");
              });
            });
          });
        });
      }, Promise.resolve()).catch(function (err) {
        setStatus(err && err.message ? err.message : "Unable to add file", "error");
      });
    }

    button.addEventListener("click", function () {
      const active = button.classList.toggle("active");
      panel.hidden = !active;
      if (!active) {
        atrState = null;
        panel.classList.remove("disklib-atr-view-mode");
      }
      if (active) render();
    });

    if (atrBackBtn) atrBackBtn.addEventListener("click", closeAtrView);
    if (atrDownloadBtn) {
      atrDownloadBtn.addEventListener("click", function () {
        if (!atrState) return;
        setStatus("Saving " + atrState.info.name + "...", "busy");
        library.downloadFile(atrState.info.id).then(function (result) {
          triggerDownload({
            bytes: result.buffer || result.bytes,
            name: result.name || atrState.info.name,
          });
          setStatus("Downloaded " + atrState.info.name, "success");
        }).catch(function (err) {
          setStatus(err && err.message ? err.message : "Download failed", "error");
        });
      });
    }

    if (searchInput) {
      searchInput.addEventListener("input", function () {
        searchQuery = String(searchInput.value || "").trim().toLocaleLowerCase();
        selected.clear();
        render();
      });
    }
    if (typeFilter) {
      typeFilter.addEventListener("change", function () {
        typeQuery = typeFilter.value || "all";
        selected.clear();
        render();
      });
    }
    if (statusFilter) {
      statusFilter.addEventListener("change", function () {
        statusQuery = statusFilter.value || "all";
        selected.clear();
        render();
      });
    }
    if (sortSelect) {
      sortSelect.addEventListener("change", function () {
        const next = sortSelect.value || "name";
        if (next === sortBy) sortAsc = !sortAsc;
        else {
          sortBy = next;
          sortAsc = true;
        }
        render();
      });
    }

    if (newFolderBtn) {
      newFolderBtn.addEventListener("click", function () {
        const name = prompt("Folder name:");
        if (!name) return;
        library.createFolder(name, currentFolderId).then(function (folder) {
          setStatus("Created folder " + folder.name, "success");
          render();
        }).catch(function (err) {
          setStatus(err && err.message ? err.message : "Unable to create folder", "error");
        });
      });
    }

    if (newAtrBtn) {
      newAtrBtn.addEventListener("click", function () {
        const suggested = typeof library.suggestBlankAtrName === "function"
          ? library.suggestBlankAtrName(currentFolderId)
          : "blank.atr";
        const name = prompt("ATR filename:", suggested);
        if (!name) return;
        setStatus("Creating " + name + "...", "busy");
        library.createBlankAtr(name, currentFolderId).then(function (info) {
          setStatus("Created " + info.name, "success");
          render();
        }).catch(function (err) {
          setStatus(err && err.message ? err.message : "Unable to create blank ATR", "error");
        });
      });
    }

    if (uploadBtn && uploadInput) {
      uploadBtn.addEventListener("click", function () { uploadInput.click(); });
      uploadInput.addEventListener("change", function () {
        readFiles(uploadInput.files);
        uploadInput.value = "";
      });
    }

    if (dropZone) {
      dropZone.addEventListener("dragover", function (event) {
        event.preventDefault();
        event.stopPropagation();
        dropZone.classList.add("drag-over");
      });
      dropZone.addEventListener("dragleave", function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove("drag-over");
      });
      dropZone.addEventListener("drop", function (event) {
        event.preventDefault();
        event.stopPropagation();
        dropZone.classList.remove("drag-over");
        readFiles(event.dataTransfer ? event.dataTransfer.files : []);
      });
      dropZone.addEventListener("a8e-native-file-drop", function (event) {
        const files = event.detail && Array.isArray(event.detail.files)
          ? event.detail.files
          : [];
        if (files.length) readFiles(files);
      });
    }

    if (selectAllBtn) {
      selectAllBtn.addEventListener("click", function () {
        files.forEach(function (file) { selected.add(file.id); });
        render();
      });
    }
    if (selectNoneBtn) {
      selectNoneBtn.addEventListener("click", function () {
        selected.clear();
        render();
      });
    }
    if (masterChk) {
      masterChk.addEventListener("change", function () {
        if (masterChk.checked) files.forEach(function (file) { selected.add(file.id); });
        else selected.clear();
        render();
      });
    }
    if (downloadBtn) {
      downloadBtn.addEventListener("click", function () {
        const ids = Array.from(selected);
        setStatus("Saving selected images...", "busy");
        ids.reduce(function (chain, id) {
          return chain.then(function () {
            return library.downloadFile(id).then(triggerDownload);
          });
        }, Promise.resolve()).then(function () {
          setStatus("Downloaded " + ids.length + " image" + (ids.length === 1 ? "" : "s"), "success");
        }).catch(function (err) {
          setStatus(err && err.message ? err.message : "Download failed", "error");
        });
      });
    }
    if (deleteBtn) {
      deleteBtn.addEventListener("click", function () {
        const ids = Array.from(selected);
        if (!ids.length) return;
        if (!confirm("Delete " + ids.length + " selected image" + (ids.length === 1 ? "" : "s") + "?")) return;
        setStatus("Deleting selected images...", "busy");
        ids.reduce(function (chain, id) {
          return chain.then(function () { return library.deleteFile(id); });
        }, Promise.resolve()).then(function () {
          selected.clear();
          setStatus("Moved " + ids.length + " image" + (ids.length === 1 ? "" : "s") + " to trash", "success");
          render();
        }).catch(function (err) {
          setStatus(err && err.message ? err.message : "Delete failed", "error");
        });
      });
    }
    if (trashBtn && typeof library.listTrash === "function") {
      trashBtn.addEventListener("click", function () {
        trashMode = !trashMode;
        selected.clear();
        if (trashMode) {
          searchQuery = "";
          if (searchInput) searchInput.value = "";
          setStatus("Opened recoverable trash", "success");
        } else {
          setStatus("Returned to library", "success");
        }
        render();
      });
    }
    if (purgeTrashBtn && typeof library.purgeAllTrash === "function") {
      purgeTrashBtn.addEventListener("click", function () {
        const items = library.listTrash();
        if (!items.length || !confirm("Permanently purge all " + items.length + " trashed item" + (items.length === 1 ? "" : "s") + "?")) return;
        library.purgeAllTrash().then(function (count) {
          setStatus("Purged " + count + " trash item" + (count === 1 ? "" : "s"), "success");
          render();
        }).catch(function (err) {
          setStatus(err && err.message ? err.message : "Trash purge failed", "error");
        });
      });
    }
    if (purgeOldTrashBtn && typeof library.purgeTrashBefore === "function") {
      purgeOldTrashBtn.addEventListener("click", function () {
        const rawDays = prompt("Purge trash older than how many days?", "30");
        if (rawDays === null) return;
        const days = Number(String(rawDays).trim());
        if (!Number.isInteger(days) || days < 0 || days > 3650000) {
          setStatus("Enter a number of days from 0 to 3650000", "error");
          return;
        }
        const cutoff = Date.now() - days * 86400000;
        const items = library.listTrash().filter(function (item) {
          return Number(item.deletedAt || 0) < cutoff;
        });
        if (!items.length) {
          setStatus("No trash items match that age", "success");
          return;
        }
        if (!confirm("Permanently purge " + items.length + " trash item" +
          (items.length === 1 ? "" : "s") + " older than " + days + " days?")) return;
        library.purgeTrashBefore(cutoff).then(function (count) {
          setStatus("Purged " + count + " old trash item" + (count === 1 ? "" : "s"), "success");
          render();
        }).catch(function (err) {
          setStatus(err && err.message ? err.message : "Old trash purge failed", "error");
        });
      });
    }

    if (exportBtn) {
      exportBtn.addEventListener("click", function () {
        const operation = beginOperation();
        setStatus("Exporting library...", "busy");
        library.exportPackage({
          fileName: "library.a8e",
          onProgress: function (progress) { operationProgress(operation, progress); },
          isCanceled: function () { return operation.canceled; },
        })
          .then(function (result) {
            const blob = new Blob([result.bytes], { type: "application/zip" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = result.fileName || "library.a8e";
            anchor.hidden = true;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            setStatus("Library exported", "success");
            finishOperation(operation);
          })
          .catch(function (err) {
            setStatus(err && err.message ? err.message : "Library export failed", "error");
            finishOperation(operation);
          });
      });
    }
    if (workspaceExportBtn && typeof library.exportWorkspacePackage === "function") {
      workspaceExportBtn.addEventListener("click", function () {
        const operation = beginOperation();
        setStatus("Exporting mounted workspace...", "busy");
        library.exportWorkspacePackage({
          fileName: "workspace.a8e",
          onProgress: function (progress) { operationProgress(operation, progress); },
          isCanceled: function () { return operation.canceled; },
        })
          .then(function (result) {
            const blob = new Blob([result.bytes], { type: "application/zip" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = result.fileName || "workspace.a8e";
            anchor.hidden = true;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            setStatus("Mounted workspace exported", "success");
            finishOperation(operation);
          })
          .catch(function (err) {
            setStatus(err && err.message ? err.message : "Workspace export failed", "error");
            finishOperation(operation);
          });
      });
    }
    if (storageBtn) {
      storageBtn.addEventListener("click", function () {
        if (typeof library.getStorageEstimate !== "function") {
          setStatus("Storage estimate unavailable", "error");
          return;
        }
        setStatus("Reading browser storage capacity...", "busy");
        library.getStorageEstimate().then(function (estimate) {
          if (!estimate.supported || !estimate.quota) {
            setStatus("Browser storage estimate unavailable", "error");
            return;
          }
          setStatus(
            formatSize(estimate.usage) + " used / " +
              formatSize(estimate.quota) + " quota (" +
              formatSize(estimate.available) + " available)",
            "success",
          );
        }).catch(function (err) {
          setStatus(err && err.message ? err.message : "Storage estimate failed", "error");
        });
      });
    }
    if (importBtn && importInput) {
      importBtn.addEventListener("click", function () { importInput.click(); });
      importInput.addEventListener("change", function () {
        const file = importInput.files && importInput.files[0];
        importInput.value = "";
        if (!file) return;
        const operation = beginOperation();
        setStatus("Validating library package...", "busy");
        file.arrayBuffer().then(function (buffer) {
          const bytes = new Uint8Array(buffer);
          const previewBytes = new Uint8Array(bytes);
          const commitBytes = new Uint8Array(bytes);
          return library.previewImport(previewBytes.buffer, {
            onProgress: function (progress) { operationProgress(operation, progress); },
            isCanceled: function () { return operation.canceled; },
          }).then(function (preview) {
            const summary = preview.summary || {};
            const warning = preview.warning ? "\n\n" + preview.warning : "";
            const message = "Add " + (summary.added || 0) +
              " entries, skip " + (summary.duplicates || 0) +
              " duplicates, and preserve " + (summary.conflicts || 0) +
              " conflict(s) (newer " + (summary.newer || 0) +
              ", older " + (summary.older || 0) + ", concurrent " +
              (summary.concurrent || 0) + ")?\nFolders " +
              (summary.foldersAdded || 0) + ", renamed " +
              (summary.renamed || 0) + ", revisions " +
              (summary.revisions || 0) + ", payloads " +
              (summary.payloads || 0) + ", mounts " +
              (summary.mounts || 0) + warning;
            if (!confirm(message)) {
              setStatus("Library import canceled", "success");
              finishOperation(operation);
              return null;
            }
            setStatus("Importing library...", "busy");
            return library.importPackage(commitBytes.buffer, {
              onProgress: function (progress) { operationProgress(operation, progress); },
              isCanceled: function () { return operation.canceled; },
            });
          });
        }).then(function (result) {
          if (!result) return;
          const summary = result.summary || {};
          setStatus("Imported " + (summary.added || 0) + " entries", "success");
          finishOperation(operation);
          render();
        }).catch(function (err) {
          setStatus(err && err.message ? err.message : "Library import failed", "error");
          finishOperation(operation);
        });
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener("click", function () {
        if (!activeOperation) return;
        activeOperation.canceled = true;
        setStatus("Canceling library operation...", "busy");
      });
    }

    if (typeof library.onChange === "function") library.onChange(render);
    if (typeof app.onDiskActivity === "function") {
      app.onDiskActivity(function (activity) {
        if (!activity || typeof activity !== "object") return;
        const slot = activity.deviceSlot | 0;
        if (slot < 0 || slot > 7) return;
        const operation = String(activity.operation || "access").toLowerCase();
        const error = activity.error === true || activity.failed === true ||
          operation.indexOf("error") >= 0 || operation.indexOf("fail") >= 0;
        const write = !error && (operation === "write" || operation === "format");
        const state = error ? "error" : (write ? "write" : "read");
        mountedActivity.set(slot, {
          className: "disklib-activity-" + state,
          title: error ? "Media error" : (write ? "Writing" : "Reading"),
        });
        if (mountedActivityTimers.has(slot)) clearTimeout(mountedActivityTimers.get(slot));
        mountedActivityTimers.set(slot, setTimeout(function () {
          mountedActivity.delete(slot);
          mountedActivityTimers.delete(slot);
          render();
        }, 900));
        render();
      });
    }
    render();
  }

  window.A8EDiskLibraryUI = { init: init };
})();
