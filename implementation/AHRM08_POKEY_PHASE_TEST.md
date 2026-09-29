# AHRM-08 Stage 3 POKEY Phase Diagnostic

`AHRM08_POKEY_PHASE_TEST.XEX` isolates the phase relationship between
`STIMER` and `SEROUT` for jsA8E, native A8E, Altirra, and real hardware.

## What it measures

- Four `DATA NEEDED` polling counts after controlled delays between `STIMER`
  and `SEROUT`.
- One `TX COMPLETE` polling count after the zero-delay baseline reaches
  `DATA NEEDED`.

The test uses timer-4 serial output mode (`SKCTL=$23`, `AUDF4=$01`) and
enables the serial IRQ sources before `STIMER`, then disables ANTIC DMA during
measurements. `PAD 00`, `PAD 01`, `PAD 02`, and
`PAD 04` are deterministic delay-loop steps, not direct CPU-cycle values.
The displayed counts are observations, not CPU-cycle measurements.

## How to use it

1. Load `AHRM08_POKEY_PHASE_TEST.XEX` as a normal executable.
2. Wait until all four `NEEDED` values and `TX COMPLETE AFTER N` are populated.
3. Record the complete screen in this order: jsA8E, native A8E, Altirra, and
   hardware, using the same PAL/NTSC standard.
4. Preserve `FF` values as timeouts.

The useful comparison is the shape of the four padding results and the
relative `TX COMPLETE AFTER N` value. The complete counter starts only after
the output byte has loaded into the shift register, so it measures the frame
interval rather than the initial holding-register delay. A one-iteration
difference in all rows is consistent with a polling-boundary offset; a change
in the pattern or in the clock group indicates a real phase/scheduling
difference.

This diagnostic does not characterize DAC volume, clipping, AC coupling, or
the audible output. Those are covered by the separate audio validation.
