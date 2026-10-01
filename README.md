# A8E (Atari 800 XL Emulator)

> Hardware emulation reference: Before implementing any Atari 800 XL PAL/NTSC hardware emulation, use the [AHRM](/AHRM/index.md) as reference.

[OPEN HERE](/jsA8E/index.html)

<img src="jsA8E/a8e.webp" alt="A8E Logo" width="800">

Atari 800 XL emulator with two implementations in this repository:

- `A8E/`: native C/SDL emulator
- `jsA8E/`: browser JavaScript port (WebGL with optional CRT post-process, plus 2D canvas fallback)

The original codebase is by Sascha Springer (2004). Each subproject has its own README with detailed usage/build notes.

## Repository Layout

| Directory | Description |
|-----------|-------------|
| `A8E/` | [Native C/SDL code and CMake project](A8E/README.md) |
| `jsA8E/` | [Browser app (`index.html` + JavaScript modules + shaders)](jsA8E/README.md) |

## Hardware Reference

For hardware behavior and register-level details, use the local [AHRM index](AHRM/index.md), based on the Altirra Hardware Reference Manual.

Special thanks to Avery Lee for creating the Altirra Hardware Reference Manual:
https://www.virtualdub.org/downloads/Altirra%20Hardware%20Reference%20Manual.pdf

## Current Emulation Status

Both emulator cores currently include the following raster-timing behavior:

- Visible scanlines now render playfield/background state on the per-color-clock path.
- Visible player/missile output is interleaved on the scanline timing path in both implementations.
- Visible blank/background-only lines now spend the initial color-burst clocks invisibly before drawing the live-read remainder of the line.
- The VBI follows the AHRM cycle-7 NMIST / cycle-8 NMI model with full NMIEN cycle-7/8 gating, matching the DLI path.
- Vertical scrolling runs on a live 4-bit mode-line row counter with the AHRM VSCROL deadlines (entry latch at cycle 0, exit comparison through cycle 108, DLI decision through cycle 5), enabling GTIA 9++-style extended mode lines and mid-line VSCROL rewrites.
- Mid-scanline CHBASE writes latch with the AHRM 2-color-clock delay in both cores.
- POKEY timer, serial, paddle, and keyboard-IRQ behavior is covered by shared native/JavaScript regression contracts; linked timer modes retain their intermediate audio transitions.
- Player/missile DMA follows the AHRM DMACTL timing gate, VDELAY latch behavior, and the current GTIA/PMG compositor model.

PAL and NTSC machine timing, palettes, `$D014`, POKEY behavior, XEX/ATR loading, and the browser WebGL/2D rendering paths are implemented in the corresponding native and browser cores.

The legacy-style per-color-clock rendering pass is implemented in both cores. The AHRM-07 synthetic PMG/GTIA diagnostic is certified for its stated scope; broader title-level visual comparisons, analog POKEY calibration, and the accepted jsA8E P1 CPU/POKEY phase follow-up remain separate validation work.

For the current verification checklist and signoff notes, see [legacy/COLOR_CLOCK_ACCURACY.md](legacy/COLOR_CLOCK_ACCURACY.md).

### Extended Memory

The native and browser implementations support the AHRM memory-map profiles below. The native version selects them on the command line; the browser version exposes them in the Memory selector and through the automation API.

| Profile | Native switch | Browser/API profile |
|---------|---------------|---------------------|
| 64K | *(native default)* | `none` |
| 128K (130XE) | `-128K` | `130xe-128k` *(browser default)* |
| 192K (RAMBO) | `-192R` | `rambo-192k` |
| 256K (RAMBO) | `-256R` | `rambo-256k` |
| 320K (RAMBO) | `-320R` | `rambo-320k` |
| 320K (COMPY) | `-320C` | `compy-320k` |
| 576K (RAMBO) | `-576R` | `rambo-576k` |
| 576K (COMPY) | `-576C` | `compy-576k` |
| 1088K (RAMBO) | `-1088R` | `rambo-1088k` |
| Ultimate1MB (1MB) | `-U1MB` | `ultimate1mb` *(WIP)* |

