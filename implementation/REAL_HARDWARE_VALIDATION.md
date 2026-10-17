# Real Hardware Validation Project

Status: planned; validation work has not started.

Created: 2026-10-16

This is a separate follow-up project for validating the A8E native and jsA8E
implementations against real Atari 800 XL hardware. It is intentionally
separate from the implementation merge: the current code may be described as
AHRM-aligned and contract-tested, but it must not be described as fully
hardware-certified until this project is completed for its stated scope.

## Objective

Measure the same diagnostics and representative software on real hardware and
in both emulator cores, then record reproducible differences against the AHRM
model. Use the AHRM as the primary technical reference and Altirra or another
independent emulator as a secondary comparison, never as a replacement for
hardware measurements.

## Validation tracks

### POKEY and SIO

- `SEROUT` holding/shift-register timing and ten-bit frame boundaries;
- `DATA NEEDED`, `TRANSMISSION DONE`, `SERIN DATA READY`, and IRQ ordering;
- Timer 4 serial divisors, US Doubler/high-speed response timing, and the
  accepted jsA8E P1 CPU/POKEY phase deviation;
- SIO command/response phases, checksums, `ACK`/`COMPLETE`/`NAK`, `STATUS`,
  `FORMAT`, `WRITE` verification, and 128/256/512-byte media;
- digital timer/SIO behavior versus analog POKEY output and recordings.

Existing starting fixtures include:

- `implementation/AHRM08_POKEY_TEST.md` and its `.asm` diagnostic;
- `implementation/AHRM08_POKEY_EDGE_TEST.md`;
- `implementation/AHRM08_POKEY_PHASE_TEST.md`;
- `implementation/AHRM08_POKEY_MATRIX_TEST.md`;
- `implementation/AHRM08_CPU_BOUNDARY_TEST.md`.

### ANTIC and GTIA

- 114-cycle scanlines and PAL/NTSC frame timing;
- DMA steal positions, playfield fetch windows, HSCROL, VSCROL, CHBASE,
  DLI/VBI, WSYNC, and PMBASE changes;
- player/missile DMA, GTIA Mode 10 priority and collision behavior;
- raster-effect and mid-scanline register-write behavior.

The current synthetic AHRM-07 PMG/GTIA diagnostic is certified only for its
documented scope. The broader raster sweep remains open and is tracked in
[`legacy/COLOR_CLOCK_ACCURACY.md`](../legacy/COLOR_CLOCK_ACCURACY.md).

### Real software and media

Run a curated set of ATR/XEX titles on PAL and NTSC hardware, native A8E, and
jsA8E. Prioritize software that exercises raster effects, SIO retries,
high-speed disk access, PMG collisions, audio, and mid-line register writes.
Record the exact image, ROM, machine profile, video standard, and emulator
commit for every result.

## Required setup to confirm when resuming

- Atari 800 XL hardware and region (PAL, NTSC, or both);
- known OS/BASIC ROM dumps and the exact machine revision;
- a repeatable way to load the diagnostic XEX files and ATR images;
- serial/SIO capture or timing instrumentation for digital measurements;
- audio capture equipment and a fixed recording path for analog POKEY work;
- screen/beam capture or a repeatable frame-comparison method;
- the reference Altirra configuration, when used for a secondary comparison.

If any item is unavailable, record the limitation rather than treating an
emulator-to-emulator match as hardware validation.

## Procedure

1. Freeze the tested A8E commit and record native/browser build details.
2. Run each diagnostic unchanged on the real machine, native A8E, and jsA8E.
3. Capture bytes, cycle/edge timing, IRQ observations, audio, and frame output
   using the appropriate instrument for the validation track.
4. Compare results against the AHRM timing rule and the shared regression
   contract.
5. Classify every difference as an implementation defect, fixture/instrument
   issue, documented hardware variance, or accepted emulator limitation.
6. Convert confirmed regressions into a native and JavaScript test before
   changing production timing code.
7. Update this document with evidence, affected commits, and signoff status.

## Evidence and signoff requirements

Each completed item must record:

- hardware model, region, ROM revision, and capture setup;
- diagnostic source/XEX or software title and media image hash;
- native/jsA8E commit IDs and machine profiles;
- raw capture location or reproducible observation;
- expected AHRM behavior, measured hardware behavior, and emulator results;
- the decision: pass, implementation fix required, accepted deviation, or
  unable to measure.

The project is complete only when the selected PAL/NTSC, POKEY/SIO, ANTIC/GTIA,
and real-software scopes have explicit evidence or an explicitly documented
accepted limitation. Until then, retain the wording “AHRM-aligned and
contract-tested” in public documentation.

## Related documentation

- [AHRM index](../AHRM/index.md)
- [Color-clock accuracy scope](../legacy/COLOR_CLOCK_ACCURACY.md)
- [POKEY implementation notes](A8E/POKEY.md)
- [AHRM-08 alignment plan](alignment_23Sept26.md)
- [Implementation notes and session history](NOTES.md)
