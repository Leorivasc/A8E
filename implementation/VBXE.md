# VBXE — design and implementation status

> Hardware reference: use [AHRM chapter 12.4, VideoBoard XE](/AHRM/12.%20Internal%20devices/4.%20VideoBoard%20XE.md) before changing this design or implementing VBXE behavior.

## Status

The project roadmap, milestone exit criteria, diagrams, and validation gates
are maintained in [`VBXE_ROADMAP.md`](VBXE_ROADMAP.md). This file remains the
technical contract and support matrix; the roadmap is the canonical source for
work ordering and completion status.

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

## Audit de cobertura — 2026-11-03

La auditoría de limpieza de esta revisión no detectó funciones VBXE muertas ni
exports retirables. Las rutinas expuestas de blitter, snapshots y diagnóstico
MEMAC siguen siendo consumidas por el runtime o por regresiones; se eliminaron
únicamente tablas literales duplicadas y una rama redundante del scheduler.

Esta auditoría compara AHRM 12.4 con `vbxe.cpp` de Altirra 4.40 y con las
rutas efectivas de jsA8E. No equivale a que los actuales gates de arranque
sean verdes: varios ejercitan sólo un subconjunto y algunos codifican el
comportamiento actual en vez del comportamiento de referencia.

| Área | Resultado | Diferencia comprobada |
| --- | --- | --- |
| VRAM, registros básicos, páginas, MEMAC A/B, paleta, IRQ y bloques del blitter | Parcialmente replicada | Las rutas y los casos normales existen y los bordes de registro/readback están cubiertos por `vbxe_register_snapshot`. MEMAC-B usa bit 7 para CPU y bit 6 para ANTIC, como Altirra y el software real, aun cuando AHRM los rotula al revés. CR/CG/CB ya replican la expansión D7→D0 de Altirra; la reserva local se modela en 912 slots por scanline, separa lecturas MEMAC de escrituras CPU y conserva el slot horizontal cuando el caller proporciona timestamp. El camino agregado sigue siendo necesario para accesos antiguos. |
| XDL: descriptor y estado de línea | Parcial | La progresión de fila, scroll/overscroll MAPPAR, `END` y la persistencia entre frames de las direcciones/strides de overlay/mapa siguen Altirra. AHRM documenta los scrolls MAPPAR como valores menos uno mientras Altirra conserva el valor literal; hace falta un diferencial visual que cierre esa discrepancia documental. |
| XDL: `OvMisc` | Implementada en la ruta cubierta | El compositor consume ancho, paleta de overlay y la paleta de playfield por defecto; faltan sólo cruces de mapa de atributos aún no diferenciados visualmente. |
| Presentación de overlay y texto | Parcial | Standard/lores usan los límites reales narrow/normal/wide y hires/texto sus señales nativas 512/640/672. Faltan diferenciales completos para todas las transiciones con attribute map. |
| Mapa de atributos | Parcial | Hay PF, Rev, paletas por celda, límite de 43 celdas, contador de scroll de cinco bits, overscroll, avance de filas y geometría narrow/normal/wide de Altirra. El replay por spans ya reconstruye PF3/GTIA en los intervalos de la línea, pero faltan cambios de registros VBXE del mapa, combinaciones GTIA especiales y diferenciales visuales completos. |
| Blitter | Parcial | Están los modos 0--6, lista, zoom y colisiones; una entrada enlazada reinicia el código de colisión. El inicio se difiere al siguiente scanline y consume sólo slots libres de la agenda local; falta validar el orden físico de MEMAC y el consumo ciclo a ciclo del residuo. |
| Reset y escrituras GTIA | Parcial | El estrobo `$D080-$D0FF` está conectado; warm reset conserva las direcciones XDL, prioridades y `COLDETECT` que conserva Altirra, y limpia `BLT_COLLISION_CODE`. Warm/cold reset y snapshots XDL/blitter están regresados; faltan bordes de temporización. |
| RAMBO y puerto de configuración | Implementada en la ruta cubierta | El latch de configuración Altirra en `$DxC0+` persiste correctamente. El perfil FX 1.26r devuelve `MINOR_REVISION=$A6` y, con PORTB-D4 bajo, comparte `$4000-$7FFF` entre CPU/ANTIC y el banco VBXE superior documentado; `vbxe_rambo_bus` cubre ambos buses, desactivación y aislamiento de bancos. |
| Cambios dentro del scanline | Parcial | La cola GTIA conserva colores y `PRIOR` con su ciclo horizontal; al cerrar una línea XDL, overlay, paleta por defecto, attribute map y `COLDETECT` reproducen los spans cubiertos, incluido PF3/mode GTIA y `COLCLR` rasterizado. Aún faltan cambios de registros VBXE dentro de línea y diferenciales visuales completos. |

