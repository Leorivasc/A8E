# Atari Hardware Validation Tests

This document is the operational index for the Atari 800 XL/XE validation
applications currently available in this repository. The programs are intended
to be run with the same `.XEX` on jsA8E, native A8E, Altirra, and real PAL or
NTSC hardware.

The expected output described here is a comparison target. A guest program can
observe registers, latches, and polling boundaries, but it cannot prove every
internal DMA or analogue-audio detail. Unless a section explicitly says
`PASS`, record the observed screen, values, timing, or audio instead of
converting a difference into an automatic failure.

## 1. Common procedure

### 1.1 Recommended environment

- Use the same machine profile on every target: Atari 800 XL/XE, PAL or NTSC,
  and the same memory-expansion profile.
- Disable turbo or acceleration for timing comparisons unless the test
  documentation explicitly says otherwise.
- Run the `.XEX` without an ATR unless the individual test requires a disk.
- Reboot between tests that leave collision latches, memory banks, POKEY state,
  or display registers modified.
- Preserve `FF`, `00`, `WAIT`, and other timeout values. They are evidence, not
  automatically generic failures.

### 1.2 Building and running native automated tests

From the repository root on Windows:

```powershell
cmake --build build\msvc --config Release
ctest --test-dir build\msvc -C Release --output-on-failure
```

