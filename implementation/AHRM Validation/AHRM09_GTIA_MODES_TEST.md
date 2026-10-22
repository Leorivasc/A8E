# AHRM-09 GTIA Modes Test

`AHRM09_GTIA_MODES_TEST.XEX` is a visual diagnostic for GTIA modes 9, 10,
and 11. It uses ANTIC mode 2 and a deterministic full-screen data ramp.

The program starts in mode 9, changes to mode 10 after 128 frames, and changes
to mode 11 after another 128 frames. Each phase remains active for 128 frames
before the cycle repeats. The background colour also changes between phases so
that a capture can identify the active mode even when the ramp is difficult to
interpret.

There is deliberately no text overlay. The complete visible playfield is the
test pattern, so the mode and background transitions can be observed without
an overlay or a second DLI used to restore a text band.

## Observed result

The final visual check showed the intended behaviour: a fixed, repeated ramp
pattern fills the playfield, with no readable text and no change in geometric
resolution. Only the colour interpretation changes from phase to phase. The
same shapes remain in the same positions while the palette changes, including
the black areas that are part of the pattern.

The colour phase changes were visible at roughly three-second intervals in the
tested setup. This wall-clock interval depends on PAL/NTSC frame rate and the
host display path; the actual program interval is fixed at 128 frames per
phase. This result is accepted as the expected output for the current test.

## What to compare

- The number and ordering of visible luminance/colour steps.
- The horizontal alignment of the mode-10 ramp, which AHRM documents as a
  one-colour-clock-delayed mode.
- The behaviour when the phase changes at the DLI boundary.
- PAL versus NTSC frame timing and long-run stability.

The diagnostic deliberately reports observations rather than claiming a
software `PASS`: GTIA mode output is a video result and must be compared with
a screenshot or video capture from the reference machine.

## AHRM scope and limits

This covers the special-mode path described in AHRM 6.9, including the
high-resolution ANTIC input and the deterministic mode transitions. It does
not replace the native/JavaScript cycle probes, and it does not attempt to
certify every GTIA priority or collision combination; those belong to the
separate priority/PMG diagnostic.

Load the XEX without an ATR. Record the three full-screen phases separately on jsA8E,
native A8E, Altirra, and real PAL/NTSC hardware.
