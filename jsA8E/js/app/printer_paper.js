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
        runs: Array.isArray(event.runs) ? event.runs : null,
        dots: Array.isArray(event.dots) ? event.dots : null,
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

    // Plain text cannot carry bit image graphics: a placeholder stands in.
    function lineToText(line) {
      if (!line.dots) return line.text;
      const note = "[bit image, " + line.dots.length + " columns]";
      return line.text ? line.text + " " + note : note;
    }

    function toText() {
      return lines.length
        ? lines.map(lineToText).join("\n") + "\n"
        : "";
    }

    // Bit image columns as dots: bit 0 is the bottom pin, bit 6 the top one.
    function dotsToSvg(dots) {
      const rects = [];
      for (let x = 0; x < dots.length; x++) {
        for (let bit = 0; bit < 7; bit++) {
          if (dots[x] & (1 << bit)) rects.push('<rect x="' + x + '" y="' + (6 - bit) + '" width="1" height="1"/>');
        }
      }
      return (
        '<svg class="dots" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dots.length + ' 7"' +
        ' width="' + dots.length * 1.5 + '" height="10.5" shape-rendering="crispEdges" fill="currentColor">' +
        rects.join("") + "</svg>"
      );
    }

    function runsToHtml(runs) {
      return runs
        .map(function (run) {
          const classes = (run.elongated ? "wide " : "") + (run.underline ? "ul" : "");
          const style = run.elongated ? ' style="margin-right:' + run.text.length + 'ch"' : "";
          const body = escapeHtml(run.text);
          return classes.trim() ? '<span class="' + classes.trim() + '"' + style + ">" + body + "</span>" : body;
        })
        .join("");
    }

    function lineToHtml(line) {
      const cls = line.sideways ? ' class="sideways"' : "";
      let body = line.runs ? runsToHtml(line.runs) : escapeHtml(line.text);
      if (line.dots) body += (body ? "<br>" : "") + dotsToSvg(line.dots);
      return "<div" + cls + ">" + (body || "&nbsp;") + "</div>";
    }

    // The paper as HTML (also what the panel shows). Everything is escaped.
    function toHtmlBody() {
      return lines.map(lineToHtml).join("");
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
      const rows = toHtmlBody();
      return (
        '<!doctype html>\n<html><head><meta charset="utf-8">' +
        "<title>" + escapeHtml(title || "Atari printer") + "</title>" +
        "<style>" +
        "body{margin:1.5cm;background:#fff;color:#000}" +
        ".paper{font:12pt/1.25 'Courier New',monospace;white-space:pre}" +
        ".sideways{font-style:italic}" +
        ".ul{text-decoration:underline}" +
        ".wide{display:inline-block;transform:scaleX(2);transform-origin:left}" +
        ".dots{display:block}" +
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
      toHtmlBody: toHtmlBody,
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
