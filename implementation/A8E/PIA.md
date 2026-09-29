# PIA

XL/XE `TRIG3` is the external cartridge RD5 sense line and defaults low when
no cartridge maps `$A000-$BFFF`; internal BASIC does not affect it. This
default comes from the native hardware register table and follows AHRM 2.8.

> Hardware emulation reference: Before implementing any Atari 800 XL PAL/NTSC hardware emulation, use the [AHRM](/AHRM/index.md) as reference.

- Files: `A8E/Pia.c`, `A8E/Pia.h`
- Purpose: manage port control, ROM/bank switching, control-line state, and
  PIA interrupt paths.
- Status: verified on 2026-09-24 (`implemented`), including the AHRM 130XE,
  RAMBO, COMPY, and Ultimate1MB bank maps.
- Notes: `TRIG3` now follows the no-cartridge RD5 default, and effective
  `PORTB` pull-ups/`DDRB` writes update mapping at reset and during runtime.
  `PORTB` bank bits, CPU/ANTIC window selection, live CPU-window
  visibility, motherboard-window shadowing, and BASIC/Self-Test bit reuse now
  follow the validated jsA8E model. The native U1MB surface implements the
  write-only UCTL/UAUX range and readable COLDF flag used by jsA8E; U1MB
  BIOS/flash/RTC/PBI behavior remains outside this port.
- PIA control behavior now follows AHRM 2.5 for CA1/CA2/CB1/CB2 edge
  detection, latched status, interrupt masks, ORA/ORB acknowledge, output-mode
  clearing, handshake outputs, and the documented CB2 output-to-input glitch.
  SIO command writes drive the CB2 line state without changing response bytes.
- Tests: `A8E/tests/pia_control_probe.c` and
  `jsA8E/tests/pia_control_lines.test.js` cover positive/negative edges,
  masked pending status, DDR-versus-ORA/ORB acknowledgement, output-mode
  clearing, and spurious CB2 status. Native interactive validation of the
  high-capacity profiles and dedicated modem emulation remain separate work.
- Todo: keep the profile matrix, overlay transitions, and PIA control-line
  behavior synchronized with `jsA8E/js/core/memory.js` and
  `jsA8E/js/core/io.js`.
