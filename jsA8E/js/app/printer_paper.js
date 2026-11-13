(function () {
  "use strict";

  // Paper model for the emulated printer. It collects the page events that a
  // printer device emits (see js/core/sio_printer.js) and renders them as
  // plain text or as a printable HTML page. The two renderers read the same
  // events, so a new event type (attributes, dot columns, vectors) is added
  // here and in the printer, never in the SIO bus.

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function createPaper(options) {
    const maxLines = Math.max(1, (options && options.maxLines) | 0 || 20000);
    let lines = [];
    let frames = []; // TEMPORARY (raw-frame experiment): data frames as hex
    const listeners = new Set();

    function add(event) {
      if (event && event.type === "frame") {
        frames.push(String(event.raw || ""));
        if (frames.length > maxLines) frames = frames.slice(frames.length - maxLines);
        listeners.forEach(function (listener) {
          listener(lines.length);
        });
        return;
      }
      if (!event || event.type !== "line") return;
      lines.push({
        text: String(event.text || ""),
        sideways: !!event.sideways,
        columns: event.columns | 0,
        cpi: Number(event.cpi) || 0,
        lpi: Number(event.lpi) || 0,
        shortLine: !!event.shortLine,
      });
      // A long session must not grow without bound: the oldest lines tear off.
      if (lines.length > maxLines) lines = lines.slice(lines.length - maxLines);
      listeners.forEach(function (listener) {
        listener(lines.length);
      });
    }

    function clear() {
      lines = [];
      frames = [];
      listeners.forEach(function (listener) {
        listener(0);
      });
    }

    function toText() {
      return lines.length
        ? lines
            .map(function (line) {
              return line.text;
            })
            .join("\n") + "\n"
        : "";
    }

    // TEMPORARY (raw-frame experiment): one data frame per row, hex bytes.
    function toRaw() {
      return frames
        .map(function (raw, index) {
          return String(index + 1).padStart(3, "0") + ": " + raw;
        })
        .join("\n");
    }

    // A standalone page. Browsers print it to paper or PDF as is. Sideways
    // lines (820 orientation S) keep their reading order and are tagged.
    function toHtml(title) {
      const rows = lines
        .map(function (line) {
          const cls = line.sideways ? ' class="sideways"' : "";
          return "<div" + cls + ">" + (escapeHtml(line.text) || "&nbsp;") + "</div>";
        })
        .join("\n");
      return (
        '<!doctype html>\n<html><head><meta charset="utf-8">' +
        "<title>" + escapeHtml(title || "Atari printer") + "</title>" +
        "<style>" +
        "body{margin:1.5cm;background:#fff;color:#000}" +
        ".paper{font:12pt/1.25 'Courier New',monospace;white-space:pre}" +
        ".sideways{font-style:italic}" +
        "@page{margin:1.5cm}" +
        "</style></head><body><div class=\"paper\">\n" +
        rows +
        "\n</div></body></html>\n"
      );
    }

    return {
      add: add,
      clear: clear,
      toText: toText,
      toRaw: toRaw,
      toHtml: toHtml,
      getLineCount: function () {
        return lines.length;
      },
      onChange: function (listener) {
        listeners.add(listener);
        return function () {
          listeners.delete(listener);
        };
      },
    };
  }

  // One paper per app, fed by the app's SIO device events from the printer
  // device ID range ($40-$4F). Works with the in-page core and the worker.
  function attach(app) {
    if (!app || typeof app.onSioDeviceEvent !== "function") return null;
    if (app.__a8ePrinterPaper) return app.__a8ePrinterPaper;
    const paper = createPaper();
    app.onSioDeviceEvent(function (message) {
      if (message && message.device >= 0x40 && message.device <= 0x4f) {
        paper.add(message.event);
      }
    });
    app.__a8ePrinterPaper = paper;
    return paper;
  }

  window.A8EPrinterPaper = { createPaper: createPaper, attach: attach };
})();
