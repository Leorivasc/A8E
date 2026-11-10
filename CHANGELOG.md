# Changelog

> Hardware emulation reference: Before implementing any Atari 800 XL PAL/NTSC hardware emulation, use the [AHRM](/AHRM/index.md) as reference.

All notable changes to this project will be documented in this file.

## Unreleased

### Added
- Native A8E: first stage of the VBXE device (`--vbxe[=fx1.20|fx1.24|fx1.26]`,
  `--vbxe-d7`): registers, 512 KiB VRAM, MEMAC A/B for CPU, ANTIC and
  instruction fetch, blitter with collision code and completion IRQ.
  Probe `A8E/tests/vbxe_probe.c`.
- Native A8E: second VBXE stage (`A8E/VbxeVideo.c`): XDL parser, standard,
  lores, hires and text overlay with priority and collisions, playfield
  palettes, attribute map and XDL/overlay local-bus slots, shown through
  `AtariIoDrawScreen` at the native 336-pixel width.
- Browser regression tests for MEMAC windows (`vbxe_memac_window_sync`,
  `vbxe_memac_code_fetch`), GTIA unassigned reads
  (`gtia_unassigned_reads`), and a vertical-blank exit-line DLI case in
  `antic_vscrol_timing`; native probes `TestExitDliIsNotArmedInVerticalBlank`
  and `TestUnassignedReadsReturnF`.
- Native and browser support for the AHRM 130XE, RAMBO, COMPY, and initial
  Ultimate1MB memory profiles, including native memory-expansion regression
  probes and the reusable `U1MB_MEMORY_TEST.XEX` and `MEMORY_STRESS_TEST.XEX`
  diagnostics.
- Browser headless automation and MCP coverage for grouped lifecycle, media,
  debugger, HostFS, assembler, snapshot, artifact, and memory-profile flows.
- jsA8E optional remote Disk Library sync over WebDAV (tested against
  Nextcloud): workspace or whole-library scope, content-addressed blobs,
  ETag-guarded publishing, non-destructive merge, tombstoned deletions (remote
  deletions go to the local Trash), folder renames and entry moves, automatic
  ETag polling with an "Update" indicator and idle sync, an opt-in remembered
  password, and a manual remote cleanup of unreferenced blobs. The native A8E
  has no WebDAV client yet (see `implementation/OnlineDrive.md`).

### Documentation
- `implementation/MCP.md`: guide to the MCP server (`mcp_server.js`): startup options,
  ROM lookup, protocol behavior and limits, argument mapping for every
  action, results and errors, security notes, and a worked session.
