# PIA

> Hardware emulation reference: Before implementing any Atari 800 XL PAL machine related hardware emulation, use the [AHRM](/AHRM/index.md) as reference.

- Files: `A8E/Pia.c`, `A8E/Pia.h`
- Purpose: manage port control and ROM/bank switching control paths.
- Status: verified on 2026-09-10 (`implemented`), including native 130XE banking.
- Notes: port state affects system mapping and input/control behavior. In the 130XE profile, `PORTB` bits 2-3 select the extended 16K bank, bit 4 controls the CPU window, and bit 5 controls the independent ANTIC window. The main `$4000-$7FFF` RAM is shadowed while the CPU window is active and restored when it is disabled.
- Issues: larger RAMBO and COMPY banking profiles are not implemented.
- Todo: add short notes when bank/port side effects are changed.

