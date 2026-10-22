# AHRM-17 PAL/NTSC Video Timing Test

`AHRM17_VIDEO_TIMING_TEST.XEX` samples `VCOUNT` continuously while a DLI
counts four complete frames. It then displays the current value, the observed
minimum, the observed maximum, and the frame count.

## Expected output

For a normal capture:

| Machine | Expected `VCOUNT MAX` | Frame lines |
|---|---:|---:|
| NTSC | approximately `$82` | 262 |
| PAL | approximately `$9B` | 312 |

`VCOUNT MIN` should normally be `$00`, and `FRAMES` should be `$04`. The
one-cycle end-of-frame anomaly can expose `$83` on NTSC or `$9C` on PAL in a
precise boundary capture; record it rather than treating it as an emulator
failure.

Compare the values and the four-frame cadence on jsA8E, native A8E, Altirra,
and hardware. This test observes digital timing; it does not replace an
external video-frequency or composite-sync capture.