### Auditoría AHRM de la rama `VBXE` — 2026-11-02

La suite funcional está verde, pero la conformidad AHRM debe declararse como
parcial. Las brechas comprobadas son:

| Prioridad | Brecha | Evidencia | Próxima acción |
| --- | --- | --- | --- |
| Alta | `verticalSync()` reemplazaba todo el estado XDL y perdía direcciones/strides de overlay/mapa que AHRM conserva entre frames. | Corregido en `jsA8E/js/core/vbxe.js`; regresión multi-frame en `vbxe_device_state`. | Mantener cobertura al ampliar los casos de XDL y validar también snapshots durante un reinicio. |
| Alta | El attribute map se componía siempre en geometría normal; no usaba el ancho/posición narrow/wide de `OvMisc`. | Corregido en `jsA8E/js/core/vbxe.js`; cobertura narrow/normal/wide en `vbxe_device_state` y boot oracles. | Mantener la geometría compartida al extender el replay temporal y validar cruces con overlay activo. |
| Alta | El coste XDL debía usar el número de bytes decodificados, mientras AHRM fija 22 ciclos de actualización. | Corregido en `jsA8E/js/core/vbxe.js`; regresión en `vbxe_device_state` y `vbxe_blitter_state`. | Mantener el contrato fijo y resolver sólo la secuencia por fase si aparece un diferencial horizontal reproducible. |
| Media | La reserva MEMAC/overlay/XDL/mapa/blitter ya usa la secuencia de ocho fases y separa lecturas de escrituras CPU; cuando el caller proporciona timestamp también conserva el slot horizontal del acceso. El orden físico y el consumo ciclo a ciclo del residuo siguen sin validación diferencial. | `jsA8E/js/core/vbxe.js`, `vbxe_blitter_state`, `io.js`, `memory.js`. | Comparar marcadores horizontales CPU-read/CPU-write/ANTIC con Altirra antes de ajustar el orden. |
| Media | MEMAC-B usa D7=CPU y D6=ANTIC, contrario a la tabla textual AHRM, aunque coincide con Altirra y el corpus probado. | `jsA8E/js/core/vbxe.js:1058-1063`; `vbxe_memac_b_xex`. | Mantener como excepción explícita hasta resolver la errata o conseguir evidencia física. |
| Media | `MAPPAR`/attribute-map scroll conserva valores literales, frente al “minus one” descrito por AHRM. | `jsA8E/js/core/vbxe.js:421-429`. | Obtener diferencial físico o visual concluyente antes de cambiarlo. |

Por tanto, el estado oficial es **compatibilidad práctica sí, AHRM-compliance
completa no**. El native core tampoco implementa VBXE; esta auditoría de
dispositivo corresponde al core JavaScript.

Conclusión: jsA8E tiene una base funcional y diagnósticos relevantes, pero no
replica todavía todos los elementos del dispositivo. Los pendientes activos
son cerrar el cruce completo de modos/transparencia/mapa, validar el orden
físico y el consumo ciclo a ciclo de MEMAC/blitter, completar el diferencial
browser/Altirra y decidir la implementación separada del native core.

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

Los accesos MEMAC ya dejan una traza con tipo, fase AHRM, ciclo CPU y slot
local candidato. `localBusBudget()` conserva esos slots cuando el caller
proporciona el inicio de la scanline; la traza sirve para alimentar un
diferencial horizontal, pero no constituye por sí sola una medición Altirra.

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
   JavaScript core; `implementation/A8E` still documents the native boundary
   without providing a native VBXE device. JavaScript FX 1.26r RAMBO behavior
   is already covered by `vbxe_rambo_bus`.

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
