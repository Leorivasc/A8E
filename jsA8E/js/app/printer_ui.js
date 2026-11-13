(function () {
  "use strict";

  // Printer button and paper viewer. The button appears once something has
  // been printed; the panel shows the paper and saves it as text or HTML.

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

  function init(opts) {
    const config = opts && typeof opts === "object" ? opts : {};
    const app = config.app;
    const button = config.button;
    const panel = config.panel;
    const paper = window.A8EPrinterPaper ? window.A8EPrinterPaper.attach(app) : null;
    if (!paper || !button || !panel || panel.__a8ePrinterInit) return;
    panel.__a8ePrinterInit = true;

    const view = panel.querySelector(".printerPaper");
    const count = panel.querySelector(".printerCount");

    function refresh() {
      view.textContent = paper.toText();
      view.scrollTop = view.scrollHeight;
      count.textContent = paper.getLineCount() + " lines";
    }

    function setOpen(open) {
      panel.hidden = !open;
      button.classList.toggle("active", open);
      button.setAttribute("aria-pressed", open ? "true" : "false");
      if (open) refresh();
    }

    paper.onChange(function (lines) {
      button.hidden = false;
      if (!panel.hidden) refresh();
      if (lines === 0 && panel.hidden) button.hidden = true;
    });

    button.addEventListener("click", function () {
      setOpen(panel.hidden);
    });
    panel.querySelector('[data-printer="close"]').addEventListener("click", function () {
      setOpen(false);
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
