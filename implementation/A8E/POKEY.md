# POKEY

> Hardware emulation reference: Before implementing any Atari 800 XL PAL/NTSC hardware emulation, use the [AHRM](/AHRM/index.md) as reference.

- Files: `A8E/Pokey.c`, `A8E/Pokey.h`
- Purpose: provide sound generation, timers, keyboard, and serial timing.
- Status: AHRM-08 in progress. The digital timer/SIO and paddle contracts are
  certified at their documented scope; analog audio calibration remains open.
- Notes: digital high-pass filter behavior is implemented (AUDCTL-controlled); volume-only paths can bypass filtering. Mixer uses an AHRM-informed, approximately binary-weighted 4-bit DAC table (`g_pokey_chan_vol`) with wider transitions at 3->4, 7->8, and 11->12. Unipolar mixer output is DC-blocked via a first-order high-pass filter (~20 Hz cutoff) before int16 output. POKEY timer restarts and SIO deadlines are scheduled from the master `llCycleCounter`, matching the DLI/event clock used by the current non-cycle-exact CPU core so longer runs do not depend on in-line beam-clock ownership. Standard SIO output derives its clock from timer 4 in `SKCTL` modes 2 and 4, and from timer 2 in modes 6 and 7. `SEROUT` models the AHRM holding-register delay: the byte transfers to the shift register on the next output-clock edge, `DATA NEEDED` is asserted there, `XMTDONE` is inactive while the ten-bit frame shifts, and completion is scheduled after the frame. External-clock modes 0-1 and asynchronous-input modes 3/5 do not receive synthetic output deadlines; `XMTDONE` remains active while no output clock is available. `STIMER` reloads timers without firing them and clears stale timer IRQ flags, matching AHRM 5.3/5.7. IRQ requests collapse to the currently active POKEY level when `IRQEN` changes. A latched source with its `IRQEN` bit clear keeps `IRQST` high and loses its event; XMTDONE remains the documented level-sensitive exception. This prevents disabled timer edges from masking keyboard IRQ dispatch. Pot scans now keep an accumulated counter instead of deriving reads from a fixed 28-cycle divider: slow scans advance once per scanline, fast scans advance once per machine cycle and can reach `229`, `ALLPOT` bits stay high per input until that input latches, and the scan remains active through the terminal hold cycle even if every `ALLPOT` bit has already dropped to `0`. `AUDF=0` is treated as the minimum valid timer divisor rather than as a disabled timer.
- Issues: The count-based paddle model implements residual charge after an early
  `POTGO` and live `ALLPOT` reassertion when an input drops below the current
  count. Its idle discharge curve and thresholds are deterministic
  approximations, not a calibrated capacitor-voltage model. The host audio
  path still needs reference-capture calibration for perceived volume,
  clipping, and browser/native output differences. jsA8E now uses
  cycle-accurate audio stepping for linked POKEY timer modes, matching the
  native stepping model; Prince of Persia passed the Chromium auditory
  regression check. jsA8E has one accepted AHRM-08 phase-matrix deviation:
  with the diagnostic's `P1` STIMER-to-SEROUT padding, the guest polling count
  is `05` rather than Altirra/hardware's `00`. The current native trace shows
  P1 entering with the serial divide-by-two phase low and selecting the next
  timer edge, while jsA8E enters with the phase high and waits one extra
  output-clock period; P2/P4 show the expected high-phase behavior in both.
  This can affect only cycle-tight IRQST polling or immediate SEROUT rewrites.
  The documented follow-up is CPU timed-event/initialization arbitration, not
  a padding-specific offset or timer-period change.
- Bosconian validation: inactive timers are armed when software supplies valid AUDF/AUDCTL or SKCTL configuration after an earlier STIMER, without resetting an already-running timer phase. This is required by Bosconian's digitized-voice routine.
- Todo: model the remaining serial overrun/framing and timer phase details,
  then consider reducing dB-per-step or increasing normalization gain to
  improve single-channel perceived loudness; verify volume balance against
  browser (`jsA8E/`) POKEY output and real hardware recordings; extend the
  pot model beyond the current count-based approximation if paddle input
  support is expanded. The shared eight-mode SIO clock and timer-period
  contract is covered by native and JS probes. Linked low-channel audio pulses
  are covered by implementation regressions only indirectly through the audio
  paths; they have no cross-core JSONL waveform contract because host sample
  generation is deliberately outside AHRM-09's digital harness.
### DAC Volume Parity

The native mixer now uses the same AHRM-informed, approximately binary-weighted
4-bit DAC table as jsA8E, including wider transitions at volume changes 3->4,
7->8, and 11->12. The values are an approximation and still require
calibration against real POKEY captures or a reference emulator.

### CPU Boundary Diagnostic

The opt-in POKEY trace now includes `pc` and `opcode` for register writes and
timed serial events. Native A8E emits these fields with `VERBOSE_SIO`; jsA8E
emits them in the JSON record enabled by `?a8e_pokey_trace=1`. Reuse
`AHRM08_POKEY_MATRIX_TEST.XEX` and compare the `STIMER_WRITE`,
`TIMER_RESET_APPLY`, `SEROUT_WRITE`, `DATA_NEEDED`, and `TRANSMISSION_DONE`
records. The fields are diagnostic only and do not alter CPU or POKEY timing.
