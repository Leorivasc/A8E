# AHRM-08 POKEY Diagnostic

`AHRM08_POKEY_TEST.XEX` is a standalone comparison program for jsA8E, native
A8E, Altirra, and real Atari hardware. It does not require an ATR.

## What it measures

- Timer 1, normal clock, `AUDF1=0`.
- Timer 1, fast clock, `AUDF1=0`.
- Timer 1, normal clock, `AUDF1=5`.
- Linked timers 1+2, fast clock, `AUDF1=AUDF2=0`.
- `SEROUT` data-needed and transmission-complete event timing.
- `POTGO` scan duration, final `ALLPOT`, and `POT0`.

The displayed values are polling-loop counts, not CPU-cycle numbers. They are
useful for comparing the same XEX across targets, while the native and JS
cycle probes remain the authoritative internal checks.

The result fields use Atari screen-code hexadecimal digits (`00`-`FF`).
Each scenario re-enters and exits POKEY initialization mode before measuring,
and clears `IRQEN` first so power-up interrupt state does not contaminate the
polling result.

The timer cases clear `IRQEN` again after `STIMER` and then enable only the
source being measured. The serial case uses the AHRM 19.2 kbaud setup:
`AUDCTL=$28`, linked timer 3+4 divisor `$0028`, and `SKCTL=$23`.

## How to use it

1. Load the XEX as a normal executable.
2. Wait until all result fields are populated.
3. Record the displayed values and whether any field remains `00`, `FF`, or
   otherwise appears unchanged.
4. Repeat on jsA8E, native A8E, Altirra, and hardware using the same video
   standard.

The `SEROUT` fields measure POKEY's internal serial event scheduling; no disk
drive is required for those two output events. Input response timing and disk
sector timing still require a mounted ATR/SIO transaction.

## Interpretation

- `T1 FAST AUDF0` should complete substantially sooner than `T1 NORMAL
  AUDF0`.
- `T1 NORMAL AUDF5` should take longer than `T1 NORMAL AUDF0`.
- The linked timer result should be distinct from the independent timer
  results; record the exact value rather than reducing it to PASS/FAIL.
- `POT SCAN ALLPOT FINAL` should finish with `00` on a completed scan. The
  loop count and `POT0 VALUE` are the useful comparison data.
- A high-byte timeout is shown as `FF` in the low-byte result and should be
  reported rather than interpreted as a valid timing result.

This diagnostic cannot characterize DAC volume, clipping, AC coupling, or the
audible bass content. Those require the fixed PAL/NTSC audio captures listed
in `implementation/alignment_23Sept26.md`.

## External baseline recorded 2026-09-25

The first corrected comparison was run in this order: jsA8e, Altirra, and real
hardware.

- `T1 NORMAL AUDF5` displayed `04` on all three targets.
- Altirra and hardware both completed the slow paddle scan with `ALLPOT=00`
  and reported `POT0=E4`; jsA8e displayed `FF/FF` and `POT0=00`, indicating a
  guest-visible scan completion divergence that still needs investigation.
- Altirra and hardware produced closely matching SEROUT observations
  (`02/15` and `03/15`). After the timer-4-derived SIO deadline change,
  jsA8e produced `01/14`; this is now within one polling iteration of the
  external observations, but exact phase alignment remains open.
- The full worker/guest discrepancy was traced to the POKEY construction path:
  `CYCLES_PER_LINE` was not passed into the full audio/POKEY API, leaving the
  slow POT scan step undefined. The standalone POKEY and I/O probes already
  passed because they supplied that configuration explicitly.
- After passing `CYCLES_PER_LINE`, Chrome/jsA8e completed the same XEX with
  `potStepCycles=114`, `ALLPOT=00`, and `POT0=E4` (`228` decimal), matching
  Altirra and hardware.
- The `AUDF=0` timer fields still displayed zero on the boundary cases, so
  those values are not accepted as cycle evidence yet.
