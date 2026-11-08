# VBXE FX core 1.27 — research report and upgrade preparation

Status: **research only, nothing implemented.** Prepared 2026-11-08 on branch
`VBXE`. The current implementation targets FX 1.20 / 1.24 / 1.26 / 1.26r (see
[`VBXE.md`](VBXE.md) and [`VBXE_ROADMAP.md`](VBXE_ROADMAP.md)). This file
collects what is publicly known about core 1.27, compares it with our code and
proposes an ordered upgrade plan. Every item marked **verify** is something the
sources do not settle and must be checked (ideally against Altirra 4.50 and
the supplied test programs) before it is coded.

## Decision (2026-11-08): deferred

Upgrading to 1.27 is **not worth the effort for now**. This file stays as a
reference; no work is scheduled.

* VBXE is a niche product with little software. No market-penetration data
  was found; our own corpus is about ten titles and a "handful" is how the
  MiSTer VBXE branch describes it.
* No game was found that requires 1.27. Only the author's demos (SIGS,
  Wolfette) and the extra blitter tests (89-150) need it.
* 1.27 is backward compatible: software for 1.2x runs on it, so everything
  that works with our FX 1.26 profile keeps working on real 1.27 boards.
* Maturity: public and flashable, but one forum user calls it experimental,
  it has an open stability problem on some accelerated machines (section 8)
  and its author recommends falling back to 1.26 when it misbehaves. Altirra
  4.50 is still a test series.
* Cost is medium-large and touches both cores (jsA8E and native `A8E`).

Reopen if any of these happens:

1. A game or tool that requires FX 1.27 appears.
2. Altirra 4.50 is released as a final version (stable reference).
3. The `blitter1`/`blitter2` suite is wanted as a regression oracle.

Optional cheap follow-up, also not urgent: the fixes Altirra 4.50 applies to
older cores too (attribute-map wrap at 43 cells, `P0-P3` power-up `$00`, `$FF`
for unassigned registers, mode 6 both-nibble collision; section 4.1, test 19
and 24-26).

## 1. Summary

* FX/GTIA core **v1.27** was published on **2026-10-17** by Tomasz Piórek
  ("electron") as a complete package: 8 core images (FX and GTIA, VBXE 1.x and
  2.x, PAL and NTSC), tools, a new **Programmer's Manual v1.27** (revision 7,
  2026-10-08), test programs and two 1.27-only demos.
* It is the first core after 1.26 (1.25 was never released). It is described by
  the author as a "major rebuild and refactor". The visible changes for
  software are: a new register **FEATURE_CONTROL (`$Dx4B`)**, **XCOLOR widened
  to 2 bits**, **hard clip to 336 px**, a **rewritten GTIA**, **extended blitter
  command blocks** (jump and raycasting containers), **blitter MODE 7** (table
  lookup) and **MODE 2 carry/saturation variants**, an NTSC vertical-alignment
  fix and AVG/SUBcart compatibility.
* **Altirra 4.50-test24 (2026-10-19)** added "FX 1.27 core emulation" and it is
  already the default core in later tests; test25/26/30 refined timing, register
  decoding and MEMAC. Altirra 4.40 (our current reference) knows nothing about
  1.27. Altirra 4.50 is still a *test* series (latest public release 4.40,
  2025-12-31).
* The 1.27 manual is, for the first time, an **official specification with
  register-level text** for things our docs only know from Altirra's source. It
  settles several of the "deliberate deviations from AHRM" and known
  differences D1-D7 (section 6).
* Upgrade size: **medium**. Registers/profile are small; the blitter
  containers/raycasting/mode 7 and the 2-bit XCOLOR rendering paths are the real
  work. Native `A8E` and `jsA8E` both need it (the native core is at stages 1-2).
* Core 1.27 on real hardware has a **known stability problem on some
  accelerated machines** (see 2.4). It does not affect emulation but explains
  why the author recommends 1.26 as fallback.

## 2. Sources and how reliable they are

