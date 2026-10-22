# AHRM-08 CPU/POKEY Boundary Test

`AHRM08_CPU_BOUNDARY_TEST.XEX` is an observational diagnostic for the
remaining P1 phase difference. It uses the existing Stage-3 setup
(`AUDF4=$01`, `AUDCTL=$00`, `SKCTL=$23`) and reports the first `DATA NEEDED`
poll after four instruction paths following `STIMER`.

The screen shows:

- `CASE A NOP2`: one `NOP` (2 cycles).
- `CASE B BIT ZP`: `BIT $80` (3 cycles).
- `CASE C BIT AB`: `BIT $0080` (4 cycles).
- `CASE D 2 NOP`: two `NOP` instructions, as a control.

All cases use the same setup and the same `LDX`/`JSR` dispatcher before the
selected instruction. `NEEDED` is the guest polling count, not a cycle count.
Compare the four hexadecimal values on jsA8E, native A8E, Altirra, and, if
available, hardware. A difference limited to one instruction width supports
the current runner-boundary hypothesis; matching values would rule out this
simple form of it. This diagnostic does not define a pass/fail value and must
not be used to justify a padding-specific timing offset.

The source and checked-in XEX are reproducible with the repository assembler.

## First comparison (2026-09-28)

The supplied jsA8E, native A8E, Altirra, and hardware runs all reported
`00` for cases A-D. Thus an isolated 2-, 3-, or 4-cycle instruction in this
location does not explain jsA8E's matrix P1 result. jsA8E, Altirra, and
hardware reported `TX COMPLETE AFTER N:37`; native A8E reported `35`. That
completion-count difference is a separate polling observation, not evidence
for changing the P1 divider or adding an offset. The next bounded experiment,
if pursued, must retain the matrix fixture's exact P1 instruction path and
vary only the event boundary within that path.
