# Printer (P:) and the generic SIO device contract

jsA8E emulates two SIO printers (AHRM 9.1, 9.3, 9.6), chosen in the printer
panel (`app.setPrinterModel`, remembered in `localStorage`): the **1025**
(80 columns, the default) and the **820** (40 columns, also the generic P:). The OS P: handler in the ROM does
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

## Models

| | 820 / generic P: | 1025 |
|---|---|---|
| IDs | `$40` | `$40`, `$42` |
| Write `$57` | AUX1 `$4E` (40 bytes) or `$53` (29 bytes, sideways); else NAK | AUX1 `$4E` only, 40 bytes; else NAK |
| Data frames | each is one printed line | spliced into one line until an EOL or a full line (80/40/132 columns by density) |
| After an EOL | n/a | the rest of the frame (the OS pads it) is ignored |
| Status `$53` | `[flags, last AUX1, $06, $00]` | `[flags, $00, $0F, $30]` and it resets the settings and drops a partial line |
| Escapes | none | at the start of a line: `ESC CTRL+T/O/N` (16.5/10/5 cpi), `ESC L/S` (long/short line), `ESC 6/8` (lpi); anywhere: `ESC CTRL+W/X` (European characters) |

Common to both: bit 7 of each character is ignored, flag bit 0 is a command
error and bit 1 a data-frame error. 820: normal prints `$20-$7E` and blanks the
rest, sideways keeps `$30-$5F`, maps `$60-$7F` down and prints right to left.
1025: `$00-$1F`, `$60`, `$7B` and `$7D-$7F` are blank or ignored unless European
characters are on; a line that is exactly full prints at once and the EOL that
follows does not add a blank line.

Printing is instantaneous; the real printers take about 0.8 s (820) per line.

Word processors send lines wider than 40 bytes (Atari Writer: 10 space margin
plus text). The OS P: handler cuts them into 40 byte frames, so the 820 model
prints one logical line as several; the 1025 joins them back.

## Page events

`{type:"line", text, sideways, columns}` exists; the 1025 adds `cpi`, `lpi` and
`shortLine` (carried to the paper but not rendered yet). A model with attributes,
dot columns (1029 bit image) or vectors (1020) adds event types here and a
case in `printer_paper.js`; the bus does not change.

## Open work

- 1029 and 1020 models; graphical (SVG) rendering of dot and vector events.
- Native C core (`Pokey.c` has the disks hard-wired; it needs the same registry).
- Short-line centering, density and spacing are not drawn; out-of-paper errors are not modelled.
- A TEMPORARY `frame` event and the `raw` button of the panel show the
  untranslated data frames (marked `TEMPORARY (raw-frame experiment)`); remove
  them once the 1029 is done.
- Sideways lines are shown in reading order and tagged, not rotated.
- Printer state (last orientation, error flags) is not stored in snapshots.
- Not exposed through the automation API / MCP yet.
