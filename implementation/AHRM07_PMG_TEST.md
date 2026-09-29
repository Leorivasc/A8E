# AHRM-07 GTIA/PMG Visual Test

`AHRM07_PMG_TEST.XEX` is a standalone diagnostic for comparing jsA8E, native
A8E, Altirra, and real Atari hardware. It does not require an ATR or external
files.

## Current Status

The native and JS synthetic PMG/GTIA regressions pass, including hidden-prefix
HPOS replay, live `PMBASE` changes, `PRIOR` transitions, and collision latches.
The AHRM-07 diagnostic is **certified on 2026-09-27** for its stated PMG/GTIA
scope. The two NTSC/128K phases reached `PASS` and matched visually in
Chromium/jsA8E, native A8E, and Altirra. The hardware-TV capture was not of
archival quality, but the observed hardware image matched Altirra in both
phases. This certifies the diagnostic's player DMA, PMBASE, DLI HPOS/PRIOR,
and P0/P1 collision cases; it does not close the separate AtariBlast artifact.

### Headless startup check (2026-09-27)

The checked-in XEX now has a ROM-backed execution regression at
`jsA8E/tests/ahrm07_pmg_boot.test.js`. It launches through HostFS as
`AHRM07_P.XEX` with rendering enabled and checks entry, the main loop, the
display-list/DLI vectors, screen labels, 65 DLI returns with balanced stack,
both 32-frame phase transitions, and the collision latch/result text.
The test passes. A separate uninterrupted run of more than five million
cycles after the first DLI retained the guest loop and displayed labels,
players, and `PASS`. The earlier return to the OS was not reproduced;
its cause remains unknown. No production rendering or POKEY change was made.

Run from the repository root with OS/BASIC ROMs in the root or `A8E/build`:

```sh
node jsA8E/tests/ahrm07_pmg_boot.test.js
```

This uses the normal frame runner and breakpoints with `awaitEntry: false`.
The observed cold boot reached `$2000` at cycle 7,603,998, beyond `runXex`'s
default four-million-cycle entry guard. A preflight or entry-guard outcome
alone therefore cannot establish whether this diagnostic runs correctly.
This does not establish the cause of the earlier Chromium result.

Next compare the same phases in Chromium with its worker enabled, native A8E,
Altirra, and hardware. Headless execution does not replace that visual gate
or the sustained real-content check.

## What it exercises

### NTSC/128K comparison and correction (2026-09-27)

The supplied two-phase captures from Chromium/jsA8E, native A8E, and Altirra
all show collision PASS. jsA8E and native agreed with each other, but the
PRIOR=0 phase lacked Altirra's player/playfield color mixing. Both interleaved
player compositors now implement the AHRM 6.7 mode-0 OR contribution from the
matching playfield group, preserving the AHRM 6.8 high-resolution luminance.
This changes emulated color indices, not the host palette. The XEX is unchanged.

Focused native/JS probes and the headless boot regression pass. The updated
two-phase NTSC/128K visual run confirms the expected color change inside the
playfield in Chromium/jsA8E and native A8E against Altirra; hardware was
visually equivalent to Altirra. This is a correction to the player path, not
certification of every missile/fifth-player or conflicting PRIOR case.

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

The certification captures reached `PASS` in both phases for jsA8E, native
A8E, and Altirra; the hardware observation matched Altirra. Continue to use
this XEX when changing PMG code, and record whether it remains stable over
several minutes of execution.
