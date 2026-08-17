# jsA8E Continuation Notes

This file is a handoff note for the next session.

## What we were trying to do

- Restore the browser-side memory-expansion selector after the PAL/NTSC work had been reset to a clean baseline.
- Keep the implementation limited to `jsA8E` and avoid touching unrelated emulator code.
- Verify that the selected memory profile travels from the UI into the boot/reset path and then into the memory map.

## What was verified

- PAL and NTSC selection is working again.
- `peek(53268)` distinguishes the video standard as expected from the browser console.
- 128K and several RAMBO profiles can be detected, but the COMPY variants still fail validation.
- 1088K is still not reliable and should be treated as unresolved.

## What is still broken

- COMPY 320K and COMPY 576K are not yet compatible with the current memory mapping path.
- 1088K does not behave correctly in the current implementation.
- The menu marks those entries as `Nonfunctional` so the UI reflects the current status honestly.

## Important AHRM reminders

- COMPY expansions use separate ANTIC access behavior, unlike the simpler RAMBO cases.
- RAMBO and COMPY profiles do not share the same banking pattern.
- The 1088K mapping is the most complex variant and likely needs a careful bit-by-bit comparison against AHRM and Altirra.

## Likely next debugging targets

- Compare `PORTB` banking bits against AHRM and Altirra for COMPY and 1088K.
- Re-check how the CPU and ANTIC windows are restored after bank changes.
- Confirm that BASIC / self-test mapping bits are preserved exactly when extended memory is active.
- Verify whether the banked window should be mirrored, inverted, or held separately for specific profiles.

## Relevant files

- `jsA8E/index.html`
- `jsA8E/js/app/ui.js`
- `jsA8E/js/core/app_proxy.js`
- `jsA8E/js/core/atari.js`
- `jsA8E/js/core/io.js`
- `jsA8E/js/core/memory.js`
- `jsA8E/js/core/state.js`
- `jsA8E/emulator_worker.js`

## Short summary for the next session

The clean PAL/NTSC base is good. The remaining work is memory-expansion correctness, especially COMPY and 1088K. Start by comparing the current banking logic with AHRM before making more changes.
