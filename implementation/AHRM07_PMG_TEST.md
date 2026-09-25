# AHRM-07 GTIA/PMG Visual Test

`AHRM07_PMG_TEST.XEX` is a standalone diagnostic for comparing jsA8E, native
A8E, Altirra, and real Atari hardware. It does not require an ATR or external
files.

## What it exercises

- Player/missile DMA in normal-width playfield mode.
- Live `PMBASE` changes between two distinct player graphic patterns.
- DLI-driven `HPOSP0` and `PRIOR` changes.
- GTIA player-to-player collision latches (`P0PL` and `P1PL`).

The display should show two differently shaped player patterns at the right
side of the screen. Each PMBASE/HPOS/PRIOR phase remains visible for 32 frames,
then changes once; this makes the transition deliberate rather than a rapid
flicker. The on-screen notes identify the bars as player DMA and explain the
32-frame phase change. The status line should eventually change from
`P0/P1 COLLISION: WAIT` to `P0/P1 COLLISION: PASS`; the line below clarifies
that `PASS` comes from the real GTIA collision latches.

## How to run

Load `AHRM07_PMG_TEST.XEX` as a normal XEX application. Let it run for several
seconds, then compare:

1. The `P0/P1 COLLISION: PASS` result.
2. The visible player shapes while `PMBASE` alternates.
3. The position/priority changes caused by the DLI.
4. Stability over time, without flicker, missing players, or stale collision
   status.

The diagnostic reads the real GTIA collision registers; it does not print a
synthetic pass result. A missing or incomplete PMG implementation should
normally leave the status at `WAIT`, or produce visibly different player
patterns.

## Interpretation and limits

This XEX is an external visual and functional check. It complements, but does
not replace, the native and JS cycle probes. A guest program cannot directly
prove every internal PM DMA boundary or hidden-prefix event. Those details
remain covered by:

- `A8E/tests/antic_graphics_modes_probe.c`
- `jsA8E/tests/gtia_pmg_dma_regression.test.js`

For AHRM-07 validation, record the result for jsA8E, native A8E, Altirra, and
hardware, including whether the status reaches `PASS` and whether the PMG
patterns remain stable during several minutes of execution.
