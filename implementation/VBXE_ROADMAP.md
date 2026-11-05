# VBXE — feature and fidelity roadmap

This document is the operating plan for completing the jsA8E VBXE
implementation. The hardware contract remains [AHRM 12.4, VideoBoard XE](../AHRM/12.%20Internal%20devices/4.%20VideoBoard%20XE.md); Altirra 4.40 is used as a
differential reference, not as a substitute for AHRM or as certification of
physical hardware.

The detailed state of registers, VRAM, MEMAC, XDL, attribute maps and the
blitter stays in [`VBXE.md`](VBXE.md). This document adds the order of work,
the exit criteria, the diagrams and the validation path.

## What "functional VBXE" means

There are three distinct levels and they must not be mixed:

The VBXE cleanup audit keeps the diagnostic and compatibility APIs because
they are still used by the runtime, snapshots or tests; the cleanup was
limited to duplicated tables and redundant scheduler control.

| Level | Definition | State |
| --- | --- | --- |
| Practical compatibility | Real VBXE software boots and runs XDL, maps, MEMAC, blitter and IRQ in the main runtime. | **Reached** |
| Raster fidelity | GTIA/VBXE changes inside a scanline are composed per span and match Altirra in the covered scenes. | **In progress** |
| Complete product | The worker path presents the RGB plane, the visual suite is reproducible and the differences from hardware are documented. | **Pending validation** |

Practical compatibility does not require waiting for the exact arbitration of
every local slot or for the worker path. The VBXE selector stays disabled by
default and, when enabled, deliberately selects the main runtime.

## Architecture and data flow

```text
                   CPU / ANTIC / GTIA
                           |
                 registers, VRAM, MEMAC, IRQ
                           v
                    +-------------+
                    | vbxe.js     |
                    | FX state    |
                    +------+------+ 
                           |
             VSync latch  |  XDL + per-line map
                           v
        +------------------+------------------+
        |                                     |
        v                                     v
  GTIA event queue                    VBXE line state
  colors + PRIOR                      overlay + attributes
        |                                     |
        +------------------+------------------+
                           v
                  span compositor
          priority / transparency / collisions
                           |
              +------------+------------+
              |                         |
              v                         v
       indexed Atari plane       VBXE RGB plane
              |                         |
              +------------+------------+
                           v
                 main-thread renderer
                    (WebGL or Canvas 2D)

       worker: OffscreenCanvas composes the VBXE plane; the comparative regression is missing
```

The important rule is that VBXE does not replace ANTIC or GTIA. The
compositor must keep the layer identifiers — background, PF0–PF3/P5 and
P0–P3 — and must not try to rebuild priority from final RGB colors alone.

## Scanline execution order

```text
line start
      |
      +--> ANTIC/GTIA generate pixels and priority metadata
      |
      +--> CPU may write GTIA/VBXE
      |       `-> events are queued with their horizontal cycle
      |
      +--> VBXE advances XDL, repeat, scroll, map and fetches
      |
      +--> the line is closed
              |
              +--> split into [x0,x1) according to events
              +--> select PF/background from the GTIA state of the span
              +--> apply overlay, map, transparency and priority
              +--> update COLDETECT
              `--> publish presentation planes
```

The local schedule already exists and keeps a compatible aggregate output for
the blitter. The MEMAC order must not be changed, and no exceptions should be
added on a visual hypothesis alone: a diagnostic that shows a reproducible
horizontal difference is required.

## Work stages

### Stage 0 — baseline and contract

**State: completed, keep it as the entry gate.**

- Run `npm run test:vbxe:full` from `jsA8E/`.
- Confirm that the suite covers registers, XDL, maps, MEMAC, blitter, IRQ and
  real software.
- Check that `VBXE.md`, the READMEs, the tests and `implementation/NOTES.md`
  describe the same behavior.

**Exit:** reproducible baseline and documentation without contradictions.

### Stage 1 — GTIA span compositor

**State: partially completed.**