The current native CTest set contains probes for Library, ANTIC, POKEY,
keyboard, memory expansion, GTIA/CONSOL, PIA, and differential PIA behavior.
The expected result is that every registered test finishes with exit code 0.
The probes are listed in [Section 11](#11-host-side-automated-coverage).

For the JavaScript assembler/XEX regressions:

```powershell
node jsA8E/tests/ahrm09_11_diagnostics_xex.test.js
```

Expected output:

```text
ahrm09_11_diagnostics_xex: all tests passed.
```

The complete JavaScript automation command is defined as
`jsA8E\package.json` script `test:automation`.

## 2. Memory expansion tests

These applications write expanded memory and are destructive to the tested
banks. Do not run them while useful data is stored in those regions.

### 2.1 `U1MB_MEMORY_TEST.XEX`

Source: [u1mb_memory_test.asm](u1mb_memory_test.asm)

Manual: [memory_tests.md](memory_tests.md)

Coverage:

- Automatic detection of the supported 1088K, 576K, 320K, 256K, 192K, and 128K
  profiles.
- Complete read/write traversal of every detected 16 KiB bank.
- Bank retention, aliasing, motherboard RAM preservation, and the 1088K map.
- BASIC and Self-Test visibility checks where applicable.
- CPU/ANTIC window configuration.
- Visual ANTIC DMA checks using the first and last bank.

Expected output:

```text
RW BANKS PASS
SYS CHECKS PASS
ANTIC CFG PASS
ANTIC GFX PASS
```

For an unsupported or absent expansion, the expected detection result is
`NO EXPANSION`; expansion-specific stages are skipped. During `ANTIC GFX`,
both displayed patterns must be visually correct and the user must press
`START` for both screens. `SELECT` records a visual failure.

### 2.2 `MEMORY_STRESS_TEST.XEX`

Source: [memory_stress_test.asm](memory_stress_test.asm)

Manual: [memory_tests.md](memory_tests.md)

Coverage:

- 32 ascending/descending bank-switching iterations.
- First and last page checks in every bank.
- Motherboard-RAM sentinel preservation.
- Profile-specific `PORTB` mapping and Self-Test overlay behavior.

Expected output:

```text
STRESS PASS
PORTB MAP PASS
```

For `576C`, `320C`, and `128`, the second line is expected to be
`PORTB MAP N/A`. For 1088K RAMBO, `PORTB MAP PASS` is mandatory.

## 3. AHRM-06 ANTIC visual test

Application: [AHRM06_ANTIC_TEST.XEX](AHRM06_ANTIC_TEST.XEX)

Source: [AHRM06_ANTIC_TEST.asm](AHRM06_ANTIC_TEST.asm)

Detailed guide: [AHRM06_ANTIC_TEST.md](AHRM06_ANTIC_TEST.md)

Coverage:

- Normal-width ANTIC mode 2.
- Wide-width ANTIC mode 2 after a DLI changes `DMACTL`.
- ANTIC mode 3 with `VSCROL=4`.
- DLI boundaries, colour bands, screen-memory markers, and looping `JVB`.

Expected screen:

- Three stable labeled sections:
  `AHRM-06 ANTIC MODE 2`, `AHRM-06 ANTIC MODE 2 WIDE`, and
  `AHRM-06 ANTIC MODE 3 + VSCROL`.
- The wide section begins at the wide-playfield horizontal origin.
- The mode-3 partial entry and exit lines are stable and not corrupted.
- The `DLI1` and `DLI2` markers remain visible.
- The sequence repeats continuously without flicker.

There is no software `PASS` line. A missing DLI, incorrect width, or wrong
scroll deadline normally appears as a missing colour band, shifted section, or
corrupted text.

## 4. AHRM-07 GTIA/PMG visual test

Application: [AHRM07_PMG_TEST.XEX](AHRM07_PMG_TEST.XEX)

Source: [AHRM07_PMG_TEST.asm](AHRM07_PMG_TEST.asm)

Detailed guide: [AHRM07_PMG_TEST.md](AHRM07_PMG_TEST.md)

Coverage:

- Player/missile DMA in normal-width playfield mode.
- Live `PMBASE` changes between two graphic patterns.
- DLI-driven `HPOSP0` and `PRIOR` changes.
- Player 0/player 1 collision latches.

Expected output:

```text
P0/P1 COLLISION: PASS
```

The screen must also show two distinct player patterns. The PMG phase changes
every 32 frames and remains stable between changes. The `PASS` text is based on
the real `P0PL` and `P1PL` collision latches, not on a synthetic counter.

This test is certified for its stated scope only. It does not cover every
missile, fifth-player, or conflicting-`PRIOR` case; those are covered by
AHRM-10 below.

## 5. AHRM-08 POKEY and CPU boundary tests

AHRM-08 contains several deliberately narrow diagnostics. Their displayed
values are polling observations, not direct cycle counts.

### 5.1 `AHRM08_POKEY_TEST.XEX`

Source: [AHRM08_POKEY_TEST.asm](AHRM08_POKEY_TEST.asm)

Guide: [AHRM08_POKEY_TEST.md](AHRM08_POKEY_TEST.md)

Coverage:

- Timer 1 normal and fast clocks with `AUDF=0`.
- Timer 1 normal clock with `AUDF=5`.
- Linked timers 1+2.
- `SEROUT` data-needed and transmission-complete events.
- `POTGO`, `ALLPOT`, and `POT0`.

Expected relationships:

- Fast-clock `AUDF=0` completes substantially sooner than normal-clock
  `AUDF=0`.
- Normal-clock `AUDF=5` takes longer than normal-clock `AUDF=0`.
- The linked-timer result is distinct from the independent timer results.
- A completed paddle scan ends with `ALLPOT=00`.
- A timeout is displayed as `FF` and must be recorded.

Known comparison points include `T1 NORMAL AUDF5=04` on the recorded Altirra
and hardware runs, `POT0=E4` after the corrected full-worker path, and close
but not necessarily identical serial polling counts. The `AUDF=0` boundary
fields remain observational and are not accepted as cycle certification.

### 5.2 `AHRM08_POKEY_STAGE2_TEST.XEX`

Source: [AHRM08_POKEY_STAGE2_TEST.asm](AHRM08_POKEY_STAGE2_TEST.asm)

Guide: [AHRM08_POKEY_STAGE2_TEST.md](AHRM08_POKEY_STAGE2_TEST.md)

Coverage:

- Immediate `IRQST` state after `STIMER`.
- First timer-1 IRQ polling result.
- Serial output clock selection for all eight `SKCTL` modes.

Expected common digital behavior from the recorded four-target comparison:

- `STIMER IRQST AFTER` reports `F7`.
- Timer-1 polling reports `03`.
- Modes 0, 1, 3, and 5 remain `FF/00` because no usable output clock/input
  event is present in this diagnostic.
- Timer-4 modes 2 and 4 form a group around `D:32`/`D:33`.
- Timer-2 modes 6 and 7 form a group around `D:4E`/`D:4F`.

The exact `N` polling count may differ at an instruction boundary. The clock
group and timeout behavior are more important than one count.

### 5.3 `AHRM08_POKEY_PHASE_TEST.XEX`

Source: [AHRM08_POKEY_PHASE_TEST.asm](AHRM08_POKEY_PHASE_TEST.asm)

Guide: [AHRM08_POKEY_PHASE_TEST.md](AHRM08_POKEY_PHASE_TEST.md)

Coverage:

- Four controlled delays between `STIMER` and `SEROUT`.
- `DATA NEEDED` polling counts for pads 00, 01, 02, and 04.
- One `TX COMPLETE` count after the baseline event.

Expected output is a complete set of four `NEEDED` values and one completion
value. Compare the shape and relative order across targets. A uniform
one-iteration difference can be a polling-boundary effect; a changed pattern
indicates a phase or scheduling difference. `FF` is a timeout.

This is a digital serial-phase test and does not validate DAC or audible
output.

### 5.4 `AHRM08_POKEY_MATRIX_TEST.XEX`

Source: [AHRM08_POKEY_MATRIX_TEST.asm](AHRM08_POKEY_MATRIX_TEST.asm)

Guide: [AHRM08_POKEY_MATRIX_TEST.md](AHRM08_POKEY_MATRIX_TEST.md)

Coverage:

- Normal padding order `P0/P1/P2/P4`.
- Reverse order `P4/P2/P1/P0`.
- Transmission completion in both orders.

Recorded expected reference:

```text
NORM: P0=00 P1=05 P2=05 P4=04
REV:  P4=04 P2=05 P1=05 P0=00
TX:   NORM=3A REV=3A
```

The `P1=05` jsA8E deviation is currently accepted for this narrow boundary
case. Altirra, native A8E, and hardware reported `P1=00`. Do not add a
padding-specific delay merely to force the values to match.

### 5.5 `AHRM08_POKEY_EDGE_TEST.XEX`

Source: [AHRM08_POKEY_EDGE_TEST.asm](AHRM08_POKEY_EDGE_TEST.asm)

Guide: [AHRM08_POKEY_EDGE_TEST.md](AHRM08_POKEY_EDGE_TEST.md)

Coverage:

- Timer-4 IRQ with `AUDF4=$05`.
- The original `DATA NEEDED` phase with `AUDF4=$01`.
- `TX COMPLETE` after the data-needed event.

Expected interpretation:

- If `T4` differs, inspect timer reload or slow-clock phase.
- If `T4` matches but `DATA` differs, inspect serial divide-by-two phase.
- If both match but completion differs, inspect the ten-bit completion
  deadline or event ordering.

`FF` indicates timeout. ANTIC DMA is disabled during measurement.

### 5.6 `AHRM08_CPU_BOUNDARY_TEST.XEX`

Source: [AHRM08_CPU_BOUNDARY_TEST.asm](AHRM08_CPU_BOUNDARY_TEST.asm)

Guide: [AHRM08_CPU_BOUNDARY_TEST.md](AHRM08_CPU_BOUNDARY_TEST.md)

Coverage:

- One `NOP` after `STIMER`.
- `BIT` zero-page after `STIMER`.
- `BIT` absolute after `STIMER`.
- Two `NOP`s as a control.

Expected recorded output:

- Cases A-D report `00` for the first `DATA NEEDED` poll.
- `TX COMPLETE AFTER N` was `37` on jsA8E, Altirra, and hardware, and `35`
  on native A8E in the recorded comparison.

These values do not justify padding changes. The test is an experiment for a
remaining CPU/POKEY event-boundary difference.

## 6. AHRM-09 GTIA special modes

Application: [AHRM09_GTIA_MODES_TEST.XEX](AHRM09_GTIA_MODES_TEST.XEX)

Source: [AHRM09_GTIA_MODES_TEST.asm](AHRM09_GTIA_MODES_TEST.asm)

Guide: [AHRM09_GTIA_MODES_TEST.md](AHRM09_GTIA_MODES_TEST.md)

Coverage:

- GTIA mode 9: 16 luminances.
- GTIA mode 10: nine-colour mapping and its horizontal delay.
- GTIA mode 11: 16 hues at one luminance.
- ANTIC mode-2 high-resolution input and DLI mode transitions.

Expected screen:

- A deterministic ramp is visible for each mode.
- No text is displayed by design; the complete visible playfield is the test
  pattern.
- Mode 9, mode 10, and mode 11 remain active for 128 frames each, giving a
  human observer enough time to identify the visual differences.
- The background colour changes at each phase, allowing the capture to be
  aligned even when the ramp is difficult to interpret.
- The sequence repeats continuously without corruption or timing drift.

There is no automatic `PASS`. Compare screenshots or video captures, paying
special attention to ramp ordering, mode-10 horizontal alignment, and PAL/NTSC
timing.

Observed result in the current validation run:

- The full playfield remains the same repeated pattern throughout the run.
- No text is shown and no resolution or geometry change is expected.
- The pattern's colours change as a group roughly every three seconds in the
  tested setup, while the spatial pattern remains unchanged.
- This matches the intended three-phase cycle. The exact wall-clock interval
  may vary with PAL/NTSC timing and host presentation; each phase is defined
  by 128 frames.

## 7. AHRM-10 GTIA priority and collision test

Application: [AHRM10_PRIORITY_COLLISION_TEST.XEX](AHRM10_PRIORITY_COLLISION_TEST.XEX)

Source: [AHRM10_PRIORITY_COLLISION_TEST.asm](AHRM10_PRIORITY_COLLISION_TEST.asm)

Guide: [AHRM10_PRIORITY_COLLISION_TEST.md](AHRM10_PRIORITY_COLLISION_TEST.md)

Coverage:

- ANTIC mode 7, equivalent to Atari BASIC `GRAPHICS 2`, with a 20-column
  high-character display.
- `PRIOR=$00,$01,$02,$04,$08` documented priority modes.
- Conflicting values `$03` and `$05`.
- Fifth-player mode `$10`.
- Multiple-colour-player mode `$20`.
- Player and missile collision registers against a PF2 playfield.

Expected screen:

- A red ship, a green target, and a yellow bullet are clearly visible.
- The yellow bullet travels toward the green target and the status changes
  from `COLLISION WAIT` to `COLLISION HIT` when the real `M0PL` latch detects
  the overlap.
- `SCENE PRIORITY` changes every 32 frames through the nine documented and
  edge-case values.
- The bottom of the screen shows live hexadecimal `M0PL`, `P0PL`, and `P1PL`
  values for comparison.
- The bullet restarts and the collision latches are cleared at each scene
  boundary, so the demonstration repeats predictably.

There is no universal expected hexadecimal value for every phase in this
guest-level visual fixture. Compare the movement, hit timing, visible priority
result, and register masks. Conflicting priority cases may legitimately alter
which overlapping object is visible according to AHRM 6.7.

## 8. AHRM-11 POKEY audio capture test

Application: [AHRM11_POKEY_AUDIO_TEST.XEX](AHRM11_POKEY_AUDIO_TEST.XEX)

Source: [AHRM11_POKEY_AUDIO_TEST.asm](AHRM11_POKEY_AUDIO_TEST.asm)

Guide: [AHRM11_POKEY_AUDIO_TEST.md](AHRM11_POKEY_AUDIO_TEST.md)

The six phases last 64 frames each and are shown on screen:

| Phase | Signal |
|---:|---|
| 0 | Channel 1 square wave |
| 1 | Channel 1 poly-4 noise |
| 2 | Channel 1 poly-9 noise |
| 3 | Linked fast-clock timers 1+2 |
| 4 | Volume-only output |
| 5 | Channel 1 with channel-3 high-pass source |

Expected output:

- The six phases occur in order and repeat.
- The phase number is visible at screen offset 96 for audio/video alignment.
- Square and linked phases have stable measurable fundamentals.
- Noise phases have repeatable spectra for a fixed PAL/NTSC configuration.
- Volume-only output has a stable DC/amplitude signature.
- The high-pass phase has a distinct spectrum and transient response.

There is no guest-side `PASS`. Capture WAV files with the same sample rate,
without automatic normalisation or noise reduction, and compare frequency,
spectrum, amplitude, phase duration, and PAL/NTSC differences.

## 9. AHRM-12 ANTIC display-list and scrolling test

Application: [AHRM12_ANTIC_DISPLAYLIST_TEST.XEX](AHRM12_ANTIC_DISPLAYLIST_TEST.XEX)

Source: [AHRM12_ANTIC_DISPLAYLIST_TEST.asm](AHRM12_ANTIC_DISPLAYLIST_TEST.asm)

Guide: [AHRM12_ANTIC_DISPLAYLIST_TEST.md](AHRM12_ANTIC_DISPLAYLIST_TEST.md)

Coverage:

- LMS, DLI, and looping JVB display-list instructions.
- Normal ANTIC mode 2.
- `HSCROL` values 0, 4, 8, and 12.
- Mode-3 `VSCROL=4` section.
- Scroll-register changes at display-list section boundaries.

Expected screen:

- Three stable sections labeled `AHRM12 ANTIC LMS JVB`, `HSCROL 0 4 8 C`,
  and `VSCROL 4`.
- The horizontal pattern moves through four visible positions, remaining at
  each value for 16 frames.
- The mode-3 partial lines remain stable.
- The complete sequence repeats through `JVB` without corruption.

This is observational. It complements AHRM-06; internal 1 KiB display-list
wrap and exact DMA deadlines remain covered by host-side timing probes.

## 10. AHRM-13 ANTIC character-set test

Application: [AHRM13_ANTIC_CHARSET_TEST.XEX](AHRM13_ANTIC_CHARSET_TEST.XEX)

Source: [AHRM13_ANTIC_CHARSET_TEST.asm](AHRM13_ANTIC_CHARSET_TEST.asm)

Guide: [AHRM13_ANTIC_CHARSET_TEST.md](AHRM13_ANTIC_CHARSET_TEST.md)

Coverage:

- OS character set selected with `CHBASE=$E0`.
- Custom 1 KiB character set selected with `CHBASE=$50`.
- Character-name bit 7.
- `CHACTL` inversion and vertical reflection.
- DLI transitions between the three character-set configurations.

Expected screen:

- The first section shows readable `AHRM13 OS FONT CHBASE` text.
- The second section shows 16 distinct custom geometric patterns.
- The third section shows the same patterns vertically reflected and inverted.
- All sections remain stable and repeat through `JVB`.

There is no automatic `PASS`. Compare the custom patterns and make sure no
section retains the preceding `CHBASE` or `CHACTL` state.

## 11. AHRM-14 PMG DMA edge test

Application: [AHRM14_PMG_DMA_EDGE_TEST.XEX](AHRM14_PMG_DMA_EDGE_TEST.XEX)

Source: [AHRM14_PMG_DMA_EDGE_TEST.asm](AHRM14_PMG_DMA_EDGE_TEST.asm)

Guide: [AHRM14_PMG_DMA_EDGE_TEST.md](AHRM14_PMG_DMA_EDGE_TEST.md)

Coverage:

- Two-line PMG resolution with `PMBASE=$40`.
- One-line resolution with `PMBASE=$80`.
- `VDELAY=$0F` and live player-position changes.
- PMBASE changes between distinct player and missile patterns.

Expected screen:

- Four stable phases, each lasting 32 frames.
- Different player height/shape between one-line and two-line phases.
- A visible change during the VDELAY phase.
- No stale PMBASE data, missing players, or phase flicker.

This is observational and complements AHRM-07. Exact DMA lead-time and
cycle-slot behavior remains a host-side timing concern.

## 12. AHRM-15 CPU DMA contention test

Application: [AHRM15_CPU_DMA_CONTENTION_TEST.XEX](AHRM15_CPU_DMA_CONTENTION_TEST.XEX)

Source: [AHRM15_CPU_DMA_CONTENTION_TEST.asm](AHRM15_CPU_DMA_CONTENTION_TEST.asm)

Guide: [AHRM15_CPU_DMA_CONTENTION_TEST.md](AHRM15_CPU_DMA_CONTENTION_TEST.md)

Coverage:

- Display-list DMA only: `DMACTL=$20`.
- Normal playfield: `$22`.
- Normal playfield plus two-line PMG: `$2E`.
- Normal playfield plus one-line PMG: `$3E`.
- Wide playfield plus one-line PMG: `$2F`.

Expected output is one hexadecimal iteration count per configuration. The
usual relationship is:

```text
$20 > $22 > $2E/$3E/$2F
```

The exact values vary with PAL/NTSC and polling boundaries. The program
restores `$22` before showing the final results and does not print `PASS`.

## 13. AHRM-16 PIA and CONSOL input test

Application: [AHRM16_PIA_CONSOL_INPUT_TEST.XEX](AHRM16_PIA_CONSOL_INPUT_TEST.XEX)

Source: [AHRM16_PIA_CONSOL_INPUT_TEST.asm](AHRM16_PIA_CONSOL_INPUT_TEST.asm)

Guide: [AHRM16_PIA_CONSOL_INPUT_TEST.md](AHRM16_PIA_CONSOL_INPUT_TEST.md)

Coverage:

- `PORTA`, `PORTB`, `PACTL`, and `PBCTL`.
- GTIA `CONSOL` keys `START`, `SELECT`, and `OPTION`.
- `TRIG0` through `TRIG3` joystick buttons.
- Live active-low joystick/input changes.

Expected output is a continuously updated hexadecimal table. With no active
input, `CONSOL=07` and triggers commonly read `01`. Pressing a console key
clears its active-low bit; pressing a joystick button normally changes its
trigger from `01` to `00`. Direction changes appear in the active-low `PORTA`
bits. Unused/floating XL/XE PIA bits are hardware-dependent.

## 14. AHRM-17 PAL/NTSC video timing test

Application: [AHRM17_VIDEO_TIMING_TEST.XEX](AHRM17_VIDEO_TIMING_TEST.XEX)

Source: [AHRM17_VIDEO_TIMING_TEST.asm](AHRM17_VIDEO_TIMING_TEST.asm)

Guide: [AHRM17_VIDEO_TIMING_TEST.md](AHRM17_VIDEO_TIMING_TEST.md)

Coverage:

- Continuous `VCOUNT` sampling.
- Four complete frames counted by DLI.
- PAL/NTSC frame-height distinction.

Expected output:

| Machine | `VCOUNT MIN` | `VCOUNT MAX` | `FRAMES` |
|---|---:|---:|---:|
| NTSC | `$00` | approximately `$82` | `$04` |
| PAL | `$00` | approximately `$9B` | `$04` |

The rare end-of-frame sample may show `$83` on NTSC or `$9C` on PAL. Record
that result as timing evidence rather than an automatic failure.

## 15. AHRM-18 POKEY RANDOM and timer test

Application: [AHRM18_POKEY_RANDOM_TIMER_TEST.XEX](AHRM18_POKEY_RANDOM_TIMER_TEST.XEX)

Source: [AHRM18_POKEY_RANDOM_TIMER_TEST.asm](AHRM18_POKEY_RANDOM_TIMER_TEST.asm)

Guide: [AHRM18_POKEY_RANDOM_TIMER_TEST.md](AHRM18_POKEY_RANDOM_TIMER_TEST.md)

Coverage:

- POKEY initialization and deterministic `RANDOM` sampling.
- Eight fixed scan-line-separated random values.
- Timer 1 IRQ polling with `AUDF1=$05`.

Expected output is an eight-byte hexadecimal sequence and a nonzero timer
polling value. The AHRM sample sequence begins `00 DF EE 16 B9` for a specific
short-generator phase, but the complete sequence must be recorded for each
target and video standard. The recorded jsA8E smoke run produced a sequence of
`7C 8F 3D 60 21 8F DC 3B` and timer count `04`; this is a reference capture,
not a universal PASS value.

## 16. Test coverage matrix

| Area | Guest application(s) | Expected evidence |
|---|---|---|
| Expanded memory | `U1MB_MEMORY_TEST`, `MEMORY_STRESS_TEST` | Explicit `PASS` lines and visual DMA confirmation |
| ANTIC display lists | `AHRM06_ANTIC_TEST` | Stable labeled sections, DLI bands, VSCROL behavior |
| ANTIC display-list/scroll extensions | `AHRM12_ANTIC_DISPLAYLIST_TEST` | LMS/JVB sequence and four HSCROL phases |
| ANTIC character modes | `AHRM13_ANTIC_CHARSET_TEST` | OS/custom/reflected character patterns |
| PMG DMA/basic collision | `AHRM07_PMG_TEST` | Player patterns and `P0/P1 COLLISION: PASS` |
| PMG DMA edge behavior | `AHRM14_PMG_DMA_EDGE_TEST` | Four resolution/PMBASE/VDELAY phases |
| GTIA modes | `AHRM09_GTIA_MODES_TEST` | Three stable ramp phases |
| GTIA priority/collisions | `AHRM10_PRIORITY_COLLISION_TEST` | Moving bullet/target scene, hit status, priority changes, and live collision masks |
| POKEY digital timing | AHRM-08 suite | Polling values and clock-group relationships |
| POKEY RANDOM/timers | `AHRM18_POKEY_RANDOM_TIMER_TEST` | Eight-byte sequence and timer observation |
| POKEY analogue output | `AHRM11_POKEY_AUDIO_TEST` | WAV/video capture comparison |
| CPU/POKEY boundary | `AHRM08_CPU_BOUNDARY_TEST` | Four boundary observations |
| CPU DMA contention | `AHRM15_CPU_DMA_CONTENTION_TEST` | Relative loop-count ordering |
| PIA/console input | `AHRM16_PIA_CONSOL_INPUT_TEST` | Live active-low input changes |
| PAL/NTSC video timing | `AHRM17_VIDEO_TIMING_TEST` | VCOUNT range and four-frame count |

## 17. Recommended execution order

For a general emulator change, run:

1. `AHRM06_ANTIC_TEST.XEX`
2. `AHRM12_ANTIC_DISPLAYLIST_TEST.XEX`
3. `AHRM13_ANTIC_CHARSET_TEST.XEX`
4. `AHRM14_PMG_DMA_EDGE_TEST.XEX`
5. `AHRM07_PMG_TEST.XEX`
6. `AHRM09_GTIA_MODES_TEST.XEX`
7. `AHRM10_PRIORITY_COLLISION_TEST.XEX`
8. `AHRM15_CPU_DMA_CONTENTION_TEST.XEX`
9. `AHRM16_PIA_CONSOL_INPUT_TEST.XEX`
10. `AHRM17_VIDEO_TIMING_TEST.XEX`
11. `AHRM08_POKEY_TEST.XEX`
12. `AHRM08_POKEY_STAGE2_TEST.XEX`
13. `AHRM18_POKEY_RANDOM_TIMER_TEST.XEX`
14. `AHRM11_POKEY_AUDIO_TEST.XEX`

For an expanded-memory change, run both memory tests first, then repeat the
ANTIC and PMG tests with the selected memory profile.

For a POKEY or SIO timing change, run the complete AHRM-08 sequence:

1. `AHRM08_POKEY_TEST.XEX`
2. `AHRM08_POKEY_STAGE2_TEST.XEX`
3. `AHRM08_POKEY_PHASE_TEST.XEX`
4. `AHRM08_POKEY_MATRIX_TEST.XEX`
5. `AHRM08_POKEY_EDGE_TEST.XEX`
6. `AHRM08_CPU_BOUNDARY_TEST.XEX`
7. `AHRM11_POKEY_AUDIO_TEST.XEX`

Record the target, PAL/NTSC mode, memory profile, emulator version or hardware
serial, complete screen, and any captured audio/video for every run.

## 18. Host-side automated coverage

The native CTest list currently contains:

- `library_archive_probe`
- `library_package_probe`
- `library_repository_probe`
- `library_image_probe`
- `antic_timing_probe`
- `antic_dma_probe`
- `antic_graphics_modes_probe`
- `pokey_pot_scan_probe`
- `pokey_timer_period_probe`
- `pokey_linked_audio_probe`
- `pokey_sio_contract_probe`
- `keyboard_irq_gate_probe`
- `memory_expansion_probe`
- `gtia_consol_probe`
- `pia_control_probe`
- `differential_pia_trace_probe`

The JavaScript suite additionally covers assembler reproducibility, ANTIC
display-list and scroll timing, playfield/charset rendering, PMG/GTIA DMA and
priority behavior, POKEY timers/SIO/POT, CPU interrupt behavior, PIA/keyboard,
memory preflight, snapshots, and the AHRM guest XEX tests.

Run the complete JavaScript suite from `jsA8E` with:

```powershell
npm.cmd run test:automation
```

Expected result: every command in the chain exits successfully. Individual
tests print their own `all tests passed` message or fail with an assertion that
identifies the contract under test.

Current native CTest baseline observed while adding AHRM-14 through AHRM-18:
14 of 16 probes pass. The two remaining failures are:

- `antic_graphics_modes_probe`: `TestPmgModeZeroPlayfieldMix` reports that
  mode-0 PF2/player colour mixing is not yet matching its contract.
- `pokey_sio_contract_probe`: `RunStatusLatchContract` reports that the
  initial status is missing `ACK`.

These failures are in existing native contracts and are unrelated to the new
guest diagnostic applications. They should be resolved before claiming a
fully green native validation run.

## 19. Scope and future additions

This document is intentionally cumulative. Every new validation application
must add a chapter containing:

1. the `.XEX`, source, and guide links;
2. hardware/emulator behavior covered;
3. exact on-screen or audio output expected;
4. whether the result is `PASS/FAIL` or observational;
5. PAL/NTSC and memory-profile requirements;
6. any known deviations and their interpretation.

The core proposed diagnostic set is now present. Optional future extensions
are a larger fifth-player/missile collision matrix, 1 KiB display-list wrap
fixtures, and external composite-video capture automation.
