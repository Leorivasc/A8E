# AHRM-08 POKEY Phase Matrix Diagnostic

`AHRM08_POKEY_MATRIX_TEST.XEX` repeats the same `STIMER` to `SEROUT` phase
measurement in two orders. Every case enters and exits POKEY initialization
before configuring `AUDF4=$01`, `AUDCTL=$00`, and `SKCTL=$23`.

## Screen fields

- `NORM P0/P1/P2/P4`: `DATA NEEDED` polling counts in padding order 0, 1, 2,
  and 4 loop steps.
- `REV P4/P2/P1/P0`: the same measurements in reverse order.
- `TX NORM/REV`: ten-bit completion polling counts after the zero-padding
  baseline for each pass.

The counts are observations of the guest polling loop, not direct CPU-cycle
measurements. `PAD` values are loop steps; they are intentionally not labeled
as cycle counts.

## Interpretation

- If a padding changes between normal and reverse order, inspect state that
  survives `STIMER` or POKEY initialization before changing timer periods.
- If normal and reverse results match but differ from Altirra, compare the
  first timer edge, the `SEROUT` write edge, and the selected rising edge.
- If the internal edges match but counts differ, the remaining difference is
  likely IRQ assertion or polling-boundary timing.

Run the matrix on jsA8e, native A8E, and Altirra. Hardware is optional for
this phase because Altirra is the aligned digital reference.

## Accepted P1 Deviation

As of 2026-09-26, this fixture is a diagnostic rather than an AHRM-08
certification gate. The stable jsA8E result, in screen order, is:

```
NORM: P0=00 P1=05 P2=05 P4=04
REV:  P4=04 P2=05 P1=05 P0=00
TX:   NORM=3A REV=3A
```

Altirra and hardware place `P1` at `00` in both passes; the other matrix
fields and transmission completion agree. `P1=05` means that jsA8E exposes
the serial `DATA NEEDED` state one output-clock period later in this narrow
STIMER-to-SEROUT boundary case.

The deviation is accepted for the current AHRM-08 scope because normal SIO,
audio, and the Stage 2 guest-level serial behavior remain validated. It can
affect only software that polls `IRQST` or rewrites `SEROUT` at this exact
phase boundary. The current direct comparison shows that jsA8E enters P1
with the serial divide-by-two phase high, so `DATA NEEDED` waits one complete
output-clock period; native A8E, Altirra, and hardware enter P1 low. Do not
tune a padding-specific delay to make this screen match. Reopen the issue
only with a model of CPU bus timing and the AHRM initialization/STIMER
arbitration, validated against the complete normal/reverse matrix and
transmission values.

## Direct Trace Finding

The current native trace uses a 56-cycle timer period. For P1, the serial
clock phase is low and `DATA NEEDED` is scheduled on the next timer edge. For
P2/P4, the phase is high and the next usable rising edge is one additional
half-bit period later. jsA8E produces the latter phase for P1, which explains
the extra `05` polling count. The ten-bit completion interval remains
consistent at `20 * 56` cycles after the selected load edge. This localizes
the remaining issue to phase initialization/arbitration at the CPU timed-event
boundary; it does not justify changing the timer period or adding a padding
delay.

The opt-in trace records `pc` and `opcode` for these events in both cores.
Native A8E requires a `VERBOSE_SIO` build; jsA8E requires
`?a8e_pokey_trace=1`. These fields identify the CPU instruction context at
the event boundary and are intended to diagnose the remaining one-cycle P1
difference without changing the matrix fixture.
