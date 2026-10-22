# AHRM-14 Player/Missile DMA Edge Test

`AHRM14_PMG_DMA_EDGE_TEST.XEX` cycles through four 32-frame PMG phases:

1. Two-line resolution with `PMBASE=$40`.
2. One-line resolution with `PMBASE=$80`.
3. One-line resolution with `VDELAY=$0F` and shifted player positions.
4. Two-line resolution with `PMBASE=$80`.

The player data, missile data, positions, and shapes are intentionally
different between the two PMBASE regions. The display-list DLI applies each
configuration and then holds it long enough for a capture.

## Expected output

- Four stable PMG phases, changing only every 32 frames.
- Visible differences in player height/shape between one-line and two-line
  resolution.
- A visible position or shape change in the VDELAY phase.
- No stale PMBASE data, missing players, or phase-dependent flicker.

This test is observational. Compare screenshots/video and, where possible,
collision behavior. It complements AHRM-07; exact cycle-2/cycle-5 fetch timing
and the two-cycle DMA enable lead time remain host-side timing concerns.
