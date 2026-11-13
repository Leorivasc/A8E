(function () {
  "use strict";

  // Atari 820 40-column printer and the generic SIO printer (AHRM 9.3, 9.1).
  //
  // This is a device for the generic SIO device contract of pokey_sio.js: it
  // sees decoded commands and data frames and never touches POKEY or the bus
  // timing. What it prints leaves through host.notify() as page events, so a
  // renderer (text, HTML, later graphics) is independent of the protocol.
  //
  // Event emitted per printed line:
  //   { type: "line", text, sideways, columns }
  // Future printers (1025, 1029, 1020) extend the set with attribute, dot
  // column and vector events without changing the bus or this file.

  const CMD_WRITE = 0x57;
  const CMD_STATUS = 0x53;
  const ORIENT_NORMAL = 0x4e;
  const ORIENT_SIDEWAYS = 0x53;
  const WIDTH_NORMAL = 40;
  const WIDTH_SIDEWAYS = 29;
  const STATUS_COMMAND_ERROR = 0x01;
  const STATUS_DATA_ERROR = 0x02;
  // AHRM 9.3: the 820 reports a timeout of $06 and an unused byte of $00.
  const STATUS_TIMEOUT = 0x06;

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

  function createDevice(options) {
    const opts = options || {};
    const deviceIds = Array.isArray(opts.deviceIds) ? opts.deviceIds : [0x40];
    let lastOrientation = 0;
    let errorFlags = 0;

    function widthFor(orientation) {
      return orientation === ORIENT_SIDEWAYS ? WIDTH_SIDEWAYS : WIDTH_NORMAL;
    }

    function onCommand(frame) {
      if (frame.cmd === CMD_STATUS) {
        return {
          reply: Uint8Array.of(
            errorFlags,
            lastOrientation,
            STATUS_TIMEOUT,
            0,
          ),
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

    function onDataError() {
      errorFlags |= STATUS_DATA_ERROR;
    }

    function reset() {
      lastOrientation = 0;
      errorFlags = 0;
    }

    return {
      name: "printer",
      deviceIds: deviceIds,
      onCommand: onCommand,
      onData: onData,
      onDataError: onDataError,
      reset: reset,
    };
  }

  window.A8ESioPrinter = {
    createDevice: createDevice,
    renderLine: renderLine,
  };
})();
