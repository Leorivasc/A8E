# Printer (P:) and the generic SIO device contract

jsA8E emulates three SIO printers (AHRM 9.1, 9.3, 9.6, 9.8), chosen in the
printer panel (`app.setPrinterModel`, remembered in `localStorage`): the **1025**
(80 columns, the default), the **1029** (80 columns of dots, with graphics) and
the **820** (40 columns, also the generic P:). The OS P: handler in the ROM does
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

| | 820 / generic P: | 1025 | 1029 |
|---|---|---|---|
| IDs | `$40` | `$40`, `$42` | `$40`, `$45` |
| Write `$57` | AUX1 `$4E` (40 bytes) or `$53` (29 bytes, sideways); else NAK | AUX1 `$4E` only, 40 bytes; else NAK | any AUX1, always 40 bytes |
| Data frames | each is one printed line | spliced into one line until an EOL or a full line (80/40/132 columns by density) | spliced until an EOL or 480 dot columns |
| After an EOL | n/a | rest of the frame (OS padding) ignored | same |
| Status `$53` | `[flags, last AUX1, $06, $00]` | `[flags, $00, $0F, $30]`, resets the settings and drops a partial line | fixed `[0, 0, $14, $29]`, resets everything |
| Escapes | none | start of line: `ESC CTRL+T/O/N` (16.5/10/5 cpi), `ESC L/S`, `ESC 6/8`; anywhere: `ESC CTRL+W/X` | anywhere, even split across frames: `CTRL+N/O` wide/normal, `CTRL+Y/Z` underline, `6`/`9` lpi, `CTRL+W/X` international, `CTRL+A` bit image; bit 7 on the code is not recognized; `ESC ESC` = `ESC`, `ESC EOL` = EOL |
| Characters | see below | `$20-$5F`, `$61-$7A`, `$7C`; `$60`/`$7B`/`$7D-$7F` blank; `$00-$1F` ignored | ASCII `$20-$7F` (`$7F` is a solid block); `$00-$1F` ignored |

1029 specifics: a character is 5 dot columns plus 1 blank (10 + 2 wide); one line
is 480 columns, so 80 characters or 40 wide ones, and a character that does not
fit moves to the next line. Bit image: `ESC CTRL+A`, a 16-bit length (MSB first), then
one byte per column (bit 0 bottom pin, bit 6 top pin, bit 7 ignored, ESC and EOL
are plain data); it ends at the line end or after the length, and a printed line
always ends it. The spacing (6 or 9 lpi) active when the line ends applies to it.
EOL turns underlining off, a full line does not. AHRM and Altirra disagree on the
bit image code: AHRM says CTRL+A (`$01`), Altirra tests `$41`; this follows the AHRM.

Common: bit 7 of each character is ignored (not the 1029's escape codes), flag
bit 0 is a command error and bit 1 a data-frame error (820 and 1025). 820: normal prints `$20-$7E` and blanks the
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
`shortLine` (carried to the paper but not rendered yet) and the 1029 adds `lpi`,
`runs` (`[{text, elongated, underline}]`) and `dots` (bit image columns, starting at
the first dot column of the line, so text before the image shows as leading zeros).
The paper renders runs as spans (wide, underline) and dots as an SVG; plain text gets
`[bit image, N columns]`. Bit image and text of one line are drawn one under the
other, not overlapped, because the 1029 dot font is not included. A model with attributes,
dot columns (1029 bit image) or vectors (1020) adds event types here and a
case in `printer_paper.js`; the bus does not change.

## Open work

- 1020 model (vectors); drawing text as dots with the 1029 font so mixed lines overlap.
- Native C core (`Pokey.c` has the disks hard-wired; it needs the same registry).
- Short-line centering, density and spacing are not drawn; out-of-paper errors are not modelled.
- A TEMPORARY `frame` event and the `raw` button of the panel show the
  untranslated data frames (marked `TEMPORARY (raw-frame experiment)`); remove
  them once the 1029 is done.
- Sideways lines are shown in reading order and tagged, not rotated.
- Printer state (last orientation, error flags) is not stored in snapshots.
- Not exposed through the automation API / MCP yet.
