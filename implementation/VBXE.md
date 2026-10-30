# VBXE — design and implementation status

> Hardware reference: use [AHRM chapter 12.4, VideoBoard XE](/AHRM/12.%20Internal%20devices/4.%20VideoBoard%20XE.md) before changing this design or implementing VBXE behavior.

## Status

The JavaScript core implements an optional FX 1.26 device with revision reads,
`$D640`/`$D740` register decoding, 512 KiB VRAM, palette/write latches,
vertical-sync latching, soft reset, MEMAC state, and snapshot persistence.
On power-up palette 0 is initialized from the current GTIA colors; soft reset
leaves all palettes unchanged, as required by AHRM.
MEMAC CPU accesses only replace RAM-mapped addresses; ANTIC DMA reads use VRAM
when their separate enable bit is set, except where Ultimate1MB owns its
extended-memory window.

The first XDL milestone is also implemented. At vertical sync the core latches
the video control and XDL address, parses the per-line descriptor subset used
by the diagnostics, and composes standard, lores, and hires graphics overlays into a
separate RGB plane. The implemented compositor supports palette selection,
color-0 and color-`$xF` transparency, and the initial FX 1.26 XDL priority mask
against the existing Atari per-pixel priority metadata. This scope has focused
device/XEX regression coverage and documented Altirra differential runs. The
native core remains planned.

The same graphics subset now latches `COLDETECT` for enabled `COLMASK`
source-byte ranges against PF0-3/P5 and P0-3 layer metadata. `COLCLR` clears
the latch without changing GTIA collision registers. GTIA P/M composition now
also records a per-pixel final-contributor plane, so P/M graphics hidden by
`PRIOR` bits 0-5 are excluded from both this collision subset and XDL priority
comparison. The complex P5/multicolor and GTIA-special-mode combinations
still need Altirra differential coverage. The initial attribute-map renderer
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
palette color 0 after their raw-pair validity check. The remaining
GTIA-special source-mode composition combinations are not yet implemented.
The separately validated lores-character subset is narrower: ANTIC modes 4/5
in GTIA mode 10 pack two two-bit sources as a raw nibble; measured nibble 1 selects the
attribute cell's PF0 and measured nibbles 2, 3, and `$B` select palette color
0. In the equally focused mode-4/5 probes, GTIA modes 9 and 11 produce opaque
palette color 0 for valid lores sources. No other lores/GTIA-special
combination is inferred from these rules.
For the separately measured mode-6/7 selector-character sources in GTIA mode
10, valid reverse source values instead produce opaque palette color 0. Other
mode-6/7 GTIA-special combinations remain unimplemented.

The compatibility target is the VBXE FX 1.26 profile in either the `$D600` or
`$D700` device range, whose register banks are respectively
`$D640-$D65F` and `$D740-$D75F`. The browser selector persists the choice and
rebuilds the machine when it changes; the device is disabled by default. The
FX 1.24 profile remains compatibility work and must be selectable without
duplicating the device implementation.

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

## Device state

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
part of the conformance tests. In particular, `VIDEO_CONTROL` and
`XDL_ADR0-2` are buffered until vertical sync; a write must not change the
active XDL halfway through a frame.

The I/O layer must also notify VBXE of GTIA writes. It must do so without
intercepting GTIA reads or altering existing GTIA access timing.

## Local VRAM and MEMAC

VRAM is a `512 * 1024` byte local store addressed on 19 bits. It is not an
Atari RAM expansion and must not be represented as normal main RAM.

MEMAC is the bridge into that VRAM:

- MEMAC A maps a 4, 8, 16, or 32 KiB CPU/ANTIC window at a 4 KiB Atari-memory
  boundary. Its Atari address may be unaligned to the selected window size;
  its VRAM address is aligned to that size.
- MEMAC B maps one 16 KiB CPU and/or ANTIC window at `$4000-$7FFF`.
- MEMAC A wins when both windows match.
- Neither window may override hardware I/O, ROM, or cartridge space. It only
  overlays eligible system RAM.
- CPU and ANTIC enables are independent. ANTIC DMA must therefore use the
  VBXE mapping only when ANTIC access is enabled, not merely because the CPU
  sees the window.

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
priority meanings specified by AHRM. FX 1.24 differs in bits 6-7, so that
difference belongs in the profile table rather than in call-site conditionals.

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
diagnostics match Altirra's internal pattern density and phase. Fullscreen
canvas aspect and margins remain host-presentation choices, not VBXE signal
differences. The initial text
renderer draws 80 columns from 8x8 local-VRAM fonts, honoring
character/attribute foreground colors and the documented transparent versus
opaque background. Text scroll diagnostics match Altirra; text collision and
the initial attribute-map subset still need their own visual differential
coverage.

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
existing P/M composition. In non-reversed Graphics 8 / ANTIC mode F, byte 0
is instead sampled as the documented PF3 mask: a set bit replaces visible PF2
with palette-selected GTIA PF3 at 1/2/4 pixels per bit according to map-cell
width. GTIA-special modes and other source-mode combinations remain pending.
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

The blitter is not a host-side bulk copy. It is a state machine that loads a
blit control block from VRAM, performs the documented source/destination and
logical operations, can be stopped, records its first collision code, and
raises a maskable completion IRQ when enabled.

It has lower local-memory priority than display, XDL/attribute-map, and MEMAC
accesses. The eventual timing model therefore needs a local eight-phase memory
arbiter: MEMAC accesses occupy their documented odd phases, display fetches
their even phases, XDL/attribute-map fetches preempt the blitter, and the
blitter consumes only remaining phases. This is postponed until after
functional rendering and register/MEMAC compatibility; a simplistic immediate
copy is permitted only in an explicitly marked interim implementation and
must not claim timing accuracy.

## Implementation status and next steps

Completed in JavaScript:

1. Disabled-by-default configuration, state, VRAM, reset/power-cycle rules,
   snapshots, FX 1.26 revision reads, and both supported register pages.
2. MEMAC A/B CPU and ANTIC mapping, including A-over-B priority and Ultimate1MB
   precedence.
3. Palette programming (including AHRM palette-0 power-up initialization),
   vertical-sync latching, the minimal XDL decoder, and standard/lores/hires
   graphics overlays.
4. The first XDL transparency and priority composition subset, including
   per-cell attribute-map overlay palette/P0-P3 priority/collision handling.
5. Browser selection for FX 1.26 at `$D600` or `$D700`. VBXE intentionally
   uses the main-thread runtime because the worker presentation path does not
   yet transfer the extra RGB plane.

Still pending:

1. Text collisions and the remaining attribute-map semantics: reverse mode
   for GTIA-special and other unimplemented lores sources, non-mode-F
   PF3/source-mode behavior, exact
   scrolling/overscrolling, and
   buffered-fetch timing. The initial text renderer covers 80-column
   character/attribute pairs with 8x8 local fonts; the decoder also retains
   text `ChBase`, scroll offsets, and its 8-line character-row cadence.
2. Exact collision/priority coverage for remaining GTIA special-mode, P5,
   multicolor, and profile combinations.
3. Blitter operations, local-memory arbitration, IRQ behavior, and timing.
4. FX 1.24 profile differences, optional RAMBO behavior, and native-core
   implementation.

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
