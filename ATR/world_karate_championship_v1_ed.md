# World Karate Championship (v1,ED) investigation

## Scope

This file records the compatibility investigation for World Karate
Championship (v1,ED). It is the title-specific place for symptoms, timing
observations, applied generic fixes, and validation results. No title-specific
emulator patch should be added without first demonstrating an AHRM hardware
mismatch.

## Current verified status

As of 2026-09-24, World Karate Championship (v1,ED) loads and executes in
jsA8E. A tournament can be started normally, so the title's startup and main
execution path are considered complete in the browser emulator.

## Symptom and technical area

The investigation identified a possible DLI/NMI timing problem during startup.
The relevant symptom was that a new NMI edge could be lost while an earlier
NMI handler was still active. This can affect software that relies on closely
spaced display-list interrupts for its startup display and timing state.

The observed behavior was addressed by the generic interrupt correction below;
the successful browser run now confirms that the title reaches normal tournament
execution.

## Generic solution applied

The JavaScript 6502 core no longer uses a software `nmiActive` mask to discard
a new NMI edge while an earlier NMI handler is active. One pending NMI edge is
retained and dispatched according to the CPU interrupt state; the single
pending flag still prevents an unbounded queue. This follows the AHRM model
more closely than suppressing the edge based on software handler state.

Non-invasive DLI/VBI/NMI diagnostics were also added. They expose scheduled,
latched, requested, coalesced, suppressed, and serviced events, together with
the last event location and CPU pending/active state. These counters do not
change emulation behavior.

The fix is generic and is shared by all software using the 6502 NMI path. It
does not identify World Karate Championship at runtime or force a title-
specific jump, interrupt, or timing adjustment.

## Validation

- The NMI regression test covers accepting a pending NMI edge while an earlier
  NMI handler is active.
- Generic browser CPU, ANTIC, and automation regressions pass.
- World Karate Championship (v1,ED) loads successfully in jsA8E.
- The game executes normally and allows a tournament to be started.
- The title-specific startup and gameplay path is considered complete in
  jsA8E.

## AHRM scope

The change follows the AHRM interrupt behavior rather than adding a game
workaround. The emulator keeps one pending NMI condition and does not create
an artificial queue of interrupt edges.

