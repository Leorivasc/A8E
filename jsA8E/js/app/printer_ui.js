(function () {
  "use strict";

  // Printer button and paper viewer. The button appears once something has
  // been printed. The panel is docked as the last tool panel (next to the disk
  // library, HostFS and the assembler) or floats anywhere over the page; the
  // choice and the floating position are remembered. Narrow screens, where
  // the tool panels are a full-screen sheet, always float.

  const STORAGE_KEY = "a8e.printerPanel";
  const MARGIN = 8;

  function download(name, mime, text) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function loadState() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && typeof saved === "object") {
        return {
          floating: saved.floating === true,
          left: Number.isFinite(saved.left) ? saved.left : null,
          top: Number.isFinite(saved.top) ? saved.top : null,
        };
      }
    } catch {
      // storage unavailable or corrupt: use the defaults
    }
    return { floating: false, left: null, top: null };
  }

  function saveState(state) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // not persisted
    }
  }

  function init(opts) {
    const config = opts && typeof opts === "object" ? opts : {};
    const app = config.app;
    const button = config.button;
    const panel = config.panel;
    const mobileButton = config.mobileButton;
    const paper = window.A8EPrinterPaper ? window.A8EPrinterPaper.attach(app) : null;
    if (!paper || !button || !panel || panel.__a8ePrinterInit) return;
    panel.__a8ePrinterInit = true;

    const dockHome = panel.parentElement;
    const view = panel.querySelector(".printerPaper");
    const count = panel.querySelector(".printerCount");
    const bar = panel.querySelector(".printerBar");
    const state = loadState();

    // The printer model is a machine setting; the choice is remembered.
    const modelSelect = panel.querySelector('[data-printer="model"]');
    function normalizeModel(value) {
      return value === "820" || value === "1029" ? value : "1025";
    }
    let model = "1025";
    try {
      model = normalizeModel(window.localStorage.getItem("a8e.printerModel"));
    } catch {
      // not persisted
    }
    modelSelect.value = model;
    if (typeof app.setPrinterModel === "function") app.setPrinterModel(model);
    modelSelect.addEventListener("change", function () {
      model = normalizeModel(modelSelect.value);
      if (typeof app.setPrinterModel === "function") app.setPrinterModel(model);
      try {
        window.localStorage.setItem("a8e.printerModel", model);
      } catch {
        // not persisted
      }
    });

    function isNarrow() {
      return (
        typeof window.matchMedia === "function" &&
        window.matchMedia("(max-width: 980px)").matches
      );
    }

    function isFloating() {
      return state.floating || isNarrow() || !dockHome;
    }

    function clampPosition(left, top) {
      const width = panel.offsetWidth || 560;
      const height = panel.offsetHeight || 200;
      return {
        left: Math.min(Math.max(MARGIN, left), Math.max(MARGIN, window.innerWidth - width - MARGIN)),
        top: Math.min(Math.max(MARGIN, top), Math.max(MARGIN, window.innerHeight - height - MARGIN)),
      };
    }

    function placeFloating() {
      const width = panel.offsetWidth || 560;
      const height = panel.offsetHeight || 200;
      const left = state.left === null ? window.innerWidth - width - 16 : state.left;
      const top = state.top === null ? window.innerHeight - height - 16 : state.top;
      const pos = clampPosition(left, top);
      panel.style.left = pos.left + "px";
      panel.style.top = pos.top + "px";
    }

    // A floating panel lives in <body>, because the tool column can be hidden
    // (mobile) and must not clip or hide it.
    function applyMode() {
      const floating = isFloating();
      panel.classList.toggle("floating", floating);
      if (floating) {
        if (panel.parentElement !== document.body) document.body.appendChild(panel);
        placeFloating();
      } else {
        if (panel.parentElement !== dockHome) dockHome.appendChild(panel);
        panel.style.left = "";
        panel.style.top = "";
      }
    }

    function refresh() {
      view.innerHTML = paper.toHtmlBody();
      view.scrollTop = view.scrollHeight;
      count.textContent = paper.getLineCount() + " lines";
    }

    function setOpen(open) {
      panel.hidden = !open;
      button.classList.toggle("active", open);
      button.setAttribute("aria-pressed", open ? "true" : "false");
      if (open) {
        applyMode();
        refresh();
      }
    }

    // Drag by the title bar while floating, anywhere inside the browser window.
    let drag = null;

    bar.addEventListener("pointerdown", function (event) {
      if (!panel.classList.contains("floating")) return;
      if (event.button !== 0 || event.target.closest("button, select")) return;
      const box = panel.getBoundingClientRect();
      drag = { dx: event.clientX - box.left, dy: event.clientY - box.top };
      bar.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    bar.addEventListener("pointermove", function (event) {
      if (!drag) return;
      const pos = clampPosition(event.clientX - drag.dx, event.clientY - drag.dy);
      panel.style.left = pos.left + "px";
      panel.style.top = pos.top + "px";
    });

    function endDrag(event) {
      if (!drag) return;
      drag = null;
      if (bar.hasPointerCapture(event.pointerId)) bar.releasePointerCapture(event.pointerId);
      const box = panel.getBoundingClientRect();
      state.left = box.left;
      state.top = box.top;
      saveState(state);
    }
    bar.addEventListener("pointerup", endDrag);
    bar.addEventListener("pointercancel", endDrag);

    window.addEventListener("resize", function () {
      if (!panel.hidden) applyMode();
    });

    // The mobile tools sheet has its own copy of the button; both follow the
    // same visibility.
    function showButton(visible) {
      button.hidden = !visible;
      if (mobileButton) mobileButton.hidden = !visible;
    }

    paper.onChange(function (lines) {
      showButton(true);
      if (!panel.hidden) refresh();
      if (lines === 0 && panel.hidden) showButton(false);
    });

    button.addEventListener("click", function () {
      setOpen(panel.hidden);
    });
    panel.querySelector('[data-printer="close"]').addEventListener("click", function () {
      setOpen(false);
    });
    panel.querySelector('[data-printer="dock"]').addEventListener("click", function () {
      state.floating = !isFloating();
      saveState(state);
      applyMode();
    });
    panel.querySelector('[data-printer="text"]').addEventListener("click", function () {
      download("printer.txt", "text/plain;charset=utf-8", paper.toText());
    });
    panel.querySelector('[data-printer="html"]').addEventListener("click", function () {
      download("printer.html", "text/html;charset=utf-8", paper.toHtml());
    });
    panel.querySelector('[data-printer="print"]').addEventListener("click", function () {
      const win = window.open("", "_blank");
      if (!win) return;
      win.document.open();
      win.document.write(paper.toHtml());
      win.document.close();
      win.focus();
      win.print();
    });
    panel.querySelector('[data-printer="clear"]').addEventListener("click", function () {
      paper.clear();
      refresh();
    });
  }

  window.A8EPrinterUI = { init: init };
})();
