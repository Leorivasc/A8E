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

## Known issues and pending work

This is the single list to resume from when a game or a test shows a new VBXE
difference. Add a row (or a line to the log in [`NOTES.md`](NOTES.md)) for each
finding and remove it when fixed. State as of **2026-11-06**, branch `VBXE`,
prepared for merging into `main` as an **experimental, opt-in feature**.

### Release status (2026-11-06)

| Gate | Result |
| --- | --- |
| jsA8E, every VBXE test (`test:vbxe`, `test:vbxe:full`, `test:vbxe:browser`, 59 files) | 59 of 59 pass. `vbxe_blitter_attrmap_phase_boot` is intermittent (see I2) and passed in this run. |
| Native `ctest` (17 probes, run with the ROMs in the repository root) | 16 of 17 pass. `pokey_sio_contract_probe` fails the same way on `main` (see I1). |
| Diff against `main` | 16 commits, no binaries, ROMs or `build/` content; the 184 files under `implementation/AHRM Validation` are `.asm` sources and their `.XEX` builds (90 + 94). |
| Default behavior | VBXE is off by default in both cores; base Atari behavior is unchanged when it is off. |

Support level to communicate: practical compatibility with real software
(Popeye, Commando, Gacek, Galaga, Crysis, D600, Phoenix, Celeste, Falcon and
others) in jsA8E, with native A8E at stages 1-2. Not hardware-certified, not
pixel-exact, not cycle-exact. Rough estimate, not a measurement: most
mainstream VBXE software should run correctly; exact end-of-blit timing and
mid-line effects are the highest-risk areas.

### Differences from Altirra 4.40 found by reading `vbxe.cpp` (2026-11-06)

Audit scope: `UpdateMemoryMaps`/`InitMemoryMaps`, `ReadControl`/`WriteControl`,
the XDL decoder in `BeginScanline`, and the blitter (`RunBlitter`,
`RunBlitterRow`, `LoadBCB`, `LoadBlitter`). Registers, MEMAC and XDL match
(window priority below the ROM and the hardware pages, truncation at `$10000`,
bank alignment to the window size, MEMAC-B bits 7/6, palette write expansion,
overlay/map/XDL DMA tables, 43x4 map cycles). The items below differ and apply
to **both cores** unless noted.

