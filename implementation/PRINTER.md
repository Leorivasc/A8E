# Printer (P:) and the generic SIO device contract

jsA8E emulates the Atari 820 40-column printer on SIO device `$40`, which is
also the generic P: printer (AHRM 9.1, 9.3). The OS P: handler in the ROM does
the CIO work; the emulator only needs the SIO peripheral. The core C emulator
does not have it yet.

## Layers

```text
OS P: handler  ->  SIO bus (pokey_sio.js)  ->  device (sio_printer.js)
                                                   | page events
                                                   v
                      app.onSioDeviceEvent  ->  paper (printer_paper.js)  ->  .txt / .html
                      (worker postMessage)       ^
                                                 printer_ui.js (button + panel, docked or floating)
```

- **Bus** (`js/core/pokey_sio.js`): owns the command frame, ACK/NAK, the data
  frame and its checksum, and the Complete/Error byte. A command frame with a
  bad checksum never reaches a device (AHRM 9.1: stay silent).
- **Device** (`js/core/sio_printer.js`): knows what a command means, nothing
  about POKEY or timing.
- **Paper** (`js/app/printer_paper.js`): collects page events and renders them.
  It lives on the UI side, so the same code serves the in-page core, the worker
  and headless tests.

## Device contract

`registerDevice(device)` in `pokey_sio.js` (`device.deviceIds` lists the IDs):

| Member | Meaning |
|---|---|
| `onCommand({cmd, aux1, aux2}, host)` | Returns `null` (NAK), `{complete:true}` (ACK, C), `{reply: Uint8Array}` (ACK, C, data + checksum) or `{receive: n}` (ACK, then a data frame of `n` bytes) |
| `onData(bytes, host)` | After a good data frame; return `false` to answer Error instead of Complete |
| `onDataError(host)` | Optional; the bus answers NAK to a bad data checksum |
| `host.notify(event)` | Sends an event out through `io.sioDeviceEventObserver` |

Events reach the application as `{ device, event }` through
`app.onSioDeviceEvent(listener)` (main thread: direct; worker: a
`sioDeviceEvent` message). The disk drive still uses its own handler; moving it
to this contract is open work.

## Behavior (AHRM 9.3)

- Write `$57`: AUX1 `$4E` (normal, 40 bytes) or `$53` (sideways, 29 bytes);
  anything else is NAK with the command-error flag. Bit 7 of each character is
  ignored; normal prints `$20-$7E` and blanks everything else (EOL included);
  sideways keeps `$30-$5F`, maps `$60-$7F` down by `$20` and prints right to left.
- Status `$53`: `[error flags, last AUX1, $06, $00]`. Flag bit 0 is a command
  error, bit 1 a data-frame error; both clear on the next valid Write.
- Printing is instantaneous; the real 820 takes about 0.8 s per line.

## Page events

Only `{type:"line", text, sideways, columns}` exists. A model with attributes,
dot columns (1029 bit image) or vectors (1020) adds event types here and a
case in `printer_paper.js`; the bus does not change.

## Open work

- 1025, 1029 and 1020 models; graphical (SVG) rendering of dot and vector events.
- Native C core (`Pokey.c` has the disks hard-wired; it needs the same registry).
- Sideways lines are shown in reading order and tagged, not rotated.
- Printer state (last orientation, error flags) is not stored in snapshots.
- Not exposed through the automation API / MCP yet.
