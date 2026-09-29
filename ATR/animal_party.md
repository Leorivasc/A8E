# Animal Party investigation

## Scope and status

This file records the Animal Party disk-load investigation, the generic SIO
correction it motivated, and the title-level validation. The original detailed
chronology is retained in [10Sept26.md](10Sept26.md#animal-party).

As of 2026-09-24, Animal Party completes its load in jsA8E, accepts the
joystick-button transition, completes the subsequent disk load, and has been
verified in gameplay. A dedicated automated fixture and a same-starting-point
comparison against Altirra or real hardware remain useful follow-up work, but
are not blockers for the observed successful run.

## Symptom and investigation

The game reached its bitmap presentation with music. After pressing the
joystick button, the expected green memory-display glitch appeared, but the
second disk load did not complete in jsA8E. SIO Turbo was disabled during this
test, ruling out the UI load-speed option as the trigger.

The investigation followed the button-triggered loader path using its DCB,
program counters `$A527` and `$A52B`, POKEY serial registers, vectors,
disassembly, and SIO events. The observations showed the loader returning to
its boot-load path after the button. The detailed captures established where
to compare the SIO transaction; they did not justify a game-specific response
or a timing workaround.

## Generic fix

Disk `READ` uses two distinct SIO response phases under the AHRM model:

1. The drive first returns the command acknowledgment (`A`).
2. After the acknowledgment is consumed, the drive returns Complete (`C`),
   sector data, and its checksum.

The emulator now queues the data phase separately instead of presenting the
entire response in the acknowledgment phase. The pending read size/phase is
preserved in emulator state and snapshots so a save/load between phases does
not merge or lose the response. Native A8E was synchronized with the same read
phase behavior.

This is generic SIO behavior. It applies to disk reads generally and does not
recognize Animal Party, fabricate title-specific bytes, or change disk timing
for one program.

## Validation and coverage

- With SIO Turbo off, the tested image completes the button-triggered second
  load and starts gameplay in jsA8E.
- The generic automation suite passes, and the title has been manually
  verified in gameplay.
- The existing `pokey_sio_disk_observer.test.js` exercises disk writes and
  observer notifications; it does **not** directly test READ acknowledgment
  and Complete/data framing. A focused automated test for the two READ phases
  and snapshot preservation remains optional follow-up work.
- A full Altirra or real-hardware trace comparison has not been recorded.

## Relevant implementation

The response phases and pending-read state are handled in
`jsA8E/js/core/pokey_sio.js`, with state and media integration in
`jsA8E/js/core/{state,memory,io}.js`; the worker/API boundary is in
`jsA8E/emulator_worker.js` and `jsA8E/js/core/app_proxy.js`. Native phase
parity is implemented in `A8E/Pokey.c`. The temporary game-specific CDP capture
script was removed after the investigation; the reusable automation API and
generic SIO tests remain.

## AHRM scope

The implementation follows the SIO command-acknowledgment and Complete/data
phases. Any remaining mismatch should be isolated with command, timing,
checksum, disk-geometry, or CPU-handoff evidence before further changes.