| Source | What it gave | Reliability |
| --- | --- | --- |
| Package `VBXE_cores_package_v1.27_1792228109.zip` from atari.area (SHA-256 `26f22147ef1e710c13dd9c666bfe29c07f67804cc5119d3e3eacb06514f44c1b`, 5.9 MB). Read: `README.txt`, `VBXE_FX_and_GTIA_cores_v1.27_Programmers_Manual.md` (118 KB), tool manuals, `vbxefx.mads` listing. | The full manual, change list, file naming, test/demo list. | **Primary, official.** Everything in sections 3-5 marked "(manual)" comes from it. |
| [atari.area news, 2026-10-17](https://www.atari.org.pl/informacje/nowe-rdzenie-vbxe-v1-27/2961) | Release announcement, package contents, change list. | Official announcement text (Polish, translated). |
| [atari.area forum "Testy VBXE FX core v1.27"](https://www.atari.org.pl/forum/viewtopic.php?id=20860) (page 1 of 4 read) | Beta test reports, stability issues, `vdoctor.xex`. | Forum posts; pages 2-4 not read. |
| [Altirra 4.50 test changelog mirror (t2e.pl)](https://www.t2e.pl/News/bety-i-svny.406/atari-altirra-x86-i-x64-4.50-test-17-4082026.25094) | VBXE entries of tests 8, 10, 17, 19, 24, 25, 26 and "30/10". | Mirror of phaeron's change log; some date labels are inconsistent (see 4.1). |
| [AltirraSDL PR #101](https://github.com/ilmenit/AltirraSDL/pull/101) and its `src/Altirra/source/vbxe.cpp` (GPL fork that tracks Altirra 4.50-test24) | Which files changed, how 1.27 is gated in code (`mbVersion127OrHigher`), blitter container parsing, XCOLOR render modes, border widths. | **Second-hand**: I read the source through a summarising fetch tool, in two passes over ~125 KB. Quote-level details (shift counts, constants) must be re-read directly before implementing. |
| [Kung-Fu Master EX page](https://kfm.atariscene.pl/) | Real software hit by a 1.27 flicker problem on NTSC, fixed in the game. | Developer changelog. |
| MiSTer forum post (search snippet only; page returned 403) | "MiSTer core updated with the 1.27.3 fixes". | **Unverified.** The names "1.27.1/.2/.3" appear only here; the official package is plain 1.27. |

Things I looked for and did **not** find: Altirra 4.50-test24+ source/binaries
on virtualdub.org (guessed URLs returned 404; the AltirraSDL fork is the only
source seen), a phaeron blog post on 1.27, any VBXE 1.27 hardware revision
notes beyond the manual's HISTORY section, and any evidence of a 1.27 "r"
(RAMBO) core.

## 3. What 1.27 is (from the manual)

### 3.1 Release contents

| File pattern | Meaning |
| --- | --- |
| `v1f127a1.xbf` / `v1f127a2.xbf` | FX core, VBXE 1.x, PAL / NTSC |
| `v2f127a1.xbf` / `v2f127a2.xbf` | FX core, VBXE 2.x, PAL / NTSC |
| `v1g127a?.xbf`, `v2g127a?.xbf` | **GTIA-only** cores (no overlay/blitter) |

All eight are `a` cores (no RAMBO emulation); the manual states that 1.27 cores
currently have no `r` variant. PAL and NTSC cores differ only in the default
palette 0 and, in GTIA cores, the default BLEND bit. Tools: FC v1.20, DCFG
v2.15, VQREBOOT, VXREBOOT, VHCLIP. Test/demo programs: `vbxe240p` (needs
>= 1.26), `blitter1`/`blitter2` (88 tests run on 1.26, **all 150 need 1.27**),
`SIGS` and `Wolfette` (raycasting demo) which **require 1.27**.

### 3.2 Identification registers

| Register | 1.26 (ours) | 1.27 (manual) |
| --- | --- | --- |
| `$Dx40` read (CORE_TYPE) | `$10` | `$10` for FX, **`$11` for GTIA core** |
| `$Dx41` read (CORE_REVISION) | `$26` (`$A6` for 1.26r) | **`$27`**; bit 7 = RAMBO ("r"), none exist for 1.27 |

The manual explicitly says compatible cores share bits [6:4] of the version, so
1.2x software keeps working, but 1.27-specific software must check the revision
strictly. Altirra reports `CORE_REVISION=$10`, `MINOR=$27` and ignores the
"shared memory" option for 1.27.

### 3.3 FEATURE_CONTROL (`$Dx4B`, new, FX and GTIA cores)

Read/write. Not present before 1.27 (Altirra: reads return `$FF` and writes are
ignored on older versions).

| Bit | Name | FX core | Meaning |
| --- | --- | --- | --- |
| 7 | PXGF | RW, reset 0 | Persistent GTIA Features: when set, the other fields survive soft **and** hard RESET (not power-up/core reload). PXGF itself only initialises at power-up. |
| 6 | BLEND | **R, always 0** | PAL blending. GTIA cores only (RW, default 1 PAL / 0 NTSC). |
| 5 | CLIP | RW, 0 | Hard clip to **336 hires pixels** (320 + 8 per side). A 360-pixel clip is always active. |
| 4:3 | XCOLOR | RW, 0 | See 3.4. |
| 2 | - | R, 0 | |
| 1:0 | GTIA_PALETTE | RW, 0 | Palette used for the playfield/PMG layer **from the top of the frame until the first XDLC_OV_ATT** of the frame. |

Altirra writes the register as `value & 0xBB` (so bit 6 and bit 2 never stick),
clears it on warm reset unless bit 7 is set, and clears it when downgrading the
core below 1.27 or loading an old snapshot (it then copies VIDEO_CONTROL bit 1
into bit 4 so a 1.26 save state keeps its extended-color setting).

`GTIA_PALETTE` caveat (manual): once the first `XDLC_OV_ATT` of a frame is
processed its `XDL_PF_PALETTE` stays in force until the next VSYNC; there is no
way to go back to `GTIA_PALETTE` inside the same frame.

### 3.4 VIDEO_CONTROL (`$Dx40` write) and XCOLOR

| Bits | 3 | 2 | 1 | 0 |
| --- | --- | --- | --- | --- |
| Name | TRANS15 | **NO_TRANS** | XCOLOR | XDL_ENABLE |

* Bit 2 is now documented as `NO_TRANS`: **1 = overlay has no transparent
  colors, 0 = color 0 is transparent.** This is the polarity our code already
  uses (derived from Altirra), so the AHRM prose we flagged as wrong is
  confirmed wrong by the vendor.
* Bit 1 writes **XCOLOR[1]** and, as a side effect, **always clears
  XCOLOR[0]**. The manual warns software to rewrite FEATURE_CONTROL after every
  VIDEO_CONTROL write if it wants an exact XCOLOR value.
* XCOLOR is reset to 0 by RESET unless PXGF is set.

XCOLOR semantics (applies to global ANTIC hires and to hires forced locally by
an attribute-map `RES` bit):

| XCOLOR | Behaviour |
| --- | --- |
| 00 | Classic: luminance bypass `bPF1` (luma bits [3:1] of a set pixel come from COLPF1, even under a PMG), **7-bit** colour registers (bit 0 ignored). The PRIOR logic sees PF2 for set and clear pixels; for overlay priority/collision the set pixel counts as PF1. |
| 01 | Full COLPF1 bypass: set pixels are PF1 **forced after PRIOR** (no PMG shown), 8-bit colour registers. |
| 10 | = 1.26 "XCOLOR set": hires PF1 decoder level extension **before PRIOR** (PRIOR sees PF1 for set pixels), 8-bit colour registers. |
| 11 | Both of the above 1x/x1 behaviours (PF1 decoder extension + PF2→PF0 swap). |
| x1 | **PF2 hires mod swaps PF2 to COLPF0** instead of COLPF3, applied after PRIOR. |

Overlay priority / `COLDETECT` bookkeeping for the new layers: PF3 (from sPF2,
XCOLOR x0) counts as bit 6; PF0 (from sPF2, XCOLOR x1) counts as bit 4; bPF1
(00) and forced PF1 (01) count as bit 5. A PMG with priority over PF2 stays
visible over a PF2-hires-mod pixel.

Altirra models this with four hires render modes (`Hires`, `HiresXcolor`,
`HiresXcolorForcedPF1`, `HiresXcolorPF0`), uses an 8-bit attribute colour mask
when XCOLOR != 0 (`0xFE` otherwise), and (test24 comment) "plain hires changes
colour selection only; collision and priority retain the original PF2 layer".

### 3.5 Display geometry

* **CLIP**: Altirra 1.27 uses left border 44 colour clocks / right border 212
  with CLIP set, 38 / 218 without; pre-1.27 uses 34 / 222. Wide overlay bounds
  are 44-212 colour clocks.
* **NTSC vertical alignment fixed in hardware.** Altirra 4.30 had added a
  one-scanline NTSC vertical offset for older cores; test25 states it "no longer
  applies to FX1.27". (Our code has no such offset: nothing to remove.)
* AVG / SUBcart compatibility removes PMG interference (hardware; nothing to
  emulate).

### 3.6 Attribute map

* Cell format unchanged (4 bytes). Byte 1 in ANTIC hires is the **PF2 hires
  mod** (8-bit segment pattern, segment width 1/2/4 px for cell widths
  <=8/9-16/17-32); the swap target is COLPF3 (XCOLOR[0]=0) or COLPF0
  (XCOLOR[0]=1).
* The line buffer holds **43 cells**; with narrower cells the counter wraps
  from cell 42 to 0 (Altirra: `attrIndex %= 43` on 1.27, `&= 63` on older
  cores). Altirra 4.50-test19 first emulated this wrap generally.
* `MAP_WIDTH`/`MAP_HEIGHT` values are `n` = size-1 (7..31 = 8..32 px) and
  `MAP_HSCROLL`/`MAP_VSCROLL` are **literal** pixel counts 0..31 (so the AHRM
  "minus one" wording is not what the silicon does). Out-of-range scroll values
  have a documented 5-bit-counter wrap behaviour.
* `MAP_STEP` bits [1:0] are ignored by hardware.
* Palette selection in a cell overrides the XDL palette.

### 3.7 Blitter changes

**Extended BCB containers** (new). `blt_control` bit 7 = EXTENDED; one or more
containers follow the 21-byte BCB (even if NEXT is 0). Container header:
`bit7 NEXT | bits6:5 TYPE | bits4:0 CTRL`.

| TYPE | Container | Size | Content |
| --- | --- | --- | --- |
| `%00` | Jump | 4 bytes | CTRL bit 0: 0 absolute / 1 relative; 19-bit address, or signed 16-bit offset relative to byte 4 of the container. Takes effect once the container is loaded, redirects the *internal* fetch pointer only (`BL_ADR` is unchanged). |
| `%01` | Raycasting | 6 bytes | initial 15-bit X and Y accumulators (8.7 fixed point: 7-bit integer + 8-bit fraction fields as laid out in the manual), plus `source_step_x_1` that extends `source_step_x` to 15 signed bits. |
| `%10`,`%11` | Invalid | - | Loading is aborted and the blitter does not start (Altirra: stops without raising an IRQ, costs 1 cycle). |

Altirra accepts at most **four** chained containers; the manual says the number
is "not formally limited" (**verify**, matters only for pathological lists).

**Raycasting** replaces source addressing for that BCB only: `x_acc`/`y_acc`
(15-bit, fractional low byte) advance by `source_step_x`/`source_step_y`
(both 15-bit signed) after every destination byte (once per zoomed group), the
texture size comes from `pattern_feature` (bits 2:0 = width, bits 5:3 =
height; 0..4 = 8..128 texels, 5-7 reserved; Altirra clamps to 128) and the VRAM
address is `source_adr[18:14] | (source_adr[13:6] OR texture_adr[13:6]) |
texture_adr[5:0]` with texture data aligned to the texture size. `IN_USE` of
`pattern_feature` is unused in this mode. The accumulators are written back
at the end of the BCB. Combines with every blitter mode.

**New modes**

* **MODE 7 — table lookup**: `dest' = VRAM[{AUX_CONTROL(3 bits), blt_collision_mask, source''}]`
  (256-byte table aligned on 256). No collision detection (the mask byte is
  part of the address). In <= 1.26 Altirra treats mode 7 as plain copy.
* **MODE 2 sub-functions** via `AUX_CONTROL` (`blt_control` bits 6:4):
  bit 0 = add-**carry** (writes 255 on overflow else 0; also reads the
  destination for zero sources), bit 1 = **saturate**; both set is reserved.

**Corrected / clarified behaviours**

* Mode 6 (HR): if both nibbles of one destination byte collide, **both** codes
  are latched in `BLT_COLLISION_CODE` (Altirra test24 "can now latch both low
  and high nibbles simultaneously").
* `BLT_COLLISION_CODE` is cleared at the start of **every** BCB, including
  chained ones.
* `BLITTER_START`: a START while the blitter is busy is ignored.
  `BLITTER_BUSY` bit 0 = BCB_LOAD, bit 1 = BUSY.
* IRQ: Altirra test24 "blitter IRQ status bit is no longer set when blitter
  IRQ are disabled".
* BCB `source_step_y` field is 15-bit signed in the BCB; only 13 bits are used
  outside raycasting.
* **Cycle cost** (manual table, per destination byte; "fetched" vs "repeated"
  by zoom/constant source): mode 0: 2/1; mode 1: 2 (3 with collision) / 1 (2);
  mode 2: 3 / 1 (3 if carry); modes 3,5,6: 3 / 1; mode 4: 3 / **2**; mode 7:
  3 / 3, repeated 1. Load costs: BCB 21, jump container 4, raycast container 6.
  Altirra test25 "improved blitter timing accuracy" — exact new rules are in
  the 4.50 source, which I could not read directly (**verify**).

### 3.8 Items the manual states that differ from, or add to, our current model

| Topic | Manual (1.27) | Current code / docs |
| --- | --- | --- |
| Register mirror | Registers decode ignoring address bit 5: `$Dx60-$Dx7F` mirrors `$Dx40-$Dx5F`. Altirra test26: unassigned registers read `$FF`. | **verify** whether `io.js`/`vbxe.js` mirror `$Dx60+` and what unassigned reads return (known difference D7). |
| XDL cost | "1 cycle per XDL byte read: 2 per XDLC + associated data (22 at most)". | We charge a fixed 22 (from AHRM). **verify** against Altirra 4.50 before touching; the stage-6 timing gates were built on 22. |
| `P0-P3` power-up | Undefined; Altirra test19 powers them up as `$00`. | **verify** our reset value. |
| XDL blanked lines | "Blanked scanlines (e.g. vertical blanking) do not consume XDL records or repeat counts". | **verify** against `verticalSync`/XDL row logic. |
| Text attribute table | NO_TRANS/TRANS15 truth table for foreground/background (e.g. NO_TRANS with AT7=0 gives background index 128). | **verify** against the text renderer. |
| `OV_VSCROLL` | Only the *starting* value of the vertical counter; first text line has `8 - v` scanlines. | covered by `vbxe_xdl_text_scroll_asm`, re-check. |

## 4. Altirra 4.50 test series (VBXE-relevant entries)

### 4.1 Entries found (dates as printed by the mirror; the mirror mixes
formats, treat them as approximate)

| Test | Entry |
| --- | --- |
| 8 | GTIA size-mode-2 lockup bug no longer emulated when VBXE is active. |
| 10 | Default VBXE core version set to 1.26. |
| 17 | Reverted emulation of the VBXE P/M size-2 bug (broke collision). |
| 19 | `.vbxe_bl` can dump lists > 256 entries; **P0-P3 power up `$00`**; **attribute-map repeat above 43 cells emulated**; fixed GTIA-priority vs overlay-priority interaction. |
| **24** | **Added FX 1.27 core emulation**; fixed PF0 colour regression in hires; IRQ status no longer set with IRQ disabled; HR blitter collision latches both nibbles. |
| 25 | Improved blitter timing accuracy; shared-memory option disabled for 1.27; NTSC vertical offset not applied to 1.27; **"HR+LR erroneous mode" implemented** (the forbidden XDLC combination "HR mode with LR data rate"). |
| 26 | Register decoding ignores A5; unassigned registers read `$FF`. |
| 30/10 | MEMAC cycle usage tracked; MEMAC cycle stealing; MEMAC windows are globally address-tagged. |

The test 19 items (attribute wrap, priority fix, `$00` P-registers) apply to
older cores too, so they are candidates for the 1.26 profile as well.

### 4.2 Consequence for our reference

Our differential reference is Altirra **4.40** (`build/Altirra-4.40-src`,
`build/Altirra-4.40-bin`, git-ignored). It cannot run 1.27. The upgrade needs a
4.50 test build (>= test24, preferably the latest) for differentials and its
`vbxe.cpp` for the audit. Where to get it: the AtariAge Altirra 4.50 test
thread (not found by search); the AltirraSDL fork carries the source. Note that
the 4.40 audit items D1-D7 and the not-yet-audited renderer/priority sections
should be re-read against 4.50 at the same time.

## 5. Impact on our code

Legend: **js** = `jsA8E/js/core/vbxe.js` (+ `io.js`, `memory.js`, `atari.js`,
`ui.js`, `index.html`), **c** = native `A8E/Vbxe.c`, `Vbxe.h`, `VbxeVideo.c`,
`A8E.c`.

### 5.1 Profile, registers, snapshot (small)

* Add profile `fx1.27` (names `1.27`, `fx127`): js `normalizeProfile`,
  `ui.js` selector parsing and `index.html` options ($D600/$D700); c
  `Vbxe.h` enum (`VBXE_PROFILE_FX127`), `Vbxe.c` name parser (`:29-36`) and
  revision read (`:561`). No `r` variant.
* `CORE_REVISION` returns `$27`; keep `$10` for `CORE_TYPE`. A GTIA-core
  profile (`CORE_TYPE=$11`) is **out of scope** unless wanted: it needs no
  overlay/blitter but a PAL-blend GTIA path.
* `$Dx4B` read/write with mask `0xBB`; PXGF handling in soft/hard reset;
  VIDEO_CONTROL bit-1 write must set FEATURE_CONTROL bit 4 and clear bit 3.
  The existing `videoControlActive & 0x02` extended-color test
  (`vbxe.js:969,1163,1287`) becomes `xcolor` (2 bits) derived from the new
  register for 1.27, unchanged for older profiles.
* Snapshot: add `featureControl` (and container/raycast blitter state, see 5.3)
  with defaulting for old snapshots (copy VIDEO_CONTROL bit 1 to bit 4 as
  Altirra does). Bump the snapshot version.
* Mirror `$Dx60-$Dx7F` and `$FF` for unassigned reads (**verify**, 3.8).
* Tests: extend `vbxe_device_state`, `vbxe_register_snapshot`.

### 5.2 XCOLOR rendering (medium)

* js: `hiresPriorityForOverlay` (`vbxe.js:960-969`), the attribute-map PF
  passes (`:1163`, `:1287`) and the reverse-cell decoders must be driven by
  XCOLOR[1:0] instead of the single extended-color bit. New work: forced-PF1
  mode (01), PF2→PF0 swap (x1), `bPF1` luminance bypass and the 8-bit vs 7-bit
  attribute colour mask. **This also gives the specification for known
  difference D6** (cell without extended colour: PF2 hue + PF1 luminance).
* Priority/collision layer mapping table in 3.4 must be added to the
  contributor plane (PF3-from-PF2 → bit 6, PF0-from-PF2 → bit 4, PF1 forced →
  bit 5).
* c: `VbxeVideo.c` `Vbxe_Composite` equivalent changes.
* Tests: new XEX diagnostics under `implementation/AHRM Validation/` for
  XCOLOR 00/01/10/11 × {global hires, RES cell} × {PMG over PF2, GTIA 9/10/11,
  PF2 hires mod}. Existing probes (`vbxe_fx124_priority_probe_*`,
  `vbxe_attrmap_*`) must stay green for the 1.20/1.24/1.26 profiles.

### 5.3 Blitter (medium-large)

* Parse `blt_control` EXTENDED/AUX_CONTROL (currently `block[20]`), fetch the
  container chain after the 21 bytes with their 4/6-cycle costs; keep
  `preloadedBlock` semantics ([NOTES 2026-11-05]) for the base 21 bytes and
  decide whether containers are preloaded too (Altirra loads the BCB at START;
  **verify** containers).
* Jump container (absolute/relative; internal pointer only; loop-safe for
  snapshots), invalid-type abort (no IRQ), container cap decision.
* Raycasting: 15-bit signed steps (BCB bytes 5 and 6 + container byte 6),
  accumulators, texture address formation, interaction with zoom, pattern
  repurposing, write-back; per-row budget code (`RunBlitterRow` analogue) is
  separate from the 8-cycle source/dest paths and needs a source-address
  generator hook.
* MODE 7 and MODE 2 carry/saturate; per-mode cycle table (3.7).
* HR collision: latch both nibbles (closes D1); `IRQ_STATUS` not set with IRQ
  disabled; START while busy ignored; `BLITTER_BUSY` bit meanings (D4).
* Snapshot must save the container position, jump state and raycast
  accumulators (Altirra's PR notes a regression for "resumed raycast/container"
  states).
* Tests: reproduce `blitter1/2` expectations (see 6.2) plus focused unit tests
  for each container/mode in `vbxe_blitter_state`.

### 5.4 Geometry, palette, attribute map (small-medium)

* `CLIP` (336) and the always-on 360 clip: needs a decision on what our
  presentation does today for hires overscan (`PF` width/`Wide` handling);
  changes the visible window by a few colour clocks. Presentation-only risk,
  but touches the `vbxe_real_software_scene` / browser golden fixtures.
* `GTIA_PALETTE` default PF palette until the first `XDLC_OV_ATT`.
* Attribute map: wrap at 43 cells (cell 42 → 0) on 1.27 (and Altirra's 64-cell
  wrap on older cores, if we want to match 4.50 for them); currently a column
  >= 43 returns "no cell" (`vbxe.js:785-786`) — **verify** which is right for
  the <= 1.26 profiles.
* No NTSC vertical offset in our code; nothing to do.
* The forbidden `HR+LR` combination: decide whether to implement Altirra's
  "erroneous mode" (test25). Low priority.

### 5.5 Native core

`A8E` is at stages 1-2 (see `VBXE.md` "Still pending" #5). The 1.27 work should
be ported to the native core **after** the jsA8E implementation is validated, as
for earlier milestones, with `A8E/tests/vbxe_probe.c` cases. Note that the
native core still lacks the 640-px output plane, so XCOLOR/CLIP presentation is
only partially checkable there.

### 5.6 Documentation and project hygiene

On implementation: update `VBXE.md` (support matrix, profile list, registers),
`VBXE_ROADMAP.md` (known issues), `jsA8E/README.md`, `A8E/README.md` and
`implementation/NOTES.md` (required by `AGENTS.md`). AHRM
(`AHRM/12. Internal devices/4. VideoBoard XE.md`) predates 1.27; **it should
not be edited**, but the new manual should be referenced as the 1.27 hardware
reference (AGENTS.md asks for AHRM first for hardware emulation — the AHRM has
no 1.27 text, so the 1.27 manual and Altirra 4.50 are the only specs).

## 6. Open items that the 1.27 manual settles or reopens

| Existing item | Effect |
| --- | --- |
| "Deliberate deviation": `VIDEO_CONTROL` D2 polarity | **Confirmed** by the vendor (NO_TRANS, 1 = opaque). Remove the "deviation" wording for 1.27; AHRM remains wrong for older cores. |
| "Deliberate deviation": MEMAC-B D7 = CPU, D6 = ANTIC | **Confirmed** (MBCE bit 7, MBAE bit 6). |
| MAPPAR "minus one" vs literal scroll (VBXE.md audit) | Manual: scroll values literal 0..31, size fields `n` = size-1. Our literal-scroll behaviour is right. |
| `CORE_REVISION` `$11` mentioned in older AHRM | `$11` is the **CORE_TYPE of the GTIA core** in the new manual; FX is `$10`. |
| D1 mode 6 collision nibble order | Manual/Altirra 4.50: both nibbles latch. Replaces "record the low nibble first". |
| D2 blitter mode 7 | Real mode in 1.27 (table lookup); copy-equivalent only for <= 1.26 (Altirra). |
| D3 mode 4 zero-source cost | Manual says 2 cycles, which is what we charge. Altirra 4.40 code charged 1; 4.50 may have changed (verify). |
| D4 `BLITTER_BUSY` | Manual: bit 0 BCB_LOAD, bit 1 BUSY; START while busy ignored. Our "bit 1 only while processing" differs from the manual. |
| D6 attribute cell without extended colour | Now specified (`bPF1` luminance bypass, 7-bit colour regs). |
| D7 undefined register reads | Altirra 4.50 returns `$FF`; manual says undefined, "usually 255". Our `$FF` is fine. |
| XDL fixed 22 cycles | Manual says 1 cycle per XDL byte read (max 22). Reopened (**verify**). |

## 7. Validation material (no hardware needed)

### 7.1 Programs in the package

| Program | Use |
| --- | --- |
| `blitter1.xex` (waits for keys) / `blitter2.xex` (loops, stops on first failure) | Self-checking blitter suite, **150 tests**; sources and a test list (`TESTS.md`, 49 KB) are in `tests/blitter.zip` (llvm-mos C, includes a host simulator `hostsim.c`). The best available oracle for 5.3. Tests 1-88 apply to FX 1.26 (also useful to regress our current profile). |
| `vbxe240p.xex` | 240p Test Suite (>= 1.26): geometry, palettes, scrolling; reference for overlay widths/CLIP visuals. |
| `wolfette.xex` | Raycasting demo, 1.27 only: exercises containers/raycast. |
| `sigs.xex` | 1.27 demo (124 KB; uses 1.27 blitter features). |
| `vdoctor.xex` v1.3 (forum, not in the package) | Hardware VRAM/MEMAC stress test; not meaningful for an emulator. |

Licensing of the package contents is not stated in the README. **Do not commit
the binaries to the repository** without the author's permission; keep them
under the git-ignored `build/` area (as with Altirra) and wire the tests to
skip when absent.

### 7.2 Procedure (same as the existing differential policy)

For each change: a deterministic XEX diagnostic, the same run in Altirra
4.50-test24+ with the FX 1.27 profile and the same page, jsA8E result, an
automated regression and a NOTES entry (see `VBXE_ROADMAP.md`, "Differential
evidence"). Run the 1.20/1.24/1.26 suites unchanged to prove no regression.

## 8. Known real-hardware / software issues with 1.27 (context only)

* Beta testing on atari.area: instability on machines with **6502-replacement
  CPUs / accelerators** (Rapidus, Antonia II): read or read/write VRAM errors
  in `vdoctor`, probably 6502/ANTIC accesses to VRAM; fix "not simple" (the FPGA
  is nearly full). The author's advice: use **1.26** if you hit problems. Tested
  fine: stock VBXE 1 machines, two 800XL/65XE units, the author's own PAL and
  NTSC machines with C014806 accelerators.
* Kung-Fu Master EX had flicker/garbage frames on FX 1.27 (mostly NTSC),
  fixed in the game (v1.02 and v1.06); the page does not say whether the root
  cause was the core or the game's timing. Worth keeping as a **regression
  target**: if the NTSC timing change is emulated correctly, such games should
  not need a workaround in the emulator.
* Third-party software compatibility list for 1.27: not found.

## 9. Proposed upgrade plan (not started)

| Step | Scope | Exit criterion | Size |
| --- | --- | --- | --- |
| 0 | Obtain Altirra 4.50 (>= test24) binary and `vbxe.cpp`; unpack the package under `build/`; re-run `test:vbxe:full` for the baseline; re-audit D1-D7 and the unaudited renderer/priority code against 4.50. | Written audit appended to `VBXE_ROADMAP.md`; baseline green. | S |
| 1 | `fx1.27` profile in both cores' selectors, revision read, `$4B`, VIDEO_CONTROL/XCOLOR bookkeeping, PXGF reset rules, register mirror/`$FF` reads, snapshot v+1. | Register/snapshot tests pass for all profiles; `vbxe_device_state` covers 1.27. | S |
| 2 | XCOLOR 2-bit rendering (global hires, RES cells, PF2 hires mod to PF0), priority/collision mapping, 7/8-bit colour mask. | New XEX probes match Altirra 4.50; old profiles unchanged. | M |
| 3 | Blitter: modes 7 and 2 variants, mode 6 both-nibble, IRQ/START/BUSY fixes, cycle table. | `blitter1/2` tests that need only these features pass. | M |
| 4 | Blitter containers (jump, raycast, invalid), snapshots mid-container. | Remaining of the 150 blitter tests, Wolfette and SIGS render correctly. | M-L |
| 5 | CLIP/336, `GTIA_PALETTE`, 43-cell wrap, `HR+LR`; refresh browser golden fixtures deliberately. | `vbxe240p` geometry matches Altirra; golden updates reviewed. | S-M |
| 6 | Port to native `A8E` (registers, XCOLOR, blitter), `vbxe_probe` cases; add the native-vs-jsA8E differential gate (roadmap G6). | `ctest` green; same RAM/VRAM digest as jsA8E on the blitter tests. | M |
| 7 | Docs: `VBXE.md`, roadmap, READMEs, NOTES; remove/reword the "deliberate deviations" that the 1.27 manual confirms. | Docs and tests describe the same model. | S |

Default profile stays FX 1.26 (as Altirra did until test24; the 1.27 core is
described by its author as experimental on some hardware). VBXE remains
opt-in.

## 10. Questions for the maintainer

1. Should the **GTIA-only 1.27 core** (`CORE_TYPE=$11`, PAL blending, four
   palettes) be emulated, or only the FX core? (Recommendation: FX only.)
2. May the package demos/tests be redistributed in the repository, or should
   they only be used locally from `build/`?
3. Is it acceptable to refresh the browser golden baseline
   (`jsA8E/tests/fixtures/vbxe_browser_golden.json`) once CLIP is implemented?
4. Should the 1.27 findings that also correct older behaviour (attribute-map
   wrap, `$00` P0-P3 power-up, `$FF` unassigned reads, mode 6 collision) be
   applied to the 1.20-1.26 profiles, as Altirra 4.50 does, or only to 1.27?

## 11. References

* VBXE FX and GTIA cores v1.27 Programmer's Manual (revision 7, 2026-10-08) and
  `README.txt`, in the package linked below (T. Piórek).
* Package download: <https://www.atari.org.pl/storage/VBXE_cores_package_v1.27_1792228109.zip>
* Release news: <https://www.atari.org.pl/informacje/nowe-rdzenie-vbxe-v1-27/2961>
* Beta test thread: <https://www.atari.org.pl/forum/viewtopic.php?id=20860>
* Altirra 4.50 test change log (mirror):
  <https://www.t2e.pl/News/bety-i-svny.406/atari-altirra-x86-i-x64-4.50-test-17-4082026.25094>
* Altirra home / releases: <https://www.virtualdub.org/altirra.html> (4.40,
  2025-12-31, last release at the time of writing)
* AltirraSDL sync of 4.50-test24: <https://github.com/ilmenit/AltirraSDL/pull/101>
* Kung-Fu Master EX (1.27 flicker fix): <https://kfm.atariscene.pl/>
* Local: [`VBXE.md`](VBXE.md), [`VBXE_ROADMAP.md`](VBXE_ROADMAP.md),
  [`NOTES.md`](NOTES.md), `AHRM/12. Internal devices/4. VideoBoard XE.md`.
