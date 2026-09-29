# AHRM-06 ANTIC Visual Test

`AHRM06_ANTIC_TEST.XEX` is a small visual diagnostic for comparing jsA8E,
native A8E, Altirra, and real Atari hardware.

## What it exercises

The display list contains three sections that repeat continuously. The mode
numbers below are **ANTIC display-list modes**, not Atari BASIC `GRAPHICS`
mode numbers:

1. Normal-width ANTIC mode 2 with a DLI boundary.
2. Wide-width ANTIC mode 2. The preceding DLI changes `DMACTL` to wide mode.
3. ANTIC mode 3 with `VSCROL`. The preceding DLI restores normal width and writes a
   non-zero vertical scroll value.

The DLI handler changes the background color at each boundary. This makes a
missed DLI, a late register write, or a bad playfield-width transition visible
as a missing color band, a shifted section, or corrupted text. The display
list ends with `JVB`, so the sequence repeats without CPU intervention.

## How to run

Load `AHRM06_ANTIC_TEST.XEX` as a normal XEX application. It does not require
an ATR or external files. Compare the three labeled sections across machines:

- `AHRM-06 ANTIC MODE 2`
- `AHRM-06 ANTIC MODE 2 WIDE`
- `AHRM-06 ANTIC MODE 3 + VSCROL`

The display should remain stable over several minutes. The background colors
should change at the two section boundaries, the wide section should begin at
the wide-playfield horizontal origin, and the mode-3 label should be fully
visible after the two intentionally partial VSCROL lines. With `VSCROL=4`,
the first line shows the lower character rows and the region-exit line shows
the upper character rows; neither should blink or change after the first
frame.

The full-height wide section should also show `DLI1`, and the full-height
mode-3 section should show `DLI2`. These markers are written by the two DLI
handlers into screen RAM, so they remain visible even if the OS VBI restores
the GTIA color registers.

## Limits

This is a visual regression aid, not a replacement for the native and JS
probes. A guest XEX cannot read ANTIC's internal DMA schedule or prove the
cycle-5/cycle-108 VSCROL deadlines. Those requirements remain covered by:

- `A8E/tests/antic_timing_probe.c`
- `A8E/tests/antic_graphics_modes_probe.c`
- `jsA8E/tests/antic_vscrol_timing.test.js`
- `jsA8E/tests/playfield_mode_2_3_rendering.test.js`