- VBXE is documented as experimental and opt-in. The roadmap now holds the list
  of known differences from Altirra 4.40, unaudited areas, validation gaps and
  test-infrastructure issues (`implementation/VBXE_ROADMAP.md`, "Known issues
  and pending work"); the root README no longer states that the native core
  lacks VBXE.

### Fixed
- jsA8E VBXE: MEMAC A windows above $D800 (for example $E000 with the OS ROM
  off) are now routed, so Commando's terrain map is copied and the player is
  blocked by palms, rocks and the bridge as in A8E.
- VBXE text overlay (both cores): vertical scroll was applied twice, cutting the
  top of characters in Textmode Test 80x30/80x32.
- VBXE blitter (both cores): `BLITTER_START` latches the first control block
  immediately, as Altirra does, so programs that rewrite it right after starting
  a blit no longer leave sprite trails (seen in Gacek).
- VBXE overlay priority and collisions (both cores): ANTIC hires pixels reach the
  overlay as PF2, as in Altirra, except FX 1.26 with extended color. Fixes
  `vbxe_fx124_priority_probe_boot`.
- Firefox now runs the emulator on the main thread by default (the worker path
  caused seconds of input lag on desktop Firefox); `?a8e_worker=1` still opts
  in to the worker.
- VBXE `BLITTER_START` now runs the rest of the current scanline's blitter
  budget immediately, as Altirra does, so software that polls
  `BLT_COLLISION_CODE` right after starting a blit (Mr. Proper's fruit pickup)
  sees collisions found in the first rows. Regression test
  `vbxe_blitter_midline_start`.

### Changed
- jsA8E MCP server: file arguments are confined to `--cwd` by default
  (`--allow-any-path` lifts it) and `--no-network` disables the URL loading
  actions.
- Faster VBXE paths for software that toggles MEMAC windows or uses attribute
  maps on every line: MEMAC B remapping is decided per window, the attribute
  map is looked up once per cell run, and decoded cells are kept on the row
  buffer.
- VBXE `VIDEO_CONTROL` D2 now follows Altirra: overlay color 0 is transparent
  with D2 clear (the reset value) and opaque with D2 set. The AHRM validation
  programs and their `.XEX` artifacts were updated to keep each test's intent.
- VBXE performance: the MEMAC reader resolves the VBXE API once, the blitter no
  longer rescans the local-bus schedule for every byte, attribute-map cells are
  cached per line, and per-byte/per-pixel paths avoid `Math.*`. D600 runs at
  60 fps in Chromium and about 4x faster in the headless harness.
- GTIA player/missile drawing returns early when no player or missile can draw
  or load in the current color-clock span (previously about a third of frame
  time in Chromium even with none in use); applied to `jsA8E` and native `A8E`.
  VBXE attribute-map composition decides each pixel once for both planes and
  skips the PF3-mask math when the mask is empty; MEMAC register writes only
  revisit the addresses a window can cover.
- Documentation now consistently states that Atari 800 XL PAL/NTSC hardware-emulation implementation work should use `AHRM/index.md` as the reference baseline (applied across non-AHRM Markdown docs).
- Native `A8E` build caption/version is now injected at compile time from `jsA8E/version.json` (with `dev` fallback when unavailable).
- Browser `jsA8E` frame timing now accumulates CPU cycles and runs whole-frame steps with capped catch-up to reduce visible speed jitter.
- Browser rendering now requests `desynchronized` WebGL contexts and hints `canvas` transforms for smoother presentation.
- Native and browser memory-window transitions now preserve motherboard RAM,
  honor profile-specific CPU/ANTIC windows and BASIC/Self-Test overlay rules,
  and expose the initial Ultimate1MB UCTL/UAUX/COLDF register model.
- Native and browser XEX loaders now accept valid low-memory 16-bit RUNAD
  targets after relocating their internal loader routines and SIO buffer
  patches.

### Fixed
- VBXE MEMAC: addresses a window stopped covering now return to plain RAM, and
  writing MEMAC registers only reinstalls the windows instead of rebuilding the
  memory map (which discarded RAM written under the OS ROM). Together these
  were why most real VBXE XEXs never got past their loader.
- CPU instruction fetch now honors VBXE MEMAC windows, so code executed from a
  window onto VRAM (Popeye) runs from VRAM instead of the RAM underneath.
- ANTIC no longer raises a DLI on every scan line 249-261 when the last display
  list instruction is a VSCROL region exit with DLI; this deadlocked Popeye's
  VBI handler. Fixed in `jsA8E` and in native `A8E`.
- GTIA reads of `$D01B-$D01E` (`PRIOR`, `VDELAY`, `GRACTL`, `HITCLR`) return
  `$0F` instead of `$FF`, per AHRM 6.1, in `jsA8E` and native `A8E`.
- Native `A8E` now ignores out-of-range SDL keysyms (e.g. macOS Command/LGUI) when mapping to Atari key codes; previously hitting ⌘ would index past the key table and crash the emulator.
- Hardened `jsA8E` SIO disk sector access checks across read/write/verify paths to reject invalid offsets consistently.
- POKEY IRQ requests now follow level-sensitive source state when `IRQEN`
  disables a source, preventing stale queued IRQs from corrupting XEX startup.
- XL/XE cartridge detection now reports `TRIG3` low without an external
  cartridge, and effective PORTB pull-ups/`DDRB` writes update memory mapping
  consistently in native, browser, and headless paths.

## v1.1.1 - 2026-02-17

### Changed
- XEX boot-loader handling in native `A8E` and browser `jsA8E` now chooses a non-overlapping temporary sector buffer and patches loader buffer addresses dynamically.

### Fixed
- XEX-to-ATR conversion now rejects images whose segments overlap reserved boot-loader memory, preventing invalid boot media generation.

## v1.1.0 - 2026-02-17

### Added
- Direct `.xex` program loading support in both native `A8E` and browser `jsA8E` paths.
- XEX-to-ATR conversion with segment normalization to support multi-segment files in both implementations.

### Changed
- Embedded XEX boot loader updated to handle `INITAD`/`RUNAD` flow more robustly across native and JS builds.
- Documentation updated to describe ATR/XEX loading behavior and usage.

### Fixed
- Corrected inclusive segment end-copy behavior (off-by-one) in the XEX boot loader for native and JS.
- Added failure handling for invalid/unsupported XEX conversion paths to avoid mounting bad disk data.

## v1.0.1 - 2026-02-13

### Added
- Automated release workflow to update `jsA8E/version.json` from the published Git tag.
- Runtime build version display in `jsA8E` (`version.json` + `js/app/version.js`).
- Help tooltip legend for ROM status and top-menu icons in `jsA8E`.

### Changed
- Improved browser keyboard handling in `jsA8E` with printable key normalization and side-specific modifier mapping.
- Refined on-screen keyboard typography and responsive key label sizing in `jsA8E`.

### Fixed
- Native `A8E` event loop now forwards only keyboard events to `AtariIoKeyboardEvent`, avoiding non-key event forwarding.
