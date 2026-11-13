(function () {
  "use strict";

  // Atari SIO printers (AHRM 9.3 and 9.6) as devices for the generic SIO
  // device contract of pokey_sio.js. A model sees decoded commands and data
  // frames and never touches POKEY or bus timing. What it prints leaves
  // through host.notify() as page events, so a renderer (text, HTML, later
  // graphics) is independent of the protocol.
  //
  // Models, chosen with host.settings.printerModel:
  //   "820"   40 columns (29 sideways), every data frame is one printed line.
  //           Answers on $40 only. Also what a generic P: printer does.
  //   "1025"  80 columns by default. Data frames are spliced into one line
  //           until an EOL or until the line is full, and ESC commands change
  //           the density and line width. Answers on $40 and $42.
  //
  // Event emitted per printed line:
  //   { type: "line", text, sideways, columns, ... model specific fields }
  // Later printers (1029, 1020) add attribute, dot column and vector events
  // without changing the bus or this contract.

  const CMD_WRITE = 0x57;
  const CMD_STATUS = 0x53;
  const ORIENT_NORMAL = 0x4e;
  const ORIENT_SIDEWAYS = 0x53;
  const STATUS_COMMAND_ERROR = 0x01;
  const STATUS_DATA_ERROR = 0x02;
  const EOL = 0x9b;
  const ESC = 0x1b;
  const IGNORE = { ignore: true };

  // ---------------------------------------------------------------- 820

  const WIDTH_NORMAL = 40;
  const WIDTH_SIDEWAYS = 29;
  // AHRM 9.3: the 820 reports a timeout of $06 and an unused byte of $00.
  const STATUS_TIMEOUT_820 = 0x06;

  // AHRM 9.3: bit 7 is ignored. Normal orientation prints $20-$7E and turns
  // everything else, including EOL and DEL, into a space. Sideways keeps
  // $30-$5F, maps $60-$7F down to $40-$5F (lowercase prints as uppercase) and
  // blanks the rest.
  function translateNormal(code) {
    const c = code & 0x7f;
    return c >= 0x20 && c <= 0x7e ? c : 0x20;
  }

  function translateSideways(code) {
    let c = code & 0x7f;
    if (c >= 0x60) c -= 0x20;
    return c >= 0x30 && c <= 0x5f ? c : 0x20;
  }

  // Sideways text is printed right to left: the first character of the data
  // frame lands at the right margin.
  function renderLine(bytes, sideways) {
    const chars = [];
    for (let i = 0; i < bytes.length; i++) {
      chars.push(
        String.fromCharCode(
          sideways ? translateSideways(bytes[i]) : translateNormal(bytes[i]),
        ),
      );
    }
    if (sideways) chars.reverse();
    return chars.join("").replace(/ +$/, "");
  }

  function createPrinter820() {
    let lastOrientation = 0;
    let errorFlags = 0;

    function widthFor(orientation) {
      return orientation === ORIENT_SIDEWAYS ? WIDTH_SIDEWAYS : WIDTH_NORMAL;
    }

    function onCommand(frame) {
      // AHRM 9.3: the 820 responds to $40 only.
      if (frame.device !== 0x40) return IGNORE;
      if (frame.cmd === CMD_STATUS) {
        return {
          reply: Uint8Array.of(errorFlags, lastOrientation, STATUS_TIMEOUT_820, 0),
        };
      }
      if (frame.cmd === CMD_WRITE) {
        // The orientation is reported by STATUS even when it was rejected.
        lastOrientation = frame.aux1 & 0xff;
        if (lastOrientation !== ORIENT_NORMAL && lastOrientation !== ORIENT_SIDEWAYS) {
          errorFlags |= STATUS_COMMAND_ERROR;
          return null;
        }
        errorFlags = 0;
        return { receive: widthFor(lastOrientation) };
      }
      return null;
    }

    function onData(bytes, host) {
      const sideways = lastOrientation === ORIENT_SIDEWAYS;
      host.notify({
        type: "line",
        text: renderLine(bytes, sideways),
        sideways: sideways,
        columns: widthFor(lastOrientation),
      });
      return true;
    }

    return {
      onCommand: onCommand,
      onData: onData,
      onDataError: function () {
        errorFlags |= STATUS_DATA_ERROR;
      },
    };
  }

  // --------------------------------------------------------------- 1025

  const FRAME_1025 = 40;
  // AHRM 9.6: timeout $0F, unused byte $30, no orientation byte.
  const STATUS_TIMEOUT_1025 = 0x0f;
  const STATUS_UNUSED_1025 = 0x30;

  // International ATASCII characters, enabled by ESC CTRL+W (AHRM 9.6).
  const EUROPEAN = {
    0x00: "á", 0x01: "ù", 0x02: "Ñ", 0x03: "É",
    0x04: "ç", 0x05: "ô", 0x06: "ò", 0x07: "ì",
    0x08: "£", 0x09: "ï", 0x0a: "ü", 0x0b: "ä",
    0x0c: "Ö", 0x0d: "ú", 0x0e: "ó", 0x0f: "ö",
    0x10: "Ü", 0x11: "â", 0x12: "û", 0x13: "î",
    0x14: "é", 0x15: "è", 0x16: "ñ", 0x17: "ê",
    0x18: "å", 0x19: "à", 0x1a: "Å", 0x1c: "↑",
    0x1d: "↓", 0x1e: "←", 0x1f: "→", 0x60: "¡",
    0x7b: "Ä",
  };

  function createPrinter1025() {
    let errorFlags = 0;
    // State that ESC commands change; the power-on state is 10 cpi, 6 lpi,
    // long (80 column) lines and no European characters (AHRM 9.6).
    let cpi = 10;
    let lpi = 6;
    let shortLine = false;
    let european = false;
    let escape = false; // an ESC was seen mid-line
    let escapeAtStart = false; // an ESC was seen in the first column
    // The partial line that data frames are spliced into.
    let line = [];
    // True right after a full line was printed: an EOL that follows does not
    // print an extra blank line (AHRM 9.6, line overflow).
    let justFilled = false;

    function resetState() {
      cpi = 10;
      lpi = 6;
      shortLine = false;
      european = false;
      escape = false;
      escapeAtStart = false;
      line = [];
      justFilled = false;
    }

    function lineLength() {
      if (cpi === 5) return shortLine ? 32 : 40;
      if (cpi === 16.5) return shortLine ? 105 : 132;
      return shortLine ? 64 : 80;
    }

    function flushLine(host) {
      const text = line.join("").replace(/ +$/, "");
      host.notify({
        type: "line",
        text: text,
        sideways: false,
        columns: lineLength(),
        cpi: cpi,
        lpi: lpi,
        shortLine: shortLine,
      });
      line = [];
      escape = false;
      escapeAtStart = false;
    }

    // AHRM 9.6: the escape commands below only work in the first column;
    // ESC CTRL+W / CTRL+X work anywhere. Bit 7 is ignored on the code. Any
    // unrecognized sequence is ignored.
    function applyEscape(code, atStart) {
      if (atStart) {
        switch (code & 0x7f) {
          case 0x14: cpi = 16.5; break; // CTRL+T
          case 0x0f: cpi = 10; break; // CTRL+O
          case 0x0e: cpi = 5; break; // CTRL+N
          case 0x4c: shortLine = false; break; // L
          case 0x53: shortLine = true; break; // S
          case 0x36: lpi = 6; break; // 6
          case 0x38: lpi = 8; break; // 8
          default: break;
        }
      }
      if (code === 0x17) european = true; // CTRL+W
      else if (code === 0x18) european = false; // CTRL+X
    }

    function onCommand(frame) {
      // AHRM 9.6: P1: ($40) and P3: ($42).
      if (frame.device !== 0x40 && frame.device !== 0x42) return IGNORE;
      if (frame.cmd === CMD_STATUS) {
        const reply = Uint8Array.of(errorFlags, 0, STATUS_TIMEOUT_1025, STATUS_UNUSED_1025);
        // AHRM 9.6: STATUS also clears the settings and the line buffer, and
        // the OS P: handler issues it when P: is opened.
        errorFlags = 0;
        resetState();
        return { reply: reply };
      }
      if (frame.cmd === CMD_WRITE) {
        // Only normal width: sideways and anything else gets a NAK.
        if ((frame.aux1 & 0xff) !== ORIENT_NORMAL) {
          errorFlags |= STATUS_COMMAND_ERROR;
          return null;
        }
        errorFlags = 0;
        return { receive: FRAME_1025 };
      }
      return null;
    }

    function onData(bytes, host) {
      for (let i = 0; i < bytes.length; i++) {
        const c = bytes[i] & 0xff;
        if (c === EOL) {
          // The rest of the frame, which the OS pads, is ignored.
          if (line.length === 0 && justFilled) {
            justFilled = false;
            escape = false;
            escapeAtStart = false;
          } else {
            justFilled = false;
            flushLine(host);
          }
          break;
        }
        if (c === ESC) {
          if (line.length === 0) escapeAtStart = true;
          else escape = true;
          continue;
        }
        if (escapeAtStart || escape) {
          applyEscape(c, escapeAtStart);
          escape = false;
          escapeAtStart = false;
          continue;
        }

        // Printable character. Bit 7 is ignored. Without European mode
        // $00-$1F are ignored and $60, $7B and $7D-$7F print as blanks.
        let code = c & 0x7f;
        let char;
        if (european) {
          char = EUROPEAN[code] || (code >= 0x20 && code !== 0x7d && code !== 0x7e && code !== 0x7f
            ? String.fromCharCode(code)
            : " ");
        } else {
          if (code < 0x20) continue;
          if (code === 0x60 || code === 0x7b || code >= 0x7d) code = 0x20;
          char = String.fromCharCode(code);
        }
        justFilled = false;
        line.push(char);
        if (line.length >= lineLength()) {
          flushLine(host);
          justFilled = true;
        }
      }
      return true;
    }

    return {
      onCommand: onCommand,
      onData: onData,
      onDataError: function () {
        errorFlags |= STATUS_DATA_ERROR;
      },
    };
  }

  // ------------------------------------------------------------- device

  function createDevice() {
    const models = { "820": createPrinter820(), "1025": createPrinter1025() };
    let active = models["1025"];

    return {
      name: "printer",
      deviceIds: [0x40, 0x42],
      onCommand: function (frame, host) {
        const name = host.settings && host.settings.printerModel;
        active = models[name] || models["1025"];
        return active.onCommand(frame, host);
      },
      onData: function (bytes, host) {
        // TEMPORARY (raw-frame experiment): the untranslated data frame.
        host.notify({
          type: "frame",
          raw: Array.from(bytes, function (b) {
            return (b < 16 ? "0" : "") + b.toString(16);
          }).join(" "),
        });
        return active.onData(bytes, host);
      },
      onDataError: function (host) {
        active.onDataError(host);
      },
    };
  }

  window.A8ESioPrinter = {
    createDevice: createDevice,
    renderLine: renderLine,
    MODELS: ["1025", "820"],
  };
})();