| Id | Difference | Altirra reference | Notes / decision needed |
| --- | --- | --- | --- |
| D1 | Mode 6 (nibble) collision: when both nibbles of a byte collide we record the high nibble; Altirra records the low one. | `RunBlitterRow<6>` checks `cl` first and then clears the active mask. | Small fix: check the low nibble first in `recordNibbleBlitCollision` calls (`vbxe.js`, `Vbxe.c`). |
| D2 | Blitter mode 7: Altirra runs it as mode 0 (copy); we write the destination back (no-op). | `RunBlitterRow()` dispatch `default: case 0`. | Its cycle cost uses the modes 2-6 rules. No known software uses it. |
| D3 | Mode 4 (AND), source byte `$00` with a non-zero AND mask: we charge 2 cycles (AHRM table 113 and Altirra's own comment); Altirra's code charges 1. | `LoadBCB` default case, `mBlitCyclesSavedPerZero`. | Altirra's code and comment disagree. Decide which one to follow; it only moves the end-of-blit time. |
| D4 | `BLITTER_BUSY`: bit 1 is set only while processing (not while the BCB loads, bits are never both set); a START written while the BCB loads is ignored (Altirra restarts). | `ReadControl` 0x53, `WriteControl` 0x53 (`IsBlitterActive`). | Already known; no real program has shown it. |
| D5 | Blitter budget granularity: Altirra charges whole rows and can overshoot the line budget; we charge per byte. | `RunBlitter` row loop. | Affects only the instant a blit finishes inside a line. |
| D6 | Attribute-map cell without extended color: a set pixel should take the cell's PF2 color with only PF1's luminance; we use the full PF1 color. | `RenderMode8`, lines ~2610-2620. | Already known; no real program has shown it. |
| D7 | Reads of undefined VBXE registers return open bus in Altirra (`-1`); we return `$FF`. | `ReadControl` default. | Cosmetic unless software probes them. |

Not audited yet (next pass over `vbxe.cpp`): `RenderMode8` to `RenderMode11`
(the GTIA-mode renderers), `RenderOverlay*` and the 80-column text path,
`InitPriorityTables`/`ConvertPriorityToNative`, the palette corrector, `COLDETECT`
bit order, savestate fields.

### Behavior and validation gaps

| Id | Item | State |
| --- | --- | --- |
| G1 | Commando: the end-of-level bridge/portal was not played after the MEMAC-A fix; only the first screen and the rock plateau were verified. | Pending user test. |
| G2 | Other programs that open MEMAC A at `$D800` or above (the 2026-11-05 fix) were not tried; only the unit case `$E000` and Commando cover it. | Report any new case here. |
| G3 | BASIC is enabled by default when an XEX is loaded, so VBXE programs that use RAM at `$A000-$BFFF` show BASIC ROM contents unless Option is held (Gacek). Open question: disable BASIC by default for XEX loads, as Altirra does. | Open, no code change. |
| G4 | No comparison with a physical VBXE; Altirra is the only external reference and itself deviates from the AHRM in places (see "Deliberate deviations" in `VBXE.md`). | Needs hardware or a user with a board. |
| G5 | Stage 7: no reproducible Altirra golden images; Galaga, Celeste, D600 and Phoenix are boot-only gates; real programs lack scene markers. | Open (stage 7). |
| G6 | No automatic native-versus-jsA8E comparison. The Commando bug was an A8E/jsA8E divergence and no roadmap gate would have caught it. | Idea: a differential gate that runs the same XEX in both cores and compares RAM/VRAM at fixed frames. |
| G7 | Exact local-bus phase order, per-slot arbitration and mid-line overlay/map composition remain fidelity limits (stages 1-3 and 6). | Open. |

### Product limits

| Id | Item | State |
| --- | --- | --- |
| P1 | Native A8E implements stages 1-2 only: 336-px output (hires/text overlays averaged), no mid-line GTIA replay, aggregate (not per-slot) bus accounting, no FX 1.26r RAMBO profile, no snapshots, no UI selector. | Documented in `A8E/README.md`. |
| P2 | The worker/browser gate (`test:vbxe:browser`) needs Chromium over CDP on port 9222 and drives the page it finds there (it restores the URL, but any game loaded in that page is reset). | Run it on a throw-away Chromium. |

### Test infrastructure issues (not VBXE defects)

| Id | Item | State |
| --- | --- | --- |
| I1 | `pokey_sio_contract_probe` fails with "RunStatusLatchContract: initial STATUS missing ACK". Verified on a clean `main` worktree: it fails there too. | Pre-existing, unrelated to VBXE. |
| I2 | `vbxe_blitter_attrmap_phase_boot` is intermittent (failed 2 of 3 runs on an earlier commit, passed in the 2026-11-06 full run). It is timing-sensitive; do not treat a single failure as a regression. | Open. |
| I3 | `ctest` takes its working directory from the repository root and needs `ATARIBAS.ROM`/`ATARIXL.ROM` there (they are git-ignored); without them 12 probes fail with "ROM file not found". | Copy or link the ROMs before running `ctest`. |

## Repository references

- [`VBXE.md`](VBXE.md): design, registers, state and support matrix.
- [`../jsA8E/README.md`](../jsA8E/README.md): browser usage and the VBXE selector.
- [`jsA8E/CORE.md`](jsA8E/CORE.md): device integration into the core.
- [`jsA8E/RENDER.md`](jsA8E/RENDER.md): RGB planes and presentation.
- [`jsA8E/WORKER.md`](jsA8E/WORKER.md): worker boundary and current limitation.
- [`NOTES.md`](NOTES.md): log of every improvement and differential.
