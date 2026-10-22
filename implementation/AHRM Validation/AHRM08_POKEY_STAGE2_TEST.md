# AHRM-08 Stage 2 POKEY Diagnostic

`AHRM08_POKEY_STAGE2_TEST.XEX` is a standalone comparison program for
jsA8E, native A8E, Altirra, and real Atari hardware. It does not require an
ATR or a disk drive.

## What it measures

- `STIMER` followed immediately by an `IRQST` read.
- The first timer-1 IRQ polling count after `STIMER`.
- `SEROUT` data-needed (`IRQST` bit 4) and transmission-complete (`IRQST`
  bit 3) observations for every `SKCTL` clock mode.

The screen has one row per mode:

- Modes 0-1: external output clock.
- Modes 2 and 4: timer 4 output clock.
- Modes 3 and 5: asynchronous input; timers 3+4 remain held until a start
  bit, so this no-input diagnostic does not create an output deadline.
- Modes 6-7: timer 2 output clock; mode 7 additionally uses asynchronous input.

The test configures `AUDCTL=00`, `AUDF4=01`, and `AUDF2=02`, so the internal
timer periods are 56 and 84 CPU cycles respectively. The values shown are
polling-loop counts, not direct CPU-cycle measurements. `FF` means the polling
timeout expired.

## How to use it

1. Load `AHRM08_POKEY_STAGE2_TEST.XEX` as a normal executable.
2. Wait until all eight mode rows and the two STIMER rows are populated.
3. Record the complete screen in this order: jsA8E, native A8E, Altirra, and
   hardware, using the same PAL/NTSC standard.
4. Preserve `FF` values. They are useful evidence for external-clock behavior
   and must not be converted into a generic failure.

The diagnostic intentionally uses polling and a bounded timeout. ANTIC DMA is
disabled while the measurements run, so the polling counts are not mixed with
playfield CPU steals. DMA is restored before the final screen is shown. The
test still does not claim to observe the exact internal half-bit clock phase;
the external screen comparison is used to identify which phase boundary still
needs a cycle trace.

The previous DMA-enabled run showed `STIMER=F7` and correct mode grouping in
both cores, but its cross-platform N/D counts were not suitable for exact
timing certification because ANTIC contention was part of the measurement.
Those results remain useful as a separate contention observation; they should
not be compared with the DMA-isolated run below.

The DMA-isolated four-target run then produced the expected common behavior:

- All targets reported `F7` after `STIMER` and `03` for the timer-1 poll.
- Modes 0, 1, 3, and 5 remained `FF/00`.
- Timer-4 modes completed around `D:32`/`D:33`.
- Timer-2 modes completed around `D:4E`/`D:4F`.
- `N` varied between targets because the polling loop observes the first
  active status at a phase-dependent instruction boundary; this does not
  change the selected clock source or completion group.

This certifies the Stage 2 guest-level digital behavior across jsA8E, A8E,
Altirra, and hardware. It does not certify the separate POKEY DAC/audio
calibration work tracked by AHRM-08.

## Interpretation

- Modes 2 and 4 should form one timing group based on timer 4.
- Modes 6 and 7 should form a separate timing group based on timer 2.
- Modes 0 and 1 use the external clock path; without an external clock, the
  serial events remain pending and `XMTDONE` is inactive.
- Modes 3 and 5 use asynchronous input and likewise do not produce synthetic
  output events before a start bit. Mode 7 keeps its timer-2 output clock even
  though its input side is asynchronous.
- The `STIMER IRQST AFTER` byte records status immediately after the write;
  `T1 IRQ POLL LOOPS` records the later timer interrupt observation.

This diagnostic does not characterize DAC volume, clipping, AC coupling, or
audible bass content. Those still require the fixed PAL/NTSC audio captures
listed in `implementation/alignment_23Sept26.md`.