RAMBO and COMPY bank-bit layouts, CPU/ANTIC window behavior, BASIC/Self-Test overlays, and bank persistence are implemented and covered by native and browser regression probes. Ultimate1MB currently provides its AHRM memory mapping and core UCTL/UAUX/COLDF control-register behavior, including selectable 64K, 320K, 576K, and 1088K modes. Ultimate1MB BIOS/flash, RTC, PBI devices, and external peripheral images are not yet emulated.

The repository includes two standalone Atari diagnostics for expanded-memory validation: [`U1MB_MEMORY_TEST.XEX`](implementation/U1MB_MEMORY_TEST.XEX) performs full bank, system-window, configuration, and visual ANTIC checks; [`MEMORY_STRESS_TEST.XEX`](implementation/MEMORY_STRESS_TEST.XEX) performs repeated bank-switching and PORTB-map checks. See [implementation/memory_tests.md](implementation/memory_tests.md).

### Browser Presentation

The browser toolbar includes a persistent **CRT** toggle. CRT is enabled by
default; disabling it bypasses the WebGL post-process and renders the indexed
framebuffer and palette directly with nearest-neighbor sampling for a clean,
sharp image. The setting applies immediately in both worker and main-thread
backends and is saved between sessions. The 2D canvas fallback already renders
without CRT post-processing.

The presentation selector provides `Emulation`, `Work`, and `Development`
layouts. The selected layout is saved locally; `Work` is the default when no
preference exists. The toolbar also provides display and workspace fullscreen,
CPU and SIO turbo, audio, virtual joystick and keyboard, HostFS, Disk Library,
assembler/debugger, and snapshot controls.

When no explicit or saved machine preference exists, jsA8E starts with NTSC
timing and 128K (130XE) memory. The PAL and 64K profiles remain available in
the selectors and API.

At mobile widths, the browser presentation uses a compact lifecycle toolbar,
a fixed bottom action bar, and focused overlays for the existing tool panels so
the screen remains the primary view.

### Regression Tests

The browser regression suite can be run without a browser or ROM files:

```sh
cd jsA8E
npm run test:automation
```

The native CMake project includes probe targets for ANTIC timing, ANTIC DMA and graphics modes, POKEY POT scanning, and memory-expansion behavior. Configure with `-DBUILD_TESTING=ON` to include those targets in the build.

The current alignment baseline is covered by the full JavaScript automation
suite and the native CTest probes, including shared PIA/PORTB, POKEY,
ANTIC/NMI, and PMG/DMACTL contract fixtures. Detailed scope boundaries and
open validation items are tracked in [implementation/NOTES.md](implementation/NOTES.md).

### Compatibility Validation

Several programs that previously failed during loading now reach their normal
startup screens in the emulator:

- **AtariBlast** completes its mixed-geometry ATR load and reaches the game screen.
- **Amaurote Plus** starts from XEX, shows its presentation, and reaches the
  game menu after the joystick trigger instead of falling into the Atari
  self-test. Validation reached the game's `$0C00` run address with
  self-test disabled; the XEX preflight regression and full JavaScript
  automation suite passed. The generic loader now preserves its sector cursor
  across `INITAD` and selects a free buffer at `$0880` or above; see the
  [investigation](ATR/amaurote.md).
- **Mikie V1.12** completes its banked XEX load and reaches the control screen.
- **AtariWriter Plus XE** completes its 130XE startup sequence and reaches the user menu.
- **World Karate Championship (v1,ED)** (Karate Champion) reaches gameplay and
  starts a tournament after the generic NMI correction; see its
  [investigation](ATR/world_karate_championship_v1_ed.md).
- **Animal Party** completes its button-triggered second disk load and has been
  verified in gameplay after the generic SIO response-phase correction; see
  its [investigation](ATR/animal_party.md).
- **Prince of Persia** was replayed in Chromium after the linked POKEY timer
  audio correction; the previously muffled voice returned to normal. The
  regression coverage checks repeated low/high waveform edges for linked
  timer pairs 1+2 and 3+4 at 1.79 MHz, 64 kHz, and 15 kHz, with the full
  JavaScript automation suite and all 12 native CTest probes passing.

These results come from shared fixes to XEX loading, memory banking, CPU
interrupt handling, SIO response phases, and XL/XE defaults; no title-specific
workarounds are used.

## ROM Requirements

Both implementations require the following ROM dumps (not included):

