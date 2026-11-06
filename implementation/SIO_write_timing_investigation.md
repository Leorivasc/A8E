# SIO Write Timing Investigation and Resolution

## Scope

This document records the investigation of long, irregular pauses during
`SAVE` to an ATR mounted in jsA8E. The reproduction used Atari DOS 2.5 in
`D1:` and `ALPA_HEXPERT.ATR` in `D2:`:

```basic
LOAD"D2:ALPA.BAS"
SAVE"D2:OTRO.BAS"
```

The load completed normally. The save completed too, but initial versions
paused for approximately 16--20 seconds between groups of writes. Altirra
completed the same operation without those pauses.

The work applies the hardware behaviour documented by AHRM, not any copied
third-party implementation. Altirra source was consulted only to understand
the type of timing problem and was not copied.

## Symptoms and evidence

The disk image was valid: it loaded in Altirra and jsA8E could eventually
write a correct output file. The failure was protocol timing, not corrupted
ATR data or an ATR checksum calculation error.

The jsA8E SIO trace initially showed a valid sector write followed by a bad
guest data checksum. For example, a write to sector 268 produced a calculated
checksum of `$E2` while the byte sent by the Atari was `$25`. The virtual disk
correctly answered with `N` (NAK). DOS 2.5 then followed its long retry path,
which created the user-visible 16--20 second pause.

An intermediate correction removed data-frame NAKs but still occasionally
produced a bad command frame. One observed command was:

```text
Device=$32  Command=$57  AUX=$10,$01
Expected checksum=$9A  Sent checksum=$43 ('C')
```

`$43` was the prior `Complete` status. This is the historical XL/XE OS
checksum race described by AHRM 5.10, not a disk-image error.

## AHRM constraints

The solution preserves the following externally observable requirements:

- AHRM 5.6: `SEROUT` is a one-byte holding register. A write transfers only
  on a later rising serial-clock edge; `DATA NEEDED` becomes active when that
  load occurs.
- AHRM 5.6: CPU code cannot be interrupted in the middle of a 6502
  instruction. A device event may latch during an instruction but its IRQ is
  recognized at an instruction boundary.
- AHRM 5.10: early Atari OS versions can corrupt `CHKSUM` when an SIO/VBI
  interrupt occurs between the first `SEROUT` store and checksum setup. The
  resulting retry can be disproportionately long.
- AHRM 9.1: command ACK/NAK and data-frame ACK replies are device responses,
  with permitted controller processing delay. The virtual disk must not
  replace POKEY serial timing with host-time or an unrestricted fast path.

## Root cause

Several small timing inaccuracies overlapped:

1. A CPU `STA $D20D` was timestamped at the start of its instruction instead
   of its final bus cycle. This allowed POKEY's `DATA NEEDED` event to be
   scheduled too early relative to the store and the OS checksum update.
2. The JS CPU scheduler could split a 6502 instruction to service an I/O
   deadline. This made an I/O IRQ visible between portions of an instruction,
   which cannot occur on the hardware.
3. The virtual disk replied at the exact earliest response cadence on every
   transfer. That created an artificial fixed phase relationship with the
   OS VBI. It made the known OS 5.10 race occur far more often than it would
   with a separate disk controller clock and processing delay.

The later checksum traces were the effect, not the cause: disk-side checksum
validation correctly rejected bytes that the guest had actually transmitted.

## Implemented solution

The native core and jsA8E were changed in parallel.

### Correct `SEROUT` bus timestamp

Writes to `$D20D` are now associated with the final bus cycle of the 6502
store. POKEY selects the next eligible serial clock edge and exposes the
output latch two cycles later. This keeps the one-byte holding register and
does not allow a second byte to overwrite it before the load.

Relevant code:

- `A8E/AtariIo.c`, `A8E/Pokey.c`, `A8E/Pokey.h`
- `jsA8E/js/core/io.js`, `jsA8E/js/core/pokey.js`,
  `jsA8E/js/core/pokey_sio.js`

### Instruction-boundary I/O dispatch

The JS CPU no longer divides an executing instruction solely to dispatch an
I/O deadline. Timed I/O state still latches at its precise emulated cycle;
the associated IRQ is dispatched when the current 6502 instruction completes.
This is specifically covered by
`jsA8E/tests/cpu_interrupt_step_regression.test.js`.

### Finite virtual-disk controller turn-around

The virtual disk now has a 640 CPU-cycle controller turn-around before the
existing 1530-cycle first-byte serial visibility delay. The complete first
response delay is therefore 2170 cycles, about 1.21 ms at the Atari clock.
It is within the AHRM 9.1 response interval and is modelled as a device delay,
not as a POKEY timing change.

The purpose is not to hide errors or bypass SIO. It prevents a virtual device
from replying at an unrealistically identical phase on every transaction and
thereby repeatedly aligning with the OS VBI race.

The named constants are:

```text
SERIAL_INPUT_FIRST_DATA_READY_CYCLES       1530
SIO_DISK_RESPONSE_TURNAROUND_CYCLES         640
```

### Preserved SIO behaviour

- The PIA CB2 `COMMAND` wire remains active-low and is the authority for
  command-frame completion.
- Write/Put/Verify retain the one-byte POKEY holding register and checksum
  validation. Their bounded data-phase window does not skip serial clock
  edges.
- Invalid data frames still receive NAK. Invalid command frames for absent
  devices remain silent, avoiding interference with other SIO devices.
- All delays are derived from emulated CPU cycles, never host wall-clock time.

## Validation

Focused regressions:

```powershell
Set-Location jsA8E
node tests\cpu_interrupt_step_regression.test.js
node tests\pokey_sio_burst.test.js
npm.cmd run test:automation
```

The complete jsA8E automation suite passed after the changes.

`pokey_sio_burst.test.js` verifies final-bus-cycle `SEROUT` scheduling,
POKEY-clocked transfer cadence, checksum closure, and the combined controller
plus first-byte response delay.

The final live Chrome/CDP trace, captured during this investigation, recorded:

- no `SIO_COMMAND_DROPPED` events;
- no data-frame NAKs;
- successful writes to sectors 266--277, followed by DOS metadata work;
- regular sector-write completion intervals of approximately 145--148 thousand
  CPU cycles;
- the expected final directory/VTOC sequence: read sector 361, then writes to
  sectors 361 and 360.

## Expected remaining activity

A save is not an uninterrupted stream of file-data writes. DOS 2.5 allocates
and closes the file, and updates directory/VTOC metadata. The final metadata
read and writes can create a short audible or visible change in disk activity.
This is normal filesystem work and is distinct from the former multi-second
retry pause.

The detailed per-byte investigation trace was removed after validation to keep
the production core lean. The issue is considered resolved when a save shows
no multi-second pause and the regression suite passes.

## Diagnostic procedure if it regresses

1. Reproduce the save with browser remote debugging enabled and run the
   focused SIO and CPU regressions listed above.
2. If a new trace is needed, add narrowly scoped temporary instrumentation;
   remove it after the timing contract is reproduced and covered by a test.
3. A dropped command with a prior status byte such as `$43` in its checksum
   field indicates the AHRM 5.10 OS race. Inspect the `SEROUT` bus timestamp,
   serial-edge timing, CPU instruction boundary, and response phase.
4. Do not solve a trace failure by disabling checksum verification, forcing
   success, or using wall-clock throttling. Those changes would mask the
   problem and violate the SIO model.
