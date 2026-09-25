# POKEY

> Hardware emulation reference: Before implementing any Atari 800 XL PAL/NTSC hardware emulation, use the [AHRM](/AHRM/index.md) as reference.

- Files: `A8E/Pokey.c`, `A8E/Pokey.h`
- Purpose: provide sound generation, timers, keyboard, and serial timing.
- Status: AHRM-08 in progress; digital timer/SIO behavior is being closed before analog calibration.
- Notes: digital high-pass filter behavior is implemented (AUDCTL-controlled); volume-only paths can bypass filtering. Mixer uses an AHRM-informed, approximately binary-weighted 4-bit DAC table (`g_pokey_chan_vol`) with wider transitions at 3->4, 7->8, and 11->12. Unipolar mixer output is DC-blocked via a first-order high-pass filter (~20 Hz cutoff) before int16 output. POKEY timer restarts and SIO deadlines are scheduled from the master `llCycleCounter`, matching the DLI/event clock used by the current non-cycle-exact CPU core so longer runs do not depend on in-line beam-clock ownership. Standard SIO output now derives its data-needed and completion deadlines from the configured timer-4 period in modes 2/3 (`SKCTL` bits 4-6), with the legacy fixed delay retained for external-clock/unconfigured modes. IRQ requests collapse to the currently active POKEY level when `IRQEN` changes, so disabling a source does not leave a stale queued IRQ; re-enabling an already asserted source also reasserts the CPU IRQ level. This is required for consecutive keyboard interrupts, where the keyboard IRQ remains latched until the OS acknowledges it. Pot scans now keep an accumulated counter instead of deriving reads from a fixed 28-cycle divider: slow scans advance once per scanline, fast scans advance once per machine cycle and can reach `229`, `ALLPOT` bits stay high per input until that input latches, and the scan remains active through the terminal hold cycle even if every `ALLPOT` bit has already dropped to `0`. `AUDF=0` is treated as the minimum valid timer divisor rather than as a disabled timer.
- Issues: The current digital pot model does not emulate capacitor discharge bias or analog threshold changes that can make `ALLPOT` reassert mid-scan. The host audio path still needs reference-capture calibration for perceived volume, clipping, and browser/native output differences.
- Bosconian validation: inactive timers are armed when software supplies valid AUDF/AUDCTL or SKCTL configuration after an earlier STIMER, without resetting an already-running timer phase. This is required by Bosconian's digitized-voice routine.
- Todo: add cross-core timer/SIO fixtures, model the remaining serial overrun/framing and timer phase details, then consider reducing dB-per-step or increasing normalization gain to improve single-channel perceived loudness; verify volume balance against browser (`jsA8E/`) POKEY output and real hardware recordings; extend the pot model beyond the current count-based approximation if paddle input support is expanded.
### DAC Volume Parity

The native mixer now uses the same AHRM-informed, approximately binary-weighted
4-bit DAC table as jsA8E, including wider transitions at volume changes 3->4,
7->8, and 11->12. The values are an approximation and still require
calibration against real POKEY captures or a reference emulator.
