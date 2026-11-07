# Atari I/O and System Glue

> Hardware emulation reference: Before implementing any Atari 800 XL PAL/NTSC hardware emulation, use the [AHRM](/AHRM/index.md) as reference.

- Files: `A8E/AtariIo.c`, `A8E/AtariIo.h`, `A8E/A8E.c`, `A8E/Gamepad.c`, `A8E/Gamepad.h`
- Purpose: connect chips, run main emulation loop, and handle boot/device I/O flow.
- Status: verified on 2026-09-14 (`implemented`), including native AHRM
  130XE, RAMBO, COMPY, and initial Ultimate1MB memory expansion.
- Notes: central integration point for ROM, disk, interrupts, scanline-timed events, platform runtime behavior, and command-line memory-profile selection.
- Gamepad (2026-11-07): `Gamepad.c` starts the SDL joystick subsystem (a
  failure is logged and ignored), opens up to four joysticks on
  `SDL_JOYDEVICEADDED` and closes them on `SDL_JOYDEVICEREMOVED`. Each frame,
  after the event loop, `A8E.c` calls `Gamepad_Poll` (axes 0/1 past half range
  or the first hat for directions; buttons 0-3 fire; pads merged, opposite
  directions cancel) and passes the result to `AtariIoGamepadState`, which
  clears or sets `PORTA` bits 0-3 and `TRIG0`. It only touches the bits it
  holds, so the keyboard path and its `cJoystickArrowMask` are unchanged and a
  key-held direction stays pressed. Uses the plain SDL joystick API instead of
  SDL_GameController so no mapping database is needed. Known limit: pad fire
  and `LCTRL` share `TRIG0`, so releasing the pad button releases the trigger
  even if Left Control is still held.
- Issues: disassembly mode (F12, when enabled) is one-way until emulator
  restart. U1MB firmware-dependent BIOS/flash/RTC/PBI features are not
  emulated.
- VBXE (stages 1-2): `A8E/Vbxe.c`/`Vbxe.h`, enabled with `--vbxe[=PROFILE]` and
  attached through `AtariIoEnableVbxe()`. It owns the `$D640`/`$D740` register
  bank, 512 KiB VRAM, MEMAC A/B windows (installed as access handlers over
  RAM-mapped addresses only, rebuilt by `Pia.c` when the OS/BASIC/Self-test
  mapping changes), the blitter and its IRQ. Integration points: `6502.c`
  (`pfnFetchStage`/`pfnFetchRestore` stage instruction bytes from VRAM for code
  that runs inside a window), `AtariIo.c` (ANTIC reads through MEMAC, the
  end-of-line blitter budget after `AtariIoDrawLine`, `llVbxeIrqCycle` for a
  completion inside the line, vertical sync at frame wrap) and `Pia.c`
  (`Pia_IrqAsserted` includes the VBXE line). Stage 2 is `A8E/VbxeVideo.c`: the XDL parser, overlay, attribute
  map and playfield palettes are composed per visible line by
  `Vbxe_ComposeLine` right after `AtariIoDrawLine` into an ARGB overlay plane
  that `AtariIoDrawScreen` copies over the 8-bit frame; XDL/overlay/map DMA
  slots reduce the blitter budget. See `implementation/VBXE.md`.
- Todo: update notes when loop/timing ownership moves between modules.

