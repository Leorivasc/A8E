# AHRM-10 GTIA Priority and Collision Test

`AHRM10_PRIORITY_COLLISION_TEST.XEX` presents the GTIA priority and collision
test as a small, readable space scene instead of a dense register display.

The screen contains:

- a red ship on the left;
- a green target on the right;
- a yellow bullet travelling toward the target;
- a few additional coloured PMG markers;
- a `COLLISION WAIT` / `COLLISION HIT` status line.

The arena uses high-contrast text on a black ANTIC mode-7 background. This is
the Atari BASIC `GRAPHICS 2` text mode: 20 columns with tall character rows.
The PMG figures are placed below the instructions so that the scene remains
readable.

The bullet restarts from the ship side after reaching the target. When it
overlaps the green target, the status changes to `COLLISION HIT`. That message
is driven by the real GTIA `M0PL` collision latch, not by a guessed timer.

## What changes during the run

Every 32 frames, the program selects the next `PRIOR` value from this
sequence:

```text
$00, $01, $02, $04, $08, $03, $05, $10, $20
```

The current value appears next to `SCENE PRIORITY`. At each scene boundary the
collision latches are cleared and the bullet is restarted, so the visual
experiment repeats in a predictable way. The three raw diagnostic values
`M0PL`, `P0PL`, and `P1PL` remain visible at the bottom for comparison with
Altirra or hardware captures.

## What a human should observe

1. The yellow bullet moves across the playfield toward the green target.
2. The status changes from `COLLISION WAIT` to `COLLISION HIT` when the bullet
   reaches the target.
3. The scene priority value changes every 32 frames.
4. The same movement repeats for all nine priority settings.
5. The objects remain stable, without a full-screen flicker or a distorted
   display list.

Some priority values can alter which overlapping colour is most visible. The
important comparison is the position and timing of the objects, the target
hit, the status change, and the corresponding latch values—not whether every
priority scene looks dramatically different.

## AHRM scope and limits

This diagnostic exercises the GTIA priority path and the player/missile
collision latches described by AHRM 6.7. The missile section uses the AHRM
one-line PMG layout, with solid bars for the moving projectile and targets;
`M0PL`–`M3PL` are read from their documented GTIA
addresses. The test does not certify every DMA timing edge or every possible
priority/collision combination; those remain covered by the focused native,
JavaScript, and AHRM-07 diagnostics.

Load the XEX without an ATR. Compare the complete scene on jsA8E, native A8E,
Altirra, and real PAL/NTSC hardware.
