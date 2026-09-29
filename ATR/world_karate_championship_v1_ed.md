# World Karate Championship (v1,ED) / Karate Champion investigation

## Scope

This file records the compatibility investigation for the World Karate
Championship (v1,ED) disk release, referred to as Karate Champion in the
September work summary. It covers the observed demo-to-game failure, the
generic interrupt fix, and validation. The detailed chronological account is
in [10Sept26.md](10Sept26.md#karate-champion).

## Verified status

As of 2026-09-24, the game loads and executes in jsA8E. Starting from the demo,
pressing START completes the transition into the game, and a tournament can be
started normally. The startup and main execution path are considered verified
in the browser emulator.

## Symptom and investigation

The disk loaded and the demo displayed animated rainbow text. After START, the
machine could hang or fail to reach gameplay while the display animation
continued, showing that execution had not stopped completely. The investigation
focused on closely spaced DLI/VBI-generated NMI events and CPU interrupt state.
The suspected failure was that a new NMI edge could be lost while the previous
NMI handler was still active.

Temporary DLI/VBI/NMI counters and Chrome automation traces were used to inspect
scheduled, latched, coalesced, suppressed, requested, and serviced events, as
well as the CPU's pending/active state and last event location. These counters
were investigative instrumentation, not a title-specific emulation path, and
were removed in the 2026-09-15 cleanup. The general-purpose automation debugger
remains available.

## Generic fix

The JavaScript 6502 core no longer uses a software `nmiActive` guard to discard
a new NMI edge while an earlier handler is active. It retains one pending NMI
condition and services it according to CPU interrupt state, without building
an unbounded queue. The native C core received the corresponding change. This
is a generic CPU interrupt correction: the emulator does not detect the title
or force a game-specific jump, interrupt, or timing adjustment.

### Separate POKEY timer change

A late POKEY timer-arming correction was made during the same development
period. It schedules an inactive timer when valid AUDF/AUDCTL/SKCTL settings
arrive after STIMER, while preserving an already-running timer's phase. The
original fix and validation target were Bosconian; the Karate investigation
does not establish that this timer change was required for the demo-to-game
transition. It should be treated as adjacent generic work, not as the proven
cause of the Karate issue.

## Validation and files

- `jsA8E/tests/cpu_interrupt_step_regression.test.js` covers accepting a
  pending NMI while another handler is active.
- The browser game was verified through the demo-to-game transition and into
  tournament startup.
- The lasting fix is in `jsA8E/js/core/cpu.js` and `A8E/6502.c`.
- The separate POKEY timer correction is in `jsA8E/js/core/{pokey,io,atari}.js`
  and `A8E/Pokey.c`.

## AHRM scope

The fix follows the 6502 NMI edge/pending behavior rather than introducing a
game workaround. It retains one pending NMI condition and does not create an
artificial queue of interrupt edges.