- Keep the timed queue of `COLPF0–3`, `COLBK` and `PRIOR`.
- Apply color and priority changes to each horizontal interval.
- Keep the P/M winners and exclude objects hidden by `PRIOR`.
- Add regressions for events on the first, last and same cycle.

**Exit:** mid-line GTIA changes are visible and deterministic without the
VBXE overlay.

### Stage 2 — XDL overlay per span

**State: partially completed.**

- Replay standard, lores, hires and text per interval, respecting the
  narrow/normal/wide limits already validated.
- Apply color 0/`$F` transparency, palette and priority in each span.
- Cover changes of `VIDEO_CONTROL`, palette, scroll and XDL during a line.
- Verify transitions between widths and between Atari/VBXE planes.

The `applyGtiaSpans()` path already rebuilds overlay and playfield per
interval, including standard, lores, hires and text in the corresponding
presentation planes. The narrow/normal/wide limits, transparency and the
covered priority have regressions. Still pending are VBXE register changes
inside the line and the full crossing of all overlay combinations with special
GTIA modes.

**Exit:** correct overlay when the GTIA state changes inside the line.

XDL state persistence is already resolved: AHRM resets visual parameters at
VSync but keeps the overlay and attribute map addresses and strides;
`verticalSync()` now keeps those latches and resets only the visual
parameters. The multi-frame regression is in `vbxe_device_state`.

### Stage 3 — attribute maps per span

**State: partially completed; initial GTIA/PF3 replay implemented.**

- Reuse the real row state, scroll counter, overscroll, cell size and address
  advance.
- Apply palette, P0–P3, PF0–PF3/P5, reverse and transparency per cell/span.
- Cover `AtMapOn`, `AtMapOff`, address change, reload and the 43-cell limit.
- Also reload the buffer when the row changes inside a repeated entry; this
  edge already has a regression in `vbxe_device_state`.
- Add scenes that change GTIA and the map during the same line; a PF3/GTIA
  regression already exists for the legacy and hires planes.

**Exit:** correct maps on normal lines and on mid-line changes.

The geometry already follows `OvMisc` in narrow, normal and wide, even with no
active overlay, in both the legacy plane and the hires plane. The compositor
now replays per span the PF3 and the GTIA mode observed in the event queue;
the output of this stage is not yet considered reached until it reproduces
VBXE map register changes, the full crossing with hires/text overlay, and
per-phase timing.

### Stage 4 — GTIA modes, priority and collisions

**State: base matrix implemented and regressed; scene differentials still
pending.**

- Complete the GTIA 9/10/11 matrix with ANTIC modes 2–F and bitmap/character
  sources.
- Validate PF2/PF3, masks, inversion, transparency and priority for FX 1.20,
  1.24 and 1.26.
- Complete the remaining `COLMASK`/`COLDETECT` combinations, P0+P1/P5 and
  attribute maps.
- Turn every stable differential into a deterministic regression.

The matrix of PF/P5/P/M groups and the legacy/full priority tables already
have a deterministic regression in `vbxe_priority_collision_matrix`; the
existing XEX probes also cover `COLMASK`/`COLDETECT`, P0+P1 and P5. Completing
this stage still requires widening real scenes with transparency, maps and the
profiles/modes that do not yet have a visual differential.

**Exit:** every supported combination has an AHRM rule, a test and a
documented differential result.

### Stage 5 — registers, MEMAC, reset and snapshots

**State: functional, with the deterministic edge audit completed.**

- Review ignored bits, read values and latches of all registers.
- Test both banks `$D640`/`$D740`, warm reset, power cycle and the VSync latch.
- Cover MEMAC A/B with CPU, ANTIC, overlap, Ultimate1MB and an active blitter.
- Restore snapshots during an active XDL, active map and blitter in progress.

