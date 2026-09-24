# Animal Party investigation

## Scope

This file records the compatibility investigation for Animal Party. It is the
title-specific place for SIO observations, applied generic fixes, validation
results, and future tests. The implementation must remain AHRM-driven and
must not fabricate disk responses for this title.

## Current verified status

As of 2026-09-24, Animal Party loads successfully in jsA8E and has been
verified during gameplay. The generic SIO response-phase correction is
considered effective for this title. A dedicated automated regression fixture
and a full Altirra/hardware trace comparison remain optional follow-up work,
not blockers for the validated startup and gameplay path.

## Symptom and technical area

The investigation focused on disk `READ` response timing. The Atari SIO
protocol separates the command acknowledgment from the later Complete/data/
checksum phase. Treating the whole response as one immediate result can make a
loader observe the wrong phase or advance its state machine too early.

The original observation was recorded as an Animal Party compatibility issue,
but the available evidence does not yet prove that every startup failure is
caused by this SIO phase handling. Title-level tracing is still required.

## Generic solution applied

The JavaScript core now models disk `READ` responses as two phases:

- the command acknowledgment is delivered first;
- the Complete/data/checksum response is queued and delivered later.

The pending response phase is preserved through snapshots. The same generic
behavior is also represented in the native POKEY/SIO path. Disk high-speed
index queries use the documented `$3F` request, while absent Type 1/3/4
peripherals are routed silently instead of receiving fabricated responses.

These changes apply to the AHRM SIO model as a whole. They do not recognize
Animal Party, return title-specific bytes, or alter disk timing only for one
program.

## Validation

- The SIO regression suite covers response sequencing and disk observers.
- Snapshot behavior preserves the pending SIO response phase.
- The change was initially documented as the first Animal Party compatibility
  experiment.
- Animal Party now completes its load and has been verified during gameplay.
- A trace comparison with Altirra or real hardware would provide additional
  evidence, but is not required for the current validated status.

## AHRM scope

The implementation follows the documented SIO acknowledgment and completion
phases. It does not add a fabricated response, bypass the SIO state machine,
or special-case the title. Any remaining mismatch must be isolated through a
command, timing, checksum, disk geometry, or interrupt trace before further
changes are made.

## Next steps

1. Capture Animal Party's D1 command stream, response phases, sector numbers,
   checksums, and CPU handoff during startup if a deeper comparison is needed.
2. Add a focused regression fixture using the validated SIO behavior.
