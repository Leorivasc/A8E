# VBXE — design and implementation status

> Hardware reference: use [AHRM chapter 12.4, VideoBoard XE](/AHRM/12.%20Internal%20devices/4.%20VideoBoard%20XE.md) before changing this design or implementing VBXE behavior.

## Status

The project roadmap, milestone exit criteria, diagrams, and validation gates
are maintained in [`VBXE_ROADMAP.md`](VBXE_ROADMAP.md). This file remains the
technical contract and support matrix; the roadmap is the canonical source for
work ordering and completion status.

Open differences from Altirra 4.40 (blitter modes 6/7 and mode-4 timing,
`BLITTER_BUSY`, attribute-map cells without extended color, undefined register
reads), unaudited areas, validation gaps and test issues are tracked in
[Known issues and pending work](VBXE_ROADMAP.md#known-issues-and-pending-work);
resume from that list when a new difference is found.

The JavaScript core implements optional FX 1.20, 1.24, and 1.26 devices with revision reads,
`$D640`/`$D740` register decoding, 512 KiB VRAM, palette/write latches,
vertical-sync latching, soft reset, MEMAC state, and snapshot persistence.
On power-up palette 0 is initialized from the current GTIA colors; soft reset
leaves all palettes unchanged, as required by AHRM.

Altirra 4.40 returns `$10` from `CORE_REVISION` and `$20`, `$24`, or `$26`
from `MINOR_REVISION` for its selectable FX 1.20, 1.24, and 1.26 profiles.
The core follows that observable behavior; the `$11` value mentioned in older
AHRM text is not returned by this Altirra implementation.
MEMAC CPU accesses only replace RAM-mapped addresses; ANTIC DMA reads use VRAM
when their separate enable bit is set, except where Ultimate1MB owns its
extended-memory window.

The functional blitter loads 21-byte local-VRAM control blocks
and advances a snapshot-safe state machine once per ANTIC scanline. It covers
linked lists, signed source/destination steps, 9-bit width, zoom, pattern
source, all seven documented operations, collision-code latching, stop, and
`IRQ_STATUS`. An enabled, uncleared completion status asserts the shared CPU
IRQ line until a write to `IRQ_CONTROL` acknowledges it. It uses AHRM's
cycle-based local-bus budget, including XDL, overlay, attribute-map, and MEMAC
reservations; the base mode-0/MEMAC timing has an external Altirra match.

The first XDL milestone is also implemented. At vertical sync the core latches
the video control and XDL address, parses the per-line descriptor subset used
by the diagnostics, and composes standard, lores, and hires graphics overlays into a
separate RGB plane. The implemented compositor supports palette selection,
color-0 and color-`$xF` transparency, and the initial FX 1.26 XDL priority mask
against the existing Atari per-pixel priority metadata; FX 1.20/1.24 use their
separate documented legacy priority map. Text rendering, text collision, and
the covered attribute-map paths have focused device/XEX regression coverage and
documented Altirra differentials. The native core remains planned.

The same graphics subset now latches `COLDETECT` for enabled `COLMASK`
source-byte ranges against PF0-3/P5 and P0-3 layer metadata. `COLCLR` clears
the latch without changing GTIA collision registers. GTIA P/M composition now
also records a per-pixel final-contributor plane, so P/M graphics hidden by
`PRIOR` bits 0-5 are excluded from both this collision subset and XDL priority
comparison. `VBXE_XDL_P5_MULTICOLOR_PROBE.XEX` has externally matched Altirra
for frame-separated P0+P1-multicolor/P5 collisions; the deterministic priority
matrix now covers the profile tables and GTIA 9/10/11 contributor groups.
The VBlank-synchronised GTIA-9/10/11
collision differential establishes that non-background final inputs produce
`$7F` in mode 10, while modes 9 and 11 retain the ordinary contributor result.
The initial attribute-map renderer
selects a P0-P3 priority register and overlay palette per cell and records its
overlay collision bit. It also applies palette-selected PF0-PF2 overrides and
the non-reversed mode-F PF3 mask after the final GTIA contributors are known.
Mode-F and hires character-mode (2/3) reversal preserve and decode raw ANTIC
source-bit pairs. For ANTIC lores modes 4-E, reversal retains the AN0-1
two-bit source value and interprets its bits as the corresponding pair of
hires pixels, per AHRM; this is distinct from the mode-F PF0-PF3 lookup.
Modes 6/7 derive that value from the glyph bit and its PF selector; modes
9/B/C correctly collapse background and PF0 to the shared hires `00` pair.
Modes 2/3/F also retain raw hires bits while GTIA-special rendering is active.
The focused FX 1.26 mode-9/10/11 reversed-attribute paths produce opaque
palette color 0 after their raw-pair validity check.
The separately validated lores-character subset is narrower: ANTIC modes 4/5
in GTIA mode 10 pack two two-bit sources as a raw nibble; measured nibble 1 selects the
attribute cell's PF0 and measured nibbles 2, 3, and `$B` select palette color
0. In the equally focused mode-4/5 probes, GTIA modes 9 and 11 produce opaque
palette color 0 for valid lores sources. No other lores/GTIA-special
combination is inferred from these rules.
For the separately measured mode-6/7 selector-character sources in GTIA mode
10, valid reverse source values instead produce opaque palette color 0. The
independently measured mode-6/7 GTIA-9/11 fields do likewise.
The independently measured graphics-mode-8-E GTIA-mode-10 fields also produce
opaque palette color 0 throughout the mapped field. This is implemented for
the complete 8-E graphics source family. In GTIA modes 9 and 11, the
complete graphics modes 8-E are likewise opaque palette color 0.

## Real-software status — 2026-11-04

Behavior of the supplied FX 1.26 corpus in jsA8E after the MEMAC, transparency,
GTIA-read, and vertical-blank fixes recorded in `NOTES.md`. "Compared" means a
visual comparison against Altirra 4.40 running the same XEX under wine.

| Software | State | Notes |
| --- | --- | --- |
| Popeye | Playable | Title, menu (`START` twice), "TOP FIVE CHART", and gameplay with colors. Code runs from a MEMAC A window; needed the instruction-fetch window path and the vertical-blank DLI fix. Compared. |
| D600 blitter demo | Correct | Rainbow Atari-logo background (ANTIC mode F + attribute map, one color per line) with 24 chrome blitter sprites. Needs BASIC off: with BASIC on the program waits for a line from `E:` (Altirra behaves the same), so press ENTER and then any key, or enable Option-on-Start. Compared. |
| Phoenix | Title screen | Image restored from VRAM into RAM through MEMAC A. |
| Celeste | Title screen | |
| Galaga, Crysis, Falcon | Confirmed running by the user | Crysis and Falcon are 320x480i. Not re-compared in this pass. |
| DACTest, Textmode Test | Not re-checked | Covered by the existing launch gates. |

Known gaps: the `vbxe_real_software_scene` gates still use 480-frame
checkpoints and therefore only observe boot screens for the large XEXs (Phoenix
needs about 4200 frames, Popeye about 4800, Galaga about 19000); they should
wait for load completion, press keys at menus, and require VBXE to be active.
`vbxe_fx124_priority_probe_boot` failed before this pass ("legacy bit 6 must
win over PF2") and is fixed: Altirra's `RenderMode8` gives the overlay priority
logic PF2 for every ANTIC hires pixel (modes 2, 3, F), and only FX 1.26 with
extended color lets set pixels carry PF1 (see NOTES.md, 2026-11-05).
`vbxe_blitter_attrmap_phase_boot` is timing-sensitive and fails intermittently
when the machine is loaded.

Performance (headless Node harness unless stated): D600 went from about 8 fps
to 27-45 fps and VBXE overhead on a text-mode XEX from 2.7x to roughly 1.1x.
In Chromium (main thread, WebGL2) D600 holds 60 fps with the main thread about
70% busy; the committed code before these fixes ran at 17 fps with the thread
saturated. Firefox 158 reaches roughly 30-35 fps for D600 (a headless instance
with software rendering, so not a clean comparison); the result is nearly
identical with WebGL2, Canvas2D, and the worker, which points at the emulation
core rather than drawing. The costs removed were per-DMA-byte `window.A8EVbxe`
lookups, a 912-slot rescan of the local-bus schedule for every blitted byte, a
per-line recount of free slots, and `Math.*` calls on per-pixel/per-byte paths.
A CPU profile taken inside Chromium afterwards showed the largest remaining
core cost was GTIA's per-color-clock player/missile pass (about a third of the
time, even with no player/missile in use); it now returns early when nothing
can draw or load in the span. VBXE-side follow-ups: an empty PF3 mask skips its
per-pixel math, `installIoHandlers` only visits addresses MEMAC can cover,
the local-bus schedule buffer and attribute-map line buffer copy are cheaper,
and the attribute-map playfield pass decides each pixel once for both
presentation planes. Remaining VBXE cost is dominated by the blitter loop and
the per-pixel attribute-map composition.

`mrproper_vbxe.xex` (2026-11-04): runs and draws. Its fruit pickup reads
`BLT_COLLISION_CODE` a few cycles after writing `BLITTER_START`, without
waiting for completion. Altirra executes the rest of the current scanline's
blitter budget at START, so the first rows of the sprite have already been
tested; `startBlitterMidLine` reproduces that, and the line-end budget of that
line is then not spent a second time. The green/cyan garbage frames that show
up in this game also appear in Altirra.

## Coverage audit — 2026-11-03

The cleanup audit of this revision found no dead VBXE functions or retirable
exports. The exposed blitter, snapshot and MEMAC diagnostic routines are still
consumed by the runtime or by regressions; only duplicated literal tables and
one redundant scheduler branch were removed.

This audit compares AHRM 12.4 with Altirra 4.40's `vbxe.cpp` and with the
effective jsA8E paths. It does not mean the current boot gates are green: several
exercise only a subset and some encode the current behavior instead of the
reference behavior.

| Area | Result | Verified difference |
| --- | --- | --- |
| VRAM, basic registers, pages, MEMAC A/B, palette, IRQ and blitter blocks | Partially replicated | The paths and normal cases exist and the register/readback edges are covered by `vbxe_register_snapshot`. MEMAC-B uses bit 7 for the CPU and bit 6 for ANTIC, like Altirra and real software, even though AHRM labels them the other way round. CR/CG/CB already replicate Altirra's D7→D0 expansion; the local reservation is modeled as 912 slots per scanline, separates MEMAC reads from CPU writes and keeps the horizontal slot when the caller provides a timestamp. The aggregate path is still needed for older accesses. |
| XDL: descriptor and line state | Partial | Row progression, MAPPAR scroll/overscroll, `END` and the cross-frame persistence of the overlay/map addresses and strides follow Altirra. AHRM documents the MAPPAR scrolls as minus-one values while Altirra keeps the literal value; a visual differential is needed to close that documentation discrepancy. |
| XDL: `OvMisc` | Implemented on the covered path | The compositor consumes width, overlay palette and the default playfield palette; only crossings with the attribute map that are not yet visually differentiated are missing. |
| Overlay and text presentation | Partial | Standard/lores use the real narrow/normal/wide limits and hires/text their native 512/640/672 signals. Complete differentials for all transitions with the attribute map are missing. |
| Attribute map | Partial | PF, Rev, per-cell palettes, the 43-cell limit, the five-bit scroll counter, overscroll, row advance and Altirra's narrow/normal/wide geometry are present. The span replay already rebuilds PF3/GTIA over the line intervals, but VBXE map register changes, special GTIA combinations and complete visual differentials are missing. |
| Blitter | Partial | Modes 0--6, list, zoom and collisions are present; a linked entry resets the collision code. The start is deferred to the next scanline and only consumes free slots of the local schedule; the physical order of MEMAC and the cycle-by-cycle consumption of the remainder still need to be validated. |
| Reset and GTIA writes | Partial | The `$D080-$D0FF` strobe is wired; warm reset keeps the XDL addresses, priorities and `COLDETECT` that Altirra keeps, and clears `BLT_COLLISION_CODE`. Warm/cold reset and XDL/blitter snapshots are regressed; timing edges are missing. |
| RAMBO and configuration port | Implemented on the covered path | Altirra's configuration latch at `$DxC0+` persists correctly. The FX 1.26r profile returns `MINOR_REVISION=$A6` and, with PORTB-D4 low, shares `$4000-$7FFF` between CPU/ANTIC and the documented upper VBXE bank; `vbxe_rambo_bus` covers both buses, disabling and bank isolation. |
| Changes inside the scanline | Partial | The GTIA queue keeps colors and `PRIOR` with their horizontal cycle; when an XDL line closes, overlay, default palette, attribute map and `COLDETECT` replay the covered spans, including PF3/GTIA mode and rasterized `COLCLR`. VBXE register changes inside a line and complete visual differentials are still missing. |

### AHRM audit of the `VBXE` branch — 2026-11-02

The functional suite is green, but AHRM conformance must be declared as
partial. The verified gaps are:

| Priority | Gap | Evidence | Next action |
| --- | --- | --- | --- |
| High | `verticalSync()` replaced the whole XDL state and lost the overlay/map addresses and strides that AHRM keeps across frames. | Fixed in `jsA8E/js/core/vbxe.js`; multi-frame regression in `vbxe_device_state`. | Keep coverage when widening the XDL cases and also validate snapshots during a reset. |
| High | The attribute map was always composed in normal geometry; it did not use the narrow/wide width/position of `OvMisc`. | Fixed in `jsA8E/js/core/vbxe.js`; narrow/normal/wide coverage in `vbxe_device_state` and boot oracles. | Keep the shared geometry when extending the temporal replay and validate crossings with an active overlay. |
| High | The XDL cost had to use the number of decoded bytes, while AHRM fixes 22 update cycles. | Fixed in `jsA8E/js/core/vbxe.js`; regression in `vbxe_device_state` and `vbxe_blitter_state`. | Keep the fixed contract and resolve only the per-phase sequence if a reproducible horizontal differential appears. |
| Medium | The MEMAC/overlay/XDL/map/blitter reservation already uses the eight-phase sequence and separates reads from CPU writes; when the caller provides a timestamp it also keeps the horizontal slot of the access. The physical order and the cycle-by-cycle consumption of the remainder still lack a differential validation. | `jsA8E/js/core/vbxe.js`, `vbxe_blitter_state`, `io.js`, `memory.js`. | Compare CPU-read/CPU-write/ANTIC horizontal markers with Altirra before adjusting the order. |
| Medium | MEMAC-B uses D7=CPU and D6=ANTIC, contrary to the AHRM text table, although it matches Altirra and the tested corpus. | `jsA8E/js/core/vbxe.js:1058-1063`; `vbxe_memac_b_xex`. | Keep as an explicit exception until the erratum is resolved or physical evidence is obtained. |
| Medium | `MAPPAR`/attribute-map scroll keeps literal values, versus the "minus one" described by AHRM. | `jsA8E/js/core/vbxe.js:421-429`. | Obtain a conclusive physical or visual differential before changing it. |

Therefore the official state is **practical compatibility yes, complete
AHRM compliance no**. The native core implements stages 1 and 2 of the device
(registers, VRAM, MEMAC, blitter, XDL, overlay, attribute map, no hires output
plane); this device audit applies to the JavaScript core.

Conclusion: jsA8E has a functional base and relevant diagnostics, but does not
yet replicate every element of the device. The active pending items are to
close the full crossing of modes/transparency/map, validate the physical order
and the cycle-by-cycle consumption of MEMAC/blitter, complete the
browser/Altirra differential and decide the separate implementation for the
native core.

## Support matrix

This is the JavaScript device contract. `test:vbxe:full` runs the listed
regression families; `test:vbxe` remains the faster historical subset.
“Differential” means a deterministic diagnostic was also compared with Altirra
where that comparison is meaningful.

| Area | Implemented contract | Coverage | Remaining boundary |
| --- | --- | --- | --- |
| Configuration/registers | FX 1.20/1.24/1.26, both pages, revisions, reset, VSync latches, palette and snapshots | `vbxe_device_state`, `vbxe_fx124_priority_probe_*` | Register edge-bit audit, milestone 4 |
| MEMAC | CPU/ANTIC A and B, A-over-B, Ultimate1MB precedence | `vbxe_memac_a_xex`, `vbxe_memac_b_xex`, `vbxe_memac_priority_xex`, `vbxe_register_snapshot` | Active-blit contention, milestone 4 |
| XDL | Standard/lores/hires/text, repeat (including terminating `END` entries), palette, transparency, scroll and priority | `vbxe_device_state`, `vbxe_xdl_hires_asm`, `vbxe_xdl_text_asm`, `vbxe_xdl_text_scroll_asm`, `vbxe_xdl_text_transparency_asm` | Full transition cross-product, milestone 3 |
| Attribute map | Geometry, scroll/overscroll, PF1-3, reverse, text attributes and reload | `vbxe_xdl_attrmap_asm`, `vbxe_attrmap_pf12_boot`, `vbxe_attrmap_pf3_boot`, `vbxe_attrmap_reverse*_boot` | Non-reversed GTIA-special PF3 mask |
| Collision/priority | FX priority, `COLMASK`/`COLDETECT`, text attribute source, GTIA-special P0+P1/P5 | `vbxe_priority_collision_matrix`, `vbxe_fx124_priority_probe_*`, `vbxe_xdl_*collision_probe_*`, `vbxe_xdl_p5_multicolor_probe_*` | Scene differentials for remaining transparency/map combinations, milestone 3 |
| Blitter/IRQ | Blocks, modes 0-6, lists, zoom, collisions, snapshots, stop, level IRQ and in-line completion placement | `vbxe_blitter_state`, `vbxe_blitter_copy_*`, `vbxe_blitter_irq_*` | Exact arbitration, milestones 2/4 |
| Blitter timing | 912 slots, 21-slot load, fixed 22-cycle XDL updates, aggregate overlay/map/MEMAC reservations | `vbxe_blitter_*timing_*`, `vbxe_blitter_attrmap_restart_timing_*`, `vbxe_blitter_attrmap_phase_*` | Fresh Altirra phase-pair capture, milestone 2 |

## Reverse / GTIA differential status

The following FX 1.26 attribute-map Reverse cases have been compared against
Altirra 4.40 using the reproducible diagnostics in `AHRM Validation`:

| ANTIC source | GTIA 9 | GTIA 10 | GTIA 11 |
| --- | --- | --- | --- |
| hires 2/3/F | opaque palette color 0 | opaque palette color 0 | opaque palette color 0 |
| lores characters 4/5 | opaque palette color 0 | measured nibble path | opaque palette color 0 |
| selector characters 6/7 | opaque palette color 0 | opaque palette color 0 | opaque palette color 0 |
| graphics 8-E | opaque palette color 0 | opaque palette color 0 | opaque palette color 0 |

For modes 4/5 in GTIA 10, two adjacent two-bit values form a raw nibble:
measured nibble 1 selects mapped PF0, while measured 2, 3 and `$B` select
palette color 0. All graphics 8-E cases in GTIA 9/10/11 produce opaque
palette color 0 throughout the mapped field. Mode D diagnostics use 96 ANTIC rows
(two scanlines each), avoiding a second unmapped 192-line field.

The compatibility target includes VBXE FX 1.20, 1.24, and 1.26 profiles in either the `$D600` or
`$D700` device range, whose register banks are respectively
`$D640-$D65F` and `$D740-$D75F`. The browser selector persists the choice and
rebuilds the machine when it changes; the device is disabled by default. The
FX 1.20/1.24 use the documented legacy priority map: `$00` wins over a plain
background, bit 6 controls PF2, and bit 7 controls PF3/P5. FX 1.26 retains
the newer full priority map. `VBXE_FX124_PRIORITY_PROBE.XEX` has externally
validated the FX 1.20 and 1.24 background/PF2/bit-6 sequence against Altirra
4.40; RGB shades can differ with the selected NTSC palette.

## Emulation approach

VBXE is an FPGA board, but A8E does **not** emulate its FPGA gates or load an
FPGA bitstream. It emulates the externally observable device specified by a
selected core revision:

- 512 KiB of local VRAM;
- the VBXE register bank and reset-visible state;
- CPU and ANTIC memory-access windows (MEMAC);
- XDL parsing and per-scanline overlay/attribute-map output;
- palette, priority, transparency, and collision behavior; and
- the blitter state machine, local-memory bandwidth, and completion IRQ.

This is the same behavioral approach used for ANTIC, GTIA, and POKEY. Guest
software supplies its own XDL and VBXE setup code in its executable; it does
not require an external ROM or FPGA firmware image from the user.

VBXE runs in parallel with ANTIC and GTIA. ANTIC remains the owner of display
timing, VBI, and DLI. VBXE observes GTIA writes to reproduce the standard
playfield before applying its extensions, but reads of GTIA registers and the
normal GTIA collision latches remain owned by GTIA.

The common conceptual state for the JavaScript and native implementations is:

```text
configuration: enabled, registerPage, coreProfile
memory:        vram[512 KiB]
registers:     write latches, readable registers, pending XDL address
video:         active XDL state, per-line overlay/attribute-map state,
               four 256-entry RGB palettes, collision state
memory map:    MEMAC A and B configuration
blitter:       list address, load/active/idle state, IRQ state, progress
```

State must be snapshot-safe. A snapshot restores VRAM, all latched/pending
register values, active XDL line state, MEMAC state, palette contents,
collision latches, and an in-progress blit. A plain reset must follow the
documented reset behavior; a power cycle additionally creates the defined
power-on VRAM and palette state. The two must not be accidentally treated as
the same operation.

## Register and I/O model

VBXE exposes a 32-byte register bank at `$Dx40-$Dx5F`, initially with `x=6`.
Thus Altirra's `$D600-$D6FF` device selection places the registers at
`$D640-$D65F`, while `$D700-$D7FF` places them at `$D740-$D75F`. The selected
page is a machine configuration property, not something inferred from a guest
access. Reads and writes have different meanings for much of the bank, so
handlers must dispatch by access direction rather than treating it as ordinary
RAM.

| Range | Read behavior | Write behavior |
| --- | --- | --- |
| `$Dx40-$Dx48` | revision information where defined | video control, pending XDL address, palette selection and RGB latches |
| `$Dx49-$Dx4A` | overlay collision detection | collision mask and clear strobe |
| `$Dx50-$Dx54` | blitter collision/status and IRQ status | blitter-list address, start/stop, IRQ control |
| `$Dx55-$Dx58` | no device readback defined | attribute-map overlay-priority registers P0-P3 |
| `$Dx5D-$Dx5F` | readable MEMAC A state where defined | MEMAC A/B configuration |

The exact reset values, read-only bits, ignored bits, and deferred effects are
part of the conformance tests. `XDL_ADR0-2` and the XDL-enable bit of
`VIDEO_CONTROL` are buffered until vertical sync; the extended-color and
transparency bits of `VIDEO_CONTROL` apply immediately. A write must not
change the active XDL halfway through a frame.

`VIDEO_CONTROL` D2 has the polarity Altirra implements
(`mbOvTrans = (value & 4) == 0`): with D2 clear, which is the reset value,
overlay color 0 is transparent; with D2 set the overlay is opaque. D3 adds
color `$F` (hires) or `$xF` (lores/standard) to the transparent set, and only
takes effect while D2 is clear. The AHRM prose describes D2 the other way
round; real software (the D600 demo and Popeye both write `VIDEO_CONTROL=3`
and rely on an all-zero overlay being see-through) matches Altirra, and the
implementation follows it (`overlayTransparency` in `vbxe.js`).

The I/O layer must also notify VBXE of GTIA writes. It must do so without
intercepting GTIA reads or altering existing GTIA access timing.

## Local VRAM and MEMAC

VRAM is a `512 * 1024` byte local store addressed on 19 bits. It is not an
Atari RAM expansion and must not be represented as normal main RAM.

MEMAC is the bridge into that VRAM:

- MEMAC A maps a 4, 8, 16, or 32 KiB CPU/ANTIC window at a 4 KiB Atari-memory
  boundary. Its Atari address may be unaligned to the selected window size;
  its VRAM address is aligned to that size.
- MEMAC B maps one 16 KiB CPU and/or ANTIC window at `$4000-$7FFF`;
  its CPU read/write enable is bit 7 and its ANTIC-DMA enable is bit 6.
  (The AHRM prose lists D7 as ANTIC and D6 as CPU; like `VIDEO_CONTROL` D2,
  this follows Altirra, which Mr. Proper and other real software rely on.)
- MEMAC A wins when both windows match.
- Neither window may override hardware I/O, ROM, or cartridge space. It only
  overlays eligible system RAM.
- CPU and ANTIC enables are independent. ANTIC DMA must therefore use the
  VBXE mapping only when ANTIC access is enabled, not merely because the CPU
  sees the window.
- CPU instruction fetch goes through the window too. Software may execute
  code that lives in VRAM (Popeye decompresses its game code into an 8 KiB
  MEMAC A window at `$9000-$AFFF` and jumps into it). The CPU core fetches
  opcodes from `ctx.ram`, so `installIoHandlers` publishes `vbxeFetchMask`
  (the addresses a CPU-enabled window routes to VRAM) and `run`/`executeOne`
  stage the three instruction bytes from VRAM into `ctx.ram` for the duration
  of that instruction, restoring them afterwards.
- Moving or disabling a window must return every address it stopped covering
  to plain RAM, and writing the MEMAC registers must only reinstall the
  windows (`syncVbxeWindows`); rebuilding the whole memory map there reloads
  RAM hidden under the OS ROM from a stale shadow and discards bytes the CPU
  has just written.

The mapping order must be explicit and tested against existing 130XE,
RAMBO/COMPY, and Ultimate1MB windows. In particular, the AHRM specifies that
the Ultimate1MB extended-memory window takes precedence over MEMAC, whereas a
130XE extended-memory window can be overlaid by MEMAC. This cannot be solved
by a generic "last mapper wins" rule.

## Video pipeline

At the beginning of vertical sync, latch `VIDEO_CONTROL` and the XDL address.
If XDL is enabled, begin interpreting the XDL at scanline 8. It restarts every
frame from the latched VRAM address; it does not need an ANTIC-style jump.

For every scanline the completed model must:

1. Preserve the ANTIC/GTIA pixel and layer-priority information already
   generated for that line.
2. Advance the XDL, including its optional repeat, overlay-address,
   scroll, character-base, attribute-map, and miscellaneous blocks.
3. Fetch the applicable overlay data from VRAM.
4. Render the selected overlay mode: 320-pixel standard graphics,
   160-pixel lores graphics, 640-pixel hires graphics, or 80-column text.
5. Apply palette selection, color-zero / `$F` transparency rules, and XDL or
   attribute-map priority.
6. Composite the overlay with the captured GTIA layers and update VBXE's
   overlay collision latch when enabled.

The compositor must consume layer identifiers rather than only final GTIA RGB
values: VBXE priority is defined against background, PF0-PF3/P5, and P0-P3.
For FX 1.26, the background, PF0, PF1, PF2/PF3/P5, and player bits have the
priority meanings specified by AHRM. FX 1.20/1.24 retain their distinct two-bit
PF2/PF3/P5 map, selected by the device profile rather than call-site conditionals.

The current renderer keeps the ANTIC/GTIA path intact and applies the XDL
overlay as a final, per-line composition pass. It must not make VBXE a
replacement for ANTIC, GTIA, DLI, or VBI. Standard/lores overlay rendering
still uses the legacy centered 256-pixel (4:5) compositor aperture, while
hires uses its native 640-pixel plane. Attribute-map playfield overrides now
also use that native plane: a normal ANTIC field spans its documented 320
physical pixels and is written as 640 presentation samples, rather than being
reduced through the 256-pixel aperture. Hires unpacks source bytes MSB-first into 4-bit palette
indices; transparency applies to color 0 and `$F` (hires) or `$xF`
(standard/lores), while `COLMASK` still uses the complete source byte as
specified by the AHRM. Standard and lores geometry are externally validated
against Altirra. Hires graphics and text now use a separate 672-pixel
presentation plane so their 640-pixel normal-width signal is not reduced to
the 256-pixel Atari compositor aperture; text transparency and scroll
diagnostics match Altirra's internal pattern density and phase, and text
collision uses the externally verified attribute byte. Fullscreen
canvas aspect and margins remain host-presentation choices, not VBXE signal
differences. The initial text
renderer draws 80 columns from 8x8 local-VRAM fonts, honoring
character/attribute foreground colors and the documented transparent versus
opaque background.

## Attribute map and collisions

Attribute maps are per-cell overrides for palette, priority, display controls,
and text attributes. They can use cells from 8x1 through 32x32 standard
resolution pixels. The initial implemented subset parses `AtMapOn`/`AtMapOff`,
the map address/stride, scroll and cell layout. For each active cell it selects
P0-P3 priority, overrides the overlay palette, and reports an attribute-map
collision for a non-transparent overlay pixel. The documented 43-cell
line-buffer limit is enforced. The map-cell decoder retains the PF0/PF1/PF2
values, playfield palette, and reverse bit from the exact four-byte hardware
block.
The first integration subset applies per-cell PF0-PF2 colors from the selected
VBXE playfield palette only to visible normal playfield pixels, after the
existing P/M composition. In non-reversed ANTIC hires modes 2, 3, and F, byte
0 is instead sampled as the documented PF3 mask: a set bit replaces visible
PF2 with palette-selected GTIA PF3 at 1/2/4 pixels per bit according to
map-cell width. GTIA-special combinations remain pending.
In a reverse mode-F cell, two adjacent saved
ANTIC bits select PF0, PF1, PF2, or GTIA PF3 respectively; byte 0 is then
again the palette-selected PF0 override rather than a PF3 mask.
The mode-F reverse diagnostic has matched Altirra for PF0-PF3 order, phase,
and doubled-pixel width. The mode-2 character diagnostic applies the same
AHRM-defined pair mapping to decoded glyph bits. In a reverse
mode-4-E lores cell, the saved two-bit lores
value yields two hires pixels on the PF2 base; a set bit substitutes the PF1
luminance while preserving PF2 hue. This derives directly from AHRM's
"lores data is reinterpreted as pairs of hires pixels" rule, rather than from
the appearance of any one emulator.

Altirra differential scenes confirm 8x8 palette cells, map-row stride, and
ordinary horizontal/vertical scrolling. Scroll values are stored in the XDL as
pixel counts minus one; zero map scroll is therefore the VSync default and is
retained by omitting the optional layout block. Differential checkerboards
also confirm the partial first cell and continuing phase when the scroll is
greater than an 8-pixel cell dimension.

VBXE overlay collisions are separate from GTIA collision latches:

- `COLMASK` enables overlay source-value ranges;
- `COLDETECT` accumulates collisions with visible GTIA layers and the
  attribute map;
- `COLCLR` clears only VBXE collision detection;
- normal GTIA collision registers stay unchanged by VBXE features.

Collision evaluation depends on the composed visibility and priority rules;
it cannot be accurately implemented as a raw bitmap-overlap test.

## Blitter and timing

The blitter is a state machine that loads a blit control block from VRAM,
performs the documented source/destination and logical operations, can be
stopped, records its first collision code, and sets completion `IRQ_STATUS`
when enabled. Completion is a level-sensitive shared CPU IRQ source until a
write to `IRQ_CONTROL` clears it.

`BLITTER_BUSY` reports the phase exactly: bit 0 while a control block is
loading, bit 1 while it processes data, and zero only when idle. Guest polling
must wait for both bits to clear.

It has lower local-memory priority than display, XDL/attribute-map, and MEMAC
accesses. The scheduler gives each scanline its documented 912 local-bus cycles
and charges the 21-cycle block load plus the AHRM mode/source-dependent one-,
two-, or three-cycle output cost. It reserves the documented per-line overlay,
XDL, attribute-map, and observed CPU/ANTIC MEMAC accesses before giving the
residue to the blitter. Overlay claims are limited to the active horizontal
interval (160 local cycles for lores, 320 for standard/hires, and 243 for
text) in the current Altirra-aligned aggregate scheduler. A new XDL entry
claims the fixed AHRM update cost of 22 local cycles; repeated lines claim no
XDL update. A buffered attribute-map row claims 172 local cycles, including an
reload after `AtMapOn` or a map-address change. A completed machine-driven
blit schedules its level IRQ at line end minus the remaining local slots
divided by eight, rather than exposing it artificially at line start.

The no-wrap baseline and overlay probes provide the prior coarse Altirra
calibration. The continuous/restarted attribute-map pair is now the decisive
fine-phase differential: it compares the in-line blue/red edge and persistent
completion field without relying on two-line `VCOUNT` buckets. A future
phase-exact local arbiter must be justified by a mismatch in that deterministic
pair; the aggregate scheduler is not a claim about individual DMA-slot order.

The paired differential uses the
`VBXE_BLITTER_ATTRMAP_PHASE_CONTINUOUS_TEST.XEX` and
`VBXE_BLITTER_ATTRMAP_PHASE_RESTART_TEST.XEX` diagnostics. Each makes local
`$00000` (the visible Graphics-8 source) uniformly `$FF`, stores its XDL at
local `$02000`, supplies a repeated opaque standard-overlay row from `$28000`,
and clears the complete 4 KiB attribute-map region at `$22000`. The equal
512-by-64 mode-0 transfer goes from `$30000` to non-visible `$10000`. Its
final map-off XDL entry repeats past the active field, so an XDL vertical-end
boundary cannot be mistaken for a blitter phase edge. The opaque entry is
palette 1/color `$FF`; each DLI reselects that
color because a `CB` write auto-increments `CSEL`, paints it blue, and the
completion IRQ repaints it red. One DLI/blit cycle runs every frame, making
the red/blue boundary stable for an external capture. Thus the intended edge
is contained in one known composed plane rather than an accidental mix of
GTIA and overlay output.
Earlier versions wrote the transfer into the visible source and left the map
uninitialised; their black/striped or varying Altirra captures are explicitly
invalid and must not be used for timing. The current wrapper binaries are
checked for reproducible assembly by `vbxe_blitter_attrmap_phase_asm.test.js`.
The map-off entry lasts beyond the visible field in both forms, removing the
earlier black XDL-end artifact. Fresh Altirra captures have the same stable
red/blue/red scanline geometry in both forms. This validates the aggregate
scheduler at whole-line resolution; it does not claim individual DMA-slot
accuracy.

### Phase-pair capture protocol

Use Altirra 4.40 with its internal VBXE device enabled as FX 1.26 at the
`$D640` page. Run each current wrapper from a fresh machine start:

1. `VBXE_BLITTER_ATTRMAP_PHASE_CONTINUOUS_TEST.XEX`.
2. `VBXE_BLITTER_ATTRMAP_PHASE_RESTART_TEST.XEX`.

Wait until the program reaches its stable loop. A valid first cycle has
`POLLSEEN` at `$0084`, `IRQSEEN` at `$0083`, and `INITIAL` at `$0086` nonzero.
The repeated capture shows a stable red/blue/red field: the frame's lone DLI
sets blue and the completion IRQ sets red. Capture both wrappers without
changing video settings between runs. Discard a capture that is black, striped,
or lacks both colors.

Compare the transition's scanline and horizontal position between wrappers,
not RGB shade or the raw two-line `VCOUNT` bucket. The restarted-map case
forces an additional buffered map reload; any jsA8E adjustment must follow a
repeatable mismatch in this pair and identify whether it belongs to XDL, map
reload, MEMAC, or completion-IRQ scheduling. The current Altirra pair has no
whole-line displacement, matching jsA8E's aggregate scheduler. A distinct
horizontal marker would be needed before changing the model for a sub-line
claim.

MEMAC accesses now leave a trace with type, AHRM phase, CPU cycle and
candidate local slot. `localBusBudget()` keeps those slots when the caller
provides the start of the scanline; the trace is meant to feed a horizontal
differential, but it is not by itself an Altirra measurement.

## Implementation status and next steps

### Historical roadmap summary

The detailed, current roadmap is [`VBXE_ROADMAP.md`](VBXE_ROADMAP.md). The
summary below is retained as a compatibility record for the implementation
history.

The project closes VBXE capability through the following ordered milestones.
Each behavior change needs an AHRM-backed contract and automated coverage;
visual or timing behavior also needs an Altirra differential. Altirra is a
behavioral reference and never substitutes for an AHRM-defined rule or a
physical-device result.

1. **Consolidate the current contract.** Keep this document, `NOTES.md`, the
   register model, and the tests aligned. Maintain one support matrix covering
   register, XDL mode, FX profile, GTIA mode, collision, timing, and its test.
   Exit criterion: documentation and tests describe the same model.
2. **Close blitter timing.** Re-run the corrected continuous/restarted
   attribute-map phase pair in Altirra. Compare both the blue/red in-line edge
   and the persistent completion field. If it differs, isolate XDL, map
   reload, MEMAC, or IRQ timing in a dedicated diagnostic before changing the
   scheduler. Introduce finer arbitration only when that evidence requires it.
   Exit criterion: baseline, overlay, continuous-map, and restarted-map
   timings have reproducible, defined Altirra agreement.
3. **Complete XDL and attribute-map combinations.** Cover graphics and text
   modes with repeat, scrolling, transparency, priority, map transitions,
   map geometry, overscroll, XDL end, and VSync. Exercise the documented FX
   1.20/1.24/1.26 priority and collision distinctions. Exit criterion: every
   supported combination has a deterministic XEX and state or image
   assertion.
4. **Complete MEMAC, registers, and IRQ behavior.** Test CPU/ANTIC/VBXE
   contention, MEMAC A/B overlap, register reset/read/write/latching rules,
   both register pages, blitter stop/restart and linked lists, completion
   acknowledgement, and snapshots during active work. Exit criterion: no
   implemented register or timing path remains covered only by assumption.
5. **Validate real software and close.** Run a curated suite of VBXE software
   using graphics, 80-column text, attribute maps, and linked blitters, then
   compare stable behavior and captures with Altirra. Document intentional
   limitations and unresolved physical-hardware differences. Exit criterion:
   the device runs useful real software stably and `test:vbxe` covers the
   implemented contract. The first external launch gates are Popeye, Galaga,
   DACTest, Textmode Test, and Crysis (all FX 1.26). Popeye, Galaga, and
   Crysis establish real-software loading and sustained execution; DACTest
   reaches its self-test menu and Textmode Test reaches its 80-column mode
   menu. The jsA8E gate selects all four Textmode Test entries and confirms
   each changes the rendered output. A second sustained-execution gate covers
   the supplied Celeste, D600 demo, Falcon, and Phoenix XEXs under FX 1.26.
   Image equivalence and selected text/attribute-map/blitter software cases
   remain required. The current headless launch gates still use
   `runXex({ awaitEntry: false })` and assert cycle advancement. The headless
   harness also has a passing direct-XEX RAM-marker regression
   (`vbxe_xex_scene_marker`) and a visual progress gate
   (`vbxe_real_software_scene`) that checks 120/240/360/480-frame checkpoints,
   requires a non-black frame, and rejects any digest seen in the reset
   checkpoints for five corpus members. Galaga remains boot-covered because
   its headless capture is black; Celeste, D600 and Phoenix remain boot-covered
   because their captures match the reset-frame set. These cases are explicitly
   pending a scene marker, but their 64 KiB RAM execution markers now pass.
   This proves observable progress for the passing cases, but not a
   program-specific marker or image equivalence. The same corpus was then loaded
   through the live Chromium/CDP instance: WebGL2 produced non-black captures,
   and Textmode Test changed its digest after selecting mode 4. This browser
   path is valid evidence of rendering, but it is not yet an Altirra
   comparison or a committed golden baseline. The browser backend gate now has
   a persisted provisional baseline at
   `jsA8E/tests/fixtures/vbxe_browser_golden.json`; it is an internal
   regression oracle, not an Altirra reference. The remaining headless work is
   to connect equivalent markers to each real-software case.

Whole-line blitter/attribute-map timing now has matching, interpretable
Altirra captures. The remaining boundary for a phase-exact claim is a
horizontal marker capable of resolving individual local-bus slots.

Completed in JavaScript:

1. Disabled-by-default configuration, state, VRAM, reset/power-cycle rules,
   snapshots, FX 1.20/1.24/1.26 revision reads, and both supported register pages.
2. MEMAC A/B CPU and ANTIC mapping, including A-over-B priority and Ultimate1MB
   precedence.
3. Palette programming (including AHRM palette-0 power-up initialization),
   vertical-sync latching, the minimal XDL decoder, and standard/lores/hires
   graphics overlays.
4. The first XDL transparency and priority composition subset, including
   per-cell attribute-map overlay palette/P0-P3 priority/collision handling.
5. Functional interim blitter lists, operations, collision-code status,
   linked-list control, stop, snapshots, completion-status latching, and
   level-sensitive completion IRQ delivery to the CPU.
6. Browser selection for FX 1.20/1.24/1.26 at `$D600` or `$D700`. VBXE uses
   the worker OffscreenCanvas when the worker is selected, with the main-thread
   and Canvas 2D paths retained as fallbacks.

The functional compatibility milestone is satisfied for the current JavaScript
device: the selectable FX profiles, XDL/attribute-map paths, MEMAC, blitter,
and completion IRQ have deterministic regressions. The supplied FX 1.26
software corpus now has launch/cycle-advance gates plus a reset-difference
visual progress gate; the visual-equivalence milestone remains open until
program-specific markers and an Altirra golden comparison exist. See
`VBXE_ROADMAP.md` for the ordered stages and exit criteria.

Still pending:

1. Phase-exact attribute-map buffered-fetch timing and the remaining temporal
   cross-product. The map now follows narrow/normal/wide geometry, the
   XDL overlay/attribute address/stride latches survive VSync restarts, and
   the covered PF3/GTIA changes are rebuilt by spans within a line. Remaining
   work is composing VBXE map-register changes and all overlay hires/text
   combinations in the same line, then matching the AHRM buffered-fetch
   phases. The documented PF3 mask now covers ANTIC hires sources 2, 3, and F;
   attribute-map scrolling and overscrolling have Altirra differentials; the
   text renderer covers 80-column character/attribute pairs with 8x8 local
   fonts, and `COLMASK` uses the externally verified attribute byte for text
   collisions. The decoder also retains text `ChBase`, scroll offsets, and its
   8-line character-row cadence.
2. Exact collision/priority differentials for remaining scene combinations
   involving transparency, attribute maps, and mode transitions. The
   deterministic profile/contributor matrix and the measured P0+P1/P5
   GTIA-9/10/11 samples now pass in the supported FX profiles.
3. Canvas 2D/browser coverage beyond the WebGL2 CDP gate. The repository now
   has `npm run test:vbxe:browser`, which compares worker and main-thread
   screenshots for both WebGL2 and forced Canvas2D when Chromium is available;
   a provisional persisted golden baseline is now checked; the Altirra visual
   differential remains open and can be supplied through `A8E_VBXE_REFERENCE`.
4. Differential validation of blitter local-memory arbitration. The AHRM
   22-cycle XDL update contract and a 912-slot phase schedule are implemented;
   read/write MEMAC phase assignment is implemented; the horizontal ordering
   differential remains open.
5. Native A8E VBXE implementation. The functional device audited here is the
   JavaScript core. The native core has stages 1 and 2 (`A8E/Vbxe.c`: registers, VRAM,
   palette latches, MEMAC A/B for CPU/ANTIC/instruction fetch, blitter and its
   IRQ; `A8E/VbxeVideo.c`: XDL, overlay, priority/collisions, playfield
   palettes, attribute map, aggregate XDL/overlay/map slot accounting; covered
   by `A8E/tests/vbxe_probe.c`). Still missing natively: a 640-wide output
   plane (hires/text overlays average each pixel pair into one standard pixel), mid-line
   GTIA replay, the reverse attribute-map combinations with GTIA special modes, per-slot (not aggregate) local-bus scheduling, the FX 1.26r RAMBO
   profile, snapshots and a UI selector. JavaScript FX 1.26r RAMBO behavior is
   already covered by `vbxe_rambo_bus`.

Every later step needs a shared behavioral contract and automated coverage;
visual behavior additionally needs an Altirra differential diagnostic.

## Validation without physical VBXE hardware

[Altirra](https://www.virtualdub.org/altirra.html) is the differential
reference emulator. Configure its internal `VideoBoard (VBXE)` device, select
the same register page and FX profile, and run the same deterministic XEX in
both emulators. Altirra is a reference, not proof that two independent models
match a physical board, so AHRM remains the source of intended behavior.

Tests are to be self-contained XEX diagnostics plus host assertions:

- register reset, revision, read/write, and vertical-sync-latching tests;
- CPU and ANTIC MEMAC read/write tests, including overlap precedence;
- small XDL scenes for each width, graphics mode, palette, transparency, and
  priority combination;
- deterministic frame captures after a fixed number of frames, compared as
  RGB output and layer/collision state where available;
- attribute-map and overlay-collision cases; and
- blitter output, busy/load states, stop/restart, IRQ, and cycle-count tests.

Store generated diagnostics and their expected behavior under
`implementation/AHRM Validation/` only after their target behavior has been
verified against AHRM. Use Altirra differential runs to expose discrepancies,
but do not replace an AHRM-defined rule merely to duplicate an emulator's
output. Do not mark a result as hardware-certified without a physical-device
comparison.

## Explicit non-goals for the first milestone

- Gate-level FPGA or FPGA-bitstream emulation.
- A required user-supplied VBXE ROM/firmware asset.
- Changing ANTIC's VBI/DLI ownership or GTIA's existing collision registers.
- Claiming precise blitter throughput before local-memory arbitration exists.
- Enabling the device by default or silently changing base Atari behavior.

### Deliberate deviations from the AHRM prose

Both follow Altirra 4.40 and are required by real VBXE software; each is a
hardware-level rule, not a per-title workaround.

- `VIDEO_CONTROL` D2: clear makes overlay color 0 transparent.
- `MEMAC_B_CONTROL`: D7 is CPU enable, D6 is ANTIC enable.

Blitter collision masks follow the AHRM: bit n covers destination values
`$20n-$20n+1F` (`$00` is transparent), so `$20` belongs to bit 1.
`BLITTER_START` executes the rest of the current scanline's free local-bus
budget at once (the AHRM only states that the blitter then runs
concurrently); display DMA of that line is subtracted first.