The `vbxe_register_snapshot` regression covers both register banks, readback,
ignored bits, VSync, MEMAC A and restoring an active XDL/blitter;
`vbxe_device_state` additionally covers warm reset, power cycle, configuration
and VRAM persistence. Per-phase arbitration and the interaction with external
expansions during a real run remain fidelity limits.

**Exit:** no covered path depends only on an assumption or an indirect test.

### Stage 6 — blitter timing

**State: local schedule implemented; differential validation and the
coordinates of the physical order and the horizontal validation of MEMAC are
pending.**

- Run the continuous/restart attribute-map diagnostics in Altirra.
- Compare the blue/red border and the persistent completion field.
- If a difference appears, isolate it among XDL, map reload, MEMAC and IRQ.
- The schedule already reserves 912 local slots per scanline: overlay in even
  phases, with the narrow/normal/wide starts aligned to Altirra's table, MEMAC
  reads in phase 1, CPU writes in phase 3, XDL and map after the active area,
  and the blitter in the remainder. The physical order and the cycle-by-cycle
  consumption of the MEMAC/blitter remainder still need to be validated.

**Exit:** reproducible timing agreement for baseline, overlay, continuous map
and restarted map; per-slot precision is declared only if there is a
sufficient horizontal marker.

The implementation already applies AHRM's fixed 22-cycle XDL update,
regardless of the decoded bytes; repeated lines do not generate a second
update. The remaining exception is the physical order of each MEMAC access,
the blitter's cycle-by-cycle consumption of the remainder, and its comparison
with Altirra.

### Stage 7 — real software and visual comparison

**State: in progress; the headless corpus already has a visual progress gate,
but the differential comparison with Altirra is still pending.**

