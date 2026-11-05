# Atari I/O and System Glue

> Hardware emulation reference: Before implementing any Atari 800 XL PAL/NTSC hardware emulation, use the [AHRM](/AHRM/index.md) as reference.

- Files: `A8E/AtariIo.c`, `A8E/AtariIo.h`, `A8E/A8E.c`
- Purpose: connect chips, run main emulation loop, and handle boot/device I/O flow.
- Status: verified on 2026-09-14 (`implemented`), including native AHRM
  130XE, RAMBO, COMPY, and initial Ultimate1MB memory expansion.
- Notes: central integration point for ROM, disk, interrupts, scanline-timed events, platform runtime behavior, and command-line memory-profile selection.
- Issues: disassembly mode (F12, when enabled) is one-way until emulator
  restart. U1MB firmware-dependent BIOS/flash/RTC/PBI features are not
  emulated.
- VBXE (stage 1): `A8E/Vbxe.c`/`Vbxe.h`, enabled with `--vbxe[=PROFILE]` and
  attached through `AtariIoEnableVbxe()`. It owns the `$D640`/`$D740` register
  bank, 512 KiB VRAM, MEMAC A/B windows (installed as access handlers over
  RAM-mapped addresses only, rebuilt by `Pia.c` when the OS/BASIC/Self-test
  mapping changes), the blitter and its IRQ. Integration points: `6502.c`
  (`pfnFetchStage`/`pfnFetchRestore` stage instruction bytes from VRAM for code
  that runs inside a window), `AtariIo.c` (ANTIC reads through MEMAC, the
  end-of-line blitter budget after `AtariIoDrawLine`, `llVbxeIrqCycle` for a
  completion inside the line, vertical sync at frame wrap) and `Pia.c`
  (`Pia_IrqAsserted` includes the VBXE line). There is no XDL, overlay or video
  output yet; see `implementation/VBXE.md`.
- Todo: update notes when loop/timing ownership moves between modules.