- `ATARIXL.ROM` (16 KB)
- `ATARIBAS.ROM` (8 KB)

Recommended placement is the repository root:

- Native app loads ROM files from its current working directory.
- Browser app first attempts `../ATARIXL.ROM` + `../ATARIBAS.ROM` when served from repo root. If either file is absent, the user can select it through the UI; selected ROMs are retained only in that browser's origin-scoped IndexedDB so they do not need to be uploaded on every launch. The secondary controls include a button to delete those local copies. No ROM dump is embedded in the project or uploaded by this feature.

## Quick Start (Browser)

Serve the repository root with a static HTTP server, then open `jsA8E/`.

```sh
python -m http.server 8000
# open http://localhost:8000/jsA8E/
```

(`file://` is not sufficient because shader and ROM auto-load paths use `fetch()`.)

When the browser emulator starts with D1 empty, it mounts the built-in
`standby.xex` and shows disk-loading instructions through an ANTIC display
list. **Open Disk** loads and starts a selected image. Disk Library mount
changes take effect without restarting the running program, so it can request
another disk side; the library status only confirms the mount action. Use
**Full Reset** when you want to boot from the image currently mounted in D1.
See the [browser README](jsA8E/README.md) for more details.

For an online demo of the jsA8E version, visit https://jsa8e.anides.de/

The latest unreleased development version is available at https://dev.jsa8e.anides.de/

## Automation

The browser port includes a stable automation surface at `window.A8EAutomation`.

It is intended to be the canonical shared control surface for debugger/introspection workflows, artifact capture, HostFS access, assembler-driven development flows, and higher-level harnesses. The public surface is grouped into `system`, `media`, `input`, `debug`, `dev`, `artifacts`, and `events` while keeping the earlier flat aliases for compatibility.

Current highlights include worker-acknowledged lifecycle control, URL-native ROM/disk/XEX loading, structured pause/fault events, schema-versioned failure artifacts, HostFS file automation, assembler/XEX helpers, and versioned full-machine snapshot save/load through `system.saveSnapshot()` / `system.loadSnapshot()`. The repository also includes a browser-less Node bootstrap at `jsA8E/headless.js` that instantiates the same automation API against the no-worker backend.

For external agents, CI jobs, scripted regression runs, and other non-interactive control flows, prefer the browser-less bootstrap over driving the browser UI directly. It avoids DOM/worker/UI state, starts with an attached API immediately, and exposes the same grouped automation contract. For Codex-style MCP clients, `jsA8E/mcp_server.js` provides a local stdio bridge over the same runtime and grouped tool surface. See the [jsA8E README](jsA8E/README.md) for the overview and [jsA8E/AUTOMATION.md](jsA8E/AUTOMATION.md) for the full public API reference.

## Quick Start (Native)

Building requires **SDL 2** development headers. See the [A8E README](A8E/README.md) for full build instructions covering Windows (MSVC, MinGW), macOS (Homebrew), and Linux.

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j
./build/A8E/A8E
```

Ensure `ATARIXL.ROM` and `ATARIBAS.ROM` are in the current working directory before starting.

## Controls

Both implementations share the same key mappings.

### Keyboard

Type normally on the emulated Atari keyboard. **Ctrl** and **Shift** work as modifiers, matching the original Atari 800 XL layout.

### Joystick

| Key | Function |
|-----|----------|
| Arrow Keys | Joystick direction |
| **Shift** + Arrow Keys | Atari cursor keys (↑ ↓ ← →) |
| Left Alt | Fire button |

Shift + Arrow is a convenience shortcut — it sends the same key codes as **Ctrl + − / = / + / \*** on the Atari keyboard (the original cursor controls).

### Console Keys

| Key | Function |
|-----|----------|
| F2 | OPTION |
| F3 | SELECT |
| F4 | START |
| F5 | RESET |
| F8 | BREAK |

## License

Unless otherwise noted, the original A8E source code and project documentation
in this repository are copyright (C) 2004–2026 Sascha Springer and are licensed
under the GNU General Public License, version 2 only. See [LICENSE](LICENSE).

The original A8E SourceForge project listed GPLv2. This repository now states
that license explicitly. ROM dumps, disk images, the AHRM reference material,
third-party package metadata, and external libraries retain their own terms and
are not relicensed by this notice.

