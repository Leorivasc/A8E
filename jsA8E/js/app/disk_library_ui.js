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
    const newFolderBtn = panel.querySelector(".disklib-new-folder-btn");
    const newAtrBtn = panel.querySelector(".disklib-new-atr-btn");
    const currentPathEl = panel.querySelector(".disklib-current-path");
    const mountedListEl = panel.querySelector(".disklib-mounted-list");
    const searchInput = panel.querySelector(".disklib-search-input");
    const exportBtn = panel.querySelector(".disklib-export-btn");
    const importBtn = panel.querySelector(".disklib-import-btn");
    const importInput = panel.querySelector(".disklib-import-input");
    const statusEl = panel.querySelector(".disklib-status");
    const countEl = panel.querySelector(".disklib-stat-count");
    const selectedEl = panel.querySelector(".disklib-stat-sel");
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
    let atrState = null;
    const mountedActivity = new Map();
    const mountedActivityTimers = new Map();

    function setStatus(message, kind) {
      if (!statusEl) return;
      statusEl.textContent = message || "";
      statusEl.className = "disklib-status" + (kind ? " " + kind : "");
    }

    function fileById(id) {
      for (let i = 0; i < files.length; i++) {
        if (files[i].id === id) return files[i];
      }
      return null;
    }

    function updateToolbar() {
      selected.forEach(function (id) {
        if (!fileById(id)) selected.delete(id);
      });
      const hasSelection = selected.size > 0;
      if (downloadBtn) downloadBtn.disabled = !hasSelection;
      if (deleteBtn) deleteBtn.disabled = !hasSelection;
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
        activity.textContent = activeActivity ? "*" : "";
        activity.title = activeActivity
          ? (activeActivity.write ? "Writing" : "Reading")
          : "No active media operation";
        activity.setAttribute("aria-label", activity.title);
        row.appendChild(activity);
        const rw = document.createElement("span");
        rw.className = "disklib-mounted-rw disklib-rw-writable";
        rw.textContent = "*";
        rw.title = "Writable";
        row.appendChild(rw);
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

    function render() {
      const allFiles = typeof library.listFiles === "function" ? library.listFiles() : [];
      renderMounted(allFiles);
      if (atrState) {
        renderAtrView();
        return;
      }
      const searching = !!searchQuery;
      panel.classList.toggle("disklib-search-mode", searching);
      files = searching
        ? allFiles.filter(function (info) {
          return String(info.name || "").toLocaleLowerCase().includes(searchQuery);
        })
        : (typeof library.listFiles === "function" ? library.listFiles(currentFolderId) : []);
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
        appendEmptyCell(row, "disklib-col-rw");
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
        appendEmptyCell(row, "disklib-col-rw");
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
        const rwCell = document.createElement("span");
        rwCell.className = "disklib-col disklib-col-rw";
        const rw = document.createElement("span");
        rw.className = "disklib-rw disklib-rw-writable";
        rw.textContent = "*";
        rw.title = "Writable";
        rwCell.appendChild(rw);
        row.appendChild(rwCell);

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
            setStatus("Deleted " + info.name, "success");
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
          return file.arrayBuffer().then(function (buffer) {
            const existing = files.find(function (item) {
              return item.name.toUpperCase() === file.name.toUpperCase();
            });
            const operation = existing
              ? (confirm("Replace " + existing.name + "?")
                ? library.replaceFile(existing.id, file.name, buffer)
                : Promise.resolve(null))
              : library.addFile(file.name, buffer, currentFolderId);
            return Promise.resolve(operation).then(function () {
              setStatus("Added " + file.name, "success");
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
          setStatus("Deleted " + ids.length + " image" + (ids.length === 1 ? "" : "s"), "success");
          render();
        }).catch(function (err) {
          setStatus(err && err.message ? err.message : "Delete failed", "error");
        });
      });
    }

    if (exportBtn) {
      exportBtn.addEventListener("click", function () {
        setStatus("Exporting library...", "busy");
        library.exportPackage({ fileName: "library.a8e" })
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
          })
          .catch(function (err) {
            setStatus(err && err.message ? err.message : "Library export failed", "error");
          });
      });
    }
    if (importBtn && importInput) {
      importBtn.addEventListener("click", function () { importInput.click(); });
      importInput.addEventListener("change", function () {
        const file = importInput.files && importInput.files[0];
        importInput.value = "";
        if (!file) return;
        setStatus("Validating library package...", "busy");
        file.arrayBuffer().then(function (buffer) {
          const bytes = new Uint8Array(buffer);
          const previewBytes = new Uint8Array(bytes);
          const commitBytes = new Uint8Array(bytes);
          return library.previewImport(previewBytes.buffer).then(function (preview) {
            const summary = preview.summary || {};
            const warning = preview.warning ? "\n\n" + preview.warning : "";
            const message = "Add " + (summary.added || 0) +
              " entries, skip " + (summary.duplicates || 0) +
              " duplicates, and preserve " + (summary.conflicts || 0) +
              " conflict(s)?" + warning;
            if (!confirm(message)) {
              setStatus("Library import canceled", "success");
              return null;
            }
            setStatus("Importing library...", "busy");
            return library.importPackage(commitBytes.buffer);
          });
        }).then(function (result) {
          if (!result) return;
          const summary = result.summary || {};
          setStatus("Imported " + (summary.added || 0) + " entries", "success");
          render();
        }).catch(function (err) {
          setStatus(err && err.message ? err.message : "Library import failed", "error");
        });
      });
    }

    if (typeof library.onChange === "function") library.onChange(render);
    if (typeof app.onDiskActivity === "function") {
      app.onDiskActivity(function (activity) {
        if (!activity || typeof activity !== "object") return;
        const slot = activity.deviceSlot | 0;
        if (slot < 0 || slot > 7) return;
        const operation = String(activity.operation || "access").toLowerCase();
        const write = operation === "write" || operation === "format";
        mountedActivity.set(slot, {
          write: write,
          className: write ? "disklib-activity-write" : "disklib-activity-read",
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
