# GTIA

> Hardware emulation reference: Before implementing any Atari 800 XL PAL/NTSC hardware emulation, use the [AHRM](/AHRM/index.md) as reference.

- Files: `A8E/Gtia.c`, `A8E/Gtia.h`, `A8E/AtariIo.c`
- Purpose: render player/missile behavior and resolve priorities/collisions.
- Status: AHRM-07 diagnostic scope certified on 2026-09-27.
- Notes: register writes are handled in `Gtia.c`; color resolve, player/missile priority, and collision updates are applied during per-line draw in `AtariIo.c`. PMG DMA is managed by the unified `AtariIo_FetchPmgDmaCycle` helper, called from `AtariIo_DrawClockAction` at the documented cycle slots (missile at cycle 0, players 0–3 at cycles 2–5). `VDELAY` masks the corresponding GTIA latch load on even scan lines while ANTIC keeps the DMA slot; it does not shift PMG memory rows. Missile DMA stays active when player DMA is enabled, and `DMACTL` P/M enable bits are sampled two ANTIC cycles earlier while its resolution/addressing bit stays live (AHRM 4.13). Interleaved PMG rendering uses a per-line shift-register/state-machine model: a trigger ORs new latch data into the active shifter, resets the size state to `%00`, and allows repeated rightward same-line retriggers without moving an already-started image. PM horizontal origin uses the same AHRM 6.2 coordinate mapping as playfield rendering, so HPOS `$30` aligns with the normal playfield left edge at line-buffer `x=96`. `PMBASE` is read live at each DMA cycle — a DLI write between cycles 5 and 0 of adjacent scanlines takes effect cleanly on the next scanline; a write during cycles 0–5 causes a mixed-base fetch for that scanline (matching real hardware behavior). AHRM-07 now records a bounded per-line history of PMG register writes and PM DMA latch events, then replays that history while priming the hidden prefix of the line. If the bounded history overflows, the renderer deliberately falls back to the previous current-register reconstruction instead of replaying incomplete history.
- Issues: synthetic HPOS, PMBASE, PRIOR, collision, VDELAY, and delayed
  `DMACTL` probes pass, as does the AHRM-07 visual diagnostic against Altirra
  and hardware. Broader title-level raster comparison remains regression work;
  it is not an open AHRM-07 diagnostic criterion. AtariBlast's formerly
  reported detached-player fragments are retained as an intermittent
  real-content watch case until independently reproduced again.
- Todo: keep collision/priorities parity checks with `jsA8E/`; the explicit
  Option-on-Start compatibility behavior is covered by the AHRM-02 CONSOL
  probe and is not part of normal GTIA register semantics.
