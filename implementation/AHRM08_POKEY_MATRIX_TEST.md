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
REV:  P4=04 P2=00 P1=05 P0=00
TX:   NORM=3A REV=3A
```

Altirra and hardware place `P1` at `00` in both passes; the other matrix
fields and transmission completion agree. `P1=05` means that jsA8E exposes
the serial `DATA NEEDED` state one output-clock period later in this narrow
STIMER-to-SEROUT boundary case.

The deviation is accepted for the current AHRM-08 scope because normal SIO,
audio, and the Stage 2 guest-level serial behavior remain validated. It can
affect only software that polls `IRQST` or rewrites `SEROUT` at this exact
phase boundary. Do not tune a padding-specific delay to make this screen
match. Reopen the issue only with a model of the arbitration between the
64 kHz slow-clock tick and the queued STIMER timer reload, validated against
the complete normal/reverse matrix and transmission values.
