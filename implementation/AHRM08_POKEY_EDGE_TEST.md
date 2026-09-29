# AHRM-08 POKEY Edge Diagnostic

`AHRM08_POKEY_EDGE_TEST.XEX` separates the timer-4 phase from the serial
divide-by-two phase using independent runs and the same four paddings as the
Stage 3 phase diagnostic.

## Screen fields

- `T4`: polling count until the first timer-4 IRQ (`IRQST` bit `$04`), using
  `AUDF4=$05` and a 168-cycle timer period.
- `DATA`: polling count until `DATA NEEDED` (`IRQST` bit `$10`).
- `DATA` uses the original `AUDF4=$01` phase-test setup and its original
  single-event polling loop.
- `TX COMPLETE`: polling count until the serial output completes after
  `DATA NEEDED`; this run is performed before the P0-P3 measurements.

All values are polling-loop observations, not direct CPU-cycle measurements.
`FF` indicates a timeout.

## Interpretation

- If `T4` differs from Altirra, the timer reload or slow-clock phase is wrong.
- If `T4` matches but `DATA` differs, the serial divide-by-two phase or the
  selected rising edge is wrong.
- If both match but `TX COMPLETE` differs, the ten-bit completion deadline or
  event ordering is wrong.

ANTIC DMA is disabled during measurements. Compare this XEX on jsA8e, A8E,
and Altirra. Hardware is expected to follow Altirra for this digital test;
the existing `AHRM08_POKEY_PHASE_TEST.XEX` remains the final certification
fixture after the tuning change.