**Update 2026-11-04.** With the MEMAC fixes (window remapping and instruction
fetch from a window), the polarity of `VIDEO_CONTROL` D2 transparency (the
Altirra one: with D2 = 0 overlay color 0 is transparent) and the spurious DLI
in vblank, the corpus behaves as follows: Popeye is playable (title, menu,
score table, game), D600 looks like Altirra (rainbow background + blitter
sprites; requires BASIC off or ENTER + a key), Phoenix and Celeste show their
title and Galaga, Crysis and Falcon work. Popeye and D600 were compared
visually with Altirra under wine. What is missing is turning this into
reproducible gates: the 480-frame checkpoints of `vbxe_real_software_scene`
only see the loader of the large XEXs (Phoenix ~4200 frames, Popeye ~4800,
Galaga ~19000), so they must wait for the end of loading, press keys in the
menus and require VBXE to be active. Details in
[`VBXE.md`](VBXE.md#real-software-status--2026-11-04).

- Keep the gates for Popeye, Galaga, DACTest, Textmode Test, Crysis, Celeste,
  D600, Falcon and Phoenix.
- Strengthen the XEX harness: `runXex({ awaitEntry: false })` and the
  advance of `cycleCounter` do not by themselves prove that the program
  reached its scene.
- The first strong gate is already implemented in
  `vbxe_xex_scene_marker.test.js`: a minimal XEX writes two RAM markers and
  the harness waits for those values. A breakpoint during boot is not reliable
  in headless, so the regression uses observable memory; real programs still
  need equivalent markers.
- The `vbxe_real_software_scene.test.js` regression checks the 120, 240, 360
  and 480 frame points, captures each program and requires a non-black frame
  whose RGBA digest does not match any reset frame for the five covered cases.
  Galaga is explicitly boot-only because its headless capture is black;
  Celeste, D600 and Phoenix are also boot-only because their captures match
  the reset set. This avoids accepting both the temporal variants of the
  common initial screen and a transient black frame; the minimal XEX RAM
  marker gate is kept as well. The gate also requires the SHA-256 fingerprint
  of the 64 KiB of RAM to differ from the reset set in the four boot-only
  cases. This proves observable execution, but it does not replace a
  scene-specific mark or an Altirra golden image.
- Use the Chromium/CDP instance as the provisional capture path: the FX1.26
  corpus advances 120 frames in WebGL2 and Textmode Test changes digest when
  mode 4 is selected. This evidence still has to be turned into a reproducible
  Altirra comparison.
- Select stable real-software scenes that use overlay, text, maps and linked
  blitter.
- Capture the same number of frames in jsA8E and Altirra with PAL/NTSC,
  profile, page and palette fixed.
- Compare RGB, layers, collisions and geometry; record intentional differences
  in `VBXE.md`.

**Exit:** automatable visual evidence of progress for all declared paths;
equivalence additionally requires the pending Altirra comparison.

### Stage 8 — worker and product closure

**State: integration and browser gate implemented; execution depends on CDP.**

- Keep the VBXE RGB plane inside the worker's `OffscreenCanvas` render; the
  main-thread fallback is no longer forced when VBXE is active.
- Keep equivalence with WebGL, Canvas 2D, snapshots and the automation API.
- Run `npm run test:vbxe:browser` with Chromium over CDP; the gate validates
  worker/fallback WebGL2 and Canvas2D, non-empty captures and an equivalent
  PNG hash, and restores the URL.
- Validate the selector, reset, `$D600/$D700` and PAL/NTSC; the Canvas2D
  variant already has automated coverage and the provisional baseline is
  persisted in `jsA8E/tests/fixtures/vbxe_browser_golden.json`.
- For an independent reference, `A8E_VBXE_REFERENCE` allows comparing Altirra
  JSON captures with the same schema without modifying the internal gate.
- Run the full suite and update the support matrix.

**Exit:** VBXE can be enabled from the normal application without explicitly
selecting the main runtime.

## Dependencies between stages

```text
baseline/contract
        |
        v
GTIA spans -----------+
        |              |
        v              v
overlay spans ---> maps per span ---> modes/collisions
        |                    |              |
        +--------------------+--------------+
                             v
                  registers/MEMAC/snapshots
                             |
                             v
                    blitter phase timing
                             |
                             v
                 software + visual comparison
                             |
                             v
                         worker/UI
```

Stages 4 and 5 can advance in parallel after the base. Stage 6 must consume
diagnostics from stages 2 and 3; its scheduler should not be adjusted before
the compositor can show the correct marker.

## Validation gates

### Quick regression

```sh
cd jsA8E
npm run test:gtia-spans
node tests/vbxe_device_state.test.js
node tests/vbxe_blitter_state.test.js
node tests/vbxe_rambo_bus.test.js
```

### Full VBXE suite

```sh
cd jsA8E
npm run test:vbxe:full
```

### Differential evidence

Every change that affects image or timing must include:

1. a reproducible XEX diagnostic;
2. an equivalent capture or reading in Altirra 4.40;
3. the jsA8E result with the same profile and page;
4. an automated regression, or an explicit explanation of why it cannot yet be
   automated;
5. a new entry in `implementation/NOTES.md`.

## Closure criterion

The **functional VBXE** goal is considered closed when:

- `npm run test:vbxe:full` finishes without failures;
- the real-software corpus still boots and runs;
- standard, lores, hires, text, maps, MEMAC, blitter, IRQ, reset and snapshots
  have a contract and coverage;
- the covered mid-line changes use spans and have a differential comparison;
- the limitations of exact phase, physical hardware and worker are separated
  from the functional capabilities and documented.

The **complete fidelity** goal additionally requires closing stages 6–8 and
must not be declared merely because the software boots.

## Repository references

- [`VBXE.md`](VBXE.md): design, registers, state and support matrix.
- [`../jsA8E/README.md`](../jsA8E/README.md): browser usage and the VBXE selector.
- [`jsA8E/CORE.md`](jsA8E/CORE.md): device integration into the core.
- [`jsA8E/RENDER.md`](jsA8E/RENDER.md): RGB planes and presentation.
- [`jsA8E/WORKER.md`](jsA8E/WORKER.md): worker boundary and current limitation.
- [`NOTES.md`](NOTES.md): log of every improvement and differential.
