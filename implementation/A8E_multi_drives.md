# A8E Native Multi-Drive and Library Subproject

Status: design proposal  
Date: 2026-10-08

## Purpose

Extend the native A8E application beyond its current single-disk command-line
workflow. The goal is to provide a local disk library, multiple virtual Atari
drives, hot-swappable media, writable working copies, and a floating SDL-based
Library window.

This document describes the native A8E side of a capability that must remain
available in both native A8E and the browser-oriented `jsA8E`. The native
implementation may use SDL-specific UI and filesystem adapters, while the
browser implementation may use IndexedDB and browser UI, but their drive,
media, and SIO behavior must remain aligned.

The related browser Library Import/Export design is documented in
`library_Import_export.md`. A shared manifest or compatible data contract is
preferred where the platforms support the same operation.

## Cross-application parity policy

Every new project in this repository must be implemented and tested in both
`jsA8E` and native A8E. A feature is not considered complete while it exists
only in one application.

Platform-specific internals are allowed, but both applications must preserve
equivalent observable behavior, compatible data contracts, and corresponding
regression coverage. Temporary parity gaps must be tracked explicitly.

## Current limitations

The native application currently:

- accepts one ATR or XEX path as a command-line argument;
- defaults to `d1.atr` when no path is provided;
- stores a single disk buffer in `IoData_t` as `pDisk1` with `lDiskSize`;
- routes virtual SIO disk operations through that single disk buffer;
- reloads `D1.ATR` from the current directory when F11 is pressed;
- has no persistent disk library;
- has no D2: or multi-drive mounting interface;
- has no native Library window or workspace export/import flow.

The current implementation therefore cannot reproduce the multi-disk workflow
available in jsA8E, such as AtariWriter in D1: with a documents disk in D2:.

## Current SIO bus implementation

The native SIO path is implemented inside `A8E/Pokey.c`, primarily through the
POKEY `$D20D` `SEROUT/SERIN` register. There is no independent `SioBus` object
or per-drive device abstraction yet.

The current transaction flow is:

```text
Atari CPU
   |
   +-- writes $D20D (SEROUT)
   |
   v
Pokey_SEROUT_SERIN()
   |
   +-- collects the five command bytes
   +-- validates the checksum
   +-- executes the operation against pDisk1
   +-- queues a response for SERIN
          |
          v
Atari CPU reads $D20D (SERIN)
```

The implementation is a register- and transaction-level SIO model with
timing hooks. It does not simulate the physical serial wire bit by bit, but it
does model the POKEY serial clock, response delays, and relevant PIA CB2 line
transitions.

### Command frame

The computer sends a five-byte command frame:

```text
Device ID | Command | AUX1 | AUX2 | Checksum
```

For example, `$31 | $52 | sector_lo | sector_hi | checksum` addresses D1:
with the Read Sector command. The native implementation accumulates the frame
in `aSioBuffer`, validates the checksum, and dispatches the command from
`Pokey_SEROUT_SERIN()`.

### Responses and data phases

The current implementation uses the standard response characters:

- `A`: ACK, command accepted;
- `N`: NAK, command rejected;
- `C`: operation complete;
- `E`: operation error;
- sector data followed by a checksum.

A read transaction is represented as:

```text
Command -> ACK -> Complete + sector data + checksum
```

A write transaction is represented as:

```text
Command -> ACK -> sector data + checksum -> ACK + Complete
```

Write, Put, and Verify use a separate data-phase state. The command phase
stores the pending command, sector, and expected byte count; the following
SEROUT writes are collected until the data checksum is received.

### Supported commands

The current native SIO dispatcher supports:

- `$3F`: return high-speed index;
- `$40`: Type 3/4 poll;
- `$52`: Read Sector;
- `$53`: Status;
- `$50`: Put Sector;
- `$56`: Verify Sector;
- `$57`: Write Sector;
- `$21`: Format;
- `$55`: Motor On.

Unsupported commands are reported, but the implementation does not yet model
the full extended command and high-speed protocol set documented by the AHRM.

### ATR mapping

The mounted image is currently held in `pIoData->pDisk1`. The SIO offset logic
uses the ATR format as follows:

- the first 16 bytes are the ATR header;
- sectors 1 through 3 are always transferred as 128-byte boot sectors;
- subsequent sectors use the sector size from the ATR header;
- sector data starts after the ATR header and boot-sector area.

The mapping is implemented by `Pokey_SioSectorBytesAndOffset()`.

### Timing and electrical signals

The POKEY serial output timing is derived from `SKCTL`:

- serial modes 2 and 4 use Timer 4;
- serial modes 6 and 7 use Timer 2;
- other modes do not provide a usable output clock in this implementation.

When a byte is written to SEROUT, the emulator schedules the serial data
needed and transmission-complete events. These update the corresponding IRQ
state and allow Atari software to observe serial timing.

SERIN responses are queued with a delay before the first byte and a separate
interval between subsequent bytes. The response queue returns bytes through
the same `$D20D` register until the current response is exhausted.

The implementation also drives the PIA CB2 line. CB2 is asserted during the
command transmission and released after the command frame, following the
AHRM active-low SIO command-line behavior.

### Current SIO limitations

The following limitations must be addressed before a full multi-drive Library
can be implemented:

- normal commands are effectively backed by the single `pDisk1` image;
- there are no independent D2: through D8: disk states;
- SIO buffers, indexes, and pending-command state are static globals rather
  than per-emulator or per-drive state;
- the Device ID is not yet used to select an independent drive backend for
  normal commands;
- `$3F` recognizes D1: through D8: for the high-speed query, but this does not
  provide eight independent virtual drives;
- writes modify the ATR buffer directly;
- there is no integrated write-protection check;
- there is no dirty flag or Library callback when a disk is modified;
- motor and mechanical delays are simplified;
- only a subset of the AHRM command set is implemented;
- the existing SIO test coverage focuses primarily on timing contracts rather
  than a complete multi-drive command matrix.

## Proposed SIO architecture for multi-drive support

The drive abstraction should be separated from the POKEY register handler:

```text
POKEY SEROUT/SERIN
          |
          v
       SioBus
          |
          +-- D1: -> SioDrive -> DiskImage
          +-- D2: -> SioDrive -> DiskImage
          +-- D3: -> SioDrive -> DiskImage
          +-- ...
          +-- D8: -> SioDrive -> DiskImage
```

`SioBus` should own:

- command framing;
- checksum validation;
- ACK/NAK/Complete/Error sequencing;
- serial timing;
- Device ID decoding;
- response-byte delivery through SERIN.

Each `SioDrive` should own:

- the mounted ATR or compatible disk image;
- disk geometry and sector mapping;
- read, write, Put, Verify, Status, and Format behavior;
- write-protection state;
- motor state;
- working-copy and dirty state;
- the connection to the media repository and Library UI.

The SIO layer must select the drive from the command Device ID instead of
assuming that every valid command targets D1:. The existing D1: behavior
should remain a compatibility path while the drive collection is introduced.

The bus and drive state should be associated with the emulator context rather
than stored in file-scope static variables. This is required for clean tests,
multiple emulator instances, and future Library operations.

## Pluggable SIO device architecture

The long-term goal is a pluggable SIO port that can host new device types
without adding device-specific logic to the POKEY register handler. The
architecture should separate the common SIO protocol from the behavior of
disks, cassette recorders, printers, modems, and future peripherals.

```text
POKEY / PIA
    |
    v
 SioBus
    |
    +-- DiskDevice
    +-- CassetteDevice
    +-- PrinterDevice
    +-- ModemDevice
    +-- CustomDevice
```

### SioBus responsibilities

`SioBus` should own the behavior shared by all SIO peripherals:

- command-frame assembly;
- Device ID decoding;
- checksum validation;
- ACK/NAK/Complete/Error sequencing;
- SEROUT and SERIN byte delivery;
- POKEY serial timing and event scheduling;
- CB2 command-line state;
- response queues and data-phase timing;
- device registration, removal, and reset;
- absent-device and broadcast behavior.

The POKEY register handler should forward serial events to `SioBus` rather
than implementing disk or cassette commands directly.

### SioDevice responsibilities

Each device should own only its device-specific behavior:

- supported Device IDs and commands;
- device state and buffers;
- command validation specific to the device;
- read/write or input/output operations;
- device-specific latency;
- status and error behavior;
- motor or transport state where applicable;
- dirty state and persistence callbacks where applicable.

A conceptual device interface is:

```text
SioDevice
 ├─ matches(deviceId)
 ├─ beginCommand(commandFrame)
 ├─ acceptData(dataFrame)
 ├─ reset()
 └─ tick(emulatedCycle)
```

The exact C API remains open, but the interface must support asynchronous
responses and data phases. A synchronous function that immediately returns a
complete response is insufficient for disks, cassette recorders, and modems
that have observable delays.

### Transaction model

The bus should process a transaction using emulated time:

```text
receive command
    -> validate checksum
    -> select addressed device
    -> device schedules response
    -> deliver ACK or NAK
    -> process optional data phase
    -> deliver Complete or Error
```

Device implementations may request a response delay, data phase, timeout, or
additional device-specific transfer mode. The bus remains responsible for
making those phases visible through SERIN/SEROUT and the POKEY/PIA timing
model.

## AHRM compliance requirements for pluggable SIO

The AHRM specifies observable hardware behavior rather than a required class
architecture. A pluggable implementation is compliant only if the abstraction
preserves that behavior:

- standard command frames retain Device ID, command, AUX1, AUX2, and checksum;
- normal SIO baud and serial bit ordering remain correct;
- ACK, NAK, Complete, and Error sequencing remains device-appropriate;
- timing is derived from the emulated clock rather than host wall-clock time;
- POKEY `SEROUT`, `SERIN`, `DATA NEEDED`, and `XMTDONE` behavior remains
  unchanged;
- CB2 continues to model the active-low SIO command line;
- only the addressed device responds unless a documented broadcast operation
  explicitly permits otherwise;
- absent devices remain silent or report the correct protocol result;
- device-specific extended and high-speed protocols can opt into a custom
  transfer mode without bypassing the common bus timing;
- each device keeps independent buffers, state, and timing;
- malformed frames, checksum failures, invalid commands, and timeouts remain
  observable according to the applicable AHRM device documentation.

The abstraction itself is therefore AHRM-compatible, but an implementation
must be validated against the common SIO protocol and the relevant device
documents. The bus must remain the single authority for serial framing and
timing; pluggable devices must not write directly to POKEY or PIA state.

## Migration from the current implementation

The current native path embeds command parsing and disk operations in
`Pokey_SEROUT_SERIN()` and uses file-scope SIO buffers. Migration should be
incremental:

1. Extract command framing, checksum, and response scheduling into `SioBus`.
2. Wrap the existing D1: behavior in `DiskDevice` without changing its public
   behavior.
3. Move command and data-phase state into the emulator context or bus instance.
4. Register D1: through D8: as independent disk devices.
5. Add `CassetteDevice` using the same bus transaction interface.
6. Add printers, modems, or other devices only through the registration API.

The existing D1: command-line path must remain functional throughout the
migration.

## Testing requirements

The pluggable bus should have common protocol tests independent of any one
device:

- valid and invalid command-frame checksums;
- addressed and absent Device IDs;
- ACK/NAK/Complete/Error sequencing;
- delayed responses and data phases;
- POKEY serial timing and IRQ behavior;
- CB2 transitions;
- reset while a transaction is active;
- device removal or replacement between transactions;
- broadcast and high-speed command behavior where applicable.

Each device should then add its own command and data tests. A disk test suite
should cover sector operations, while a cassette suite should cover FSK timing
and motor state. The common bus tests must not assume that D1: is the only
registered device.

## AHRM references

The implementation should continue to use the AHRM as the protocol reference:

- [Basic SIO protocol](../AHRM/10.%20Disk%20drives/2.%20Basic%20protocol.md)
- [SIO commands](../AHRM/10.%20Disk%20drives/4.%20Commands.md)
- [SIO timing](../AHRM/10.%20Disk%20drives/5.%20Timing.md)

The basic protocol defines the common command frame, normal 19,200-baud
operation, ACK/NAK/Complete/Error conventions, sector read/write data phases,
and command timeout behavior. The command and timing documents define the
supported command families and the variations required by high-speed and
extended disk devices.

## SIO implementation phases

### Phase 1: drive collection

- Replace the single-disk assumption with D1: through D8: drive state.
- Keep the current D1: path working unchanged during migration.
- Decode Device IDs and route commands to the selected drive.
- Move command and response state into the emulator context.

### Phase 2: drive behavior and persistence

- Add write-protection checks.
- Mark drives dirty after successful writes and format operations.
- Expose safe save operations to the media repository.
- Preserve ATR geometry and command-specific status behavior.

### Phase 3: Library integration

- Mount and eject library entries through the SIO drive API.
- Reflect D1: through D8: assignments in the floating Library window.
- Save working copies without blocking the emulation loop.
- Display dirty, write-protected, and unavailable-drive states.

### Phase 4: protocol coverage

- Add command-matrix tests for D1: through D8:.
- Add read, write, Put, Verify, Status, and Format regressions.
- Expand coverage for malformed frames, checksum failures, and invalid sectors.
- Add high-speed and extended protocol behavior only where explicitly
  required by the project scope.

## Downstream subprojects

Once the pluggable SIO foundation, D1: through D8: routing, and common
transaction tests are stable, the next native SIO device should be the virtual
cassette recorder described in
[`cassete_recorder.md`](cassete_recorder.md). The cassette project depends on
this project's `SioBus` and `SioDevice` interfaces; it should not introduce a
second command parser or bypass the bus timing model.

## Target capabilities

The completed subproject should support:

- a persistent local library of ATR and XEX entries;
- drive assignments for D1: through D8:;
- mounting and ejecting disks without restarting the emulator;
- writable and write-protected drive states;
- saving modified disk images as working copies;
- disk metadata such as name, path, size, type, hash, and modification date;
- duplicate detection by content hash;
- a floating Library window accessible from the emulator;
- importing files into the library through the native UI;
- selecting an item and mounting it into a chosen drive;
- exporting/importing a workspace as a future extension.

## Proposed architecture

### Media repository

Introduce a native media repository independent of the CPU, PIA, POKEY, and
SIO emulation code. The repository owns:

- library entry metadata;
- binary ATR/XEX content;
- content hashes;
- working-copy state;
- modification timestamps;
- persistent storage paths;
- duplicate and conflict handling.

The emulator core should receive media operations through a small API such as:

```text
LibraryOpen()
LibraryList()
LibraryImport(path)
LibraryRemove(id)
LibraryMount(id, drive)
LibraryEject(drive)
LibrarySave(drive)
LibraryExportWorkspace(path)
```

The exact C naming is open, but the repository must not depend on SDL window
state or keyboard events.

### Drive state

Replace the single `pDisk1`/`lDiskSize` state with a drive collection, ideally
for D1: through D8:. Each drive should track at least:

```text
DriveState
 ├─ mounted library entry
 ├─ disk bytes
 ├─ disk size
 ├─ disk type
 ├─ write-protected flag
 ├─ dirty flag
 ├─ current revision/hash
 └─ last write timestamp
```

SIO command handling must select the drive from the device ID instead of
assuming that every operation targets D1:.

### Working copies

Writes made by the emulated Atari software must update the mounted drive's
working copy. The repository should distinguish:

- the original imported artifact;
- the current writable revision;
- an optional saved revision or backup.

Saving a drive should update the working copy atomically. A failed save must
not destroy the previous valid image.

## Native Library window

The first UI should be a lightweight floating SDL overlay rather than a
separate operating-system window. It should be opened with a dedicated
shortcut, initially proposed as F9, and closed without stopping emulation.

The MVP window should provide:

- a scrollable list of library entries;
- ATR/XEX type indicators;
- search or simple name filtering;
- target-drive selection;
- Mount, Eject, Save, Import, and Delete actions;
- write-protection control;
- dirty/unsaved status;
- confirmation before deleting or replacing a working copy.

The UI should communicate with the media repository through commands or a
small event interface. It must not directly manipulate SIO buffers.

## UI and dependency constraints

The native project currently uses SDL and does not include a general-purpose
UI toolkit. The initial Library window should therefore use a small custom UI
layer built on existing SDL rendering facilities.

Avoid adding a third-party UI dependency unless a later decision explicitly
accepts it. A built-in bitmap font or another repository-native text solution
may be required for labels and file names.

The UI must remain usable when audio or video rendering is degraded and must
not block the emulation thread while scanning or saving large files.

## Persistence proposal

Use an application-owned directory with metadata and binary payloads separated:

```text
A8E library/
├── library.json
├── files/
│   ├── <sha256>.atr
│   └── <sha256>.xex
└── revisions/
    └── ...
```

The exact platform-specific directory remains open. The repository should not
depend on the process current directory, because command-line launches and
desktop launches may use different working directories.

The native library format should store UTC timestamps and SHA-256 hashes. It
should preserve old content until a replacement has been validated and
successfully committed.

## XEX handling

XEX files should be library entries that can be selected and launched through
the same UI. The existing XEX-to-ATR conversion path can remain the execution
mechanism initially.

The Library should retain the original XEX entry and should not silently
replace it with only the generated temporary ATR. Generated execution media
may be treated as an internal transient artifact.

## Workspace support

A future workspace export/import flow may preserve:

- mounted D1: through D8: entries;
- current writable working-copy revisions;
- write-protection flags;
- machine profile and video standard;
- selected XEX or boot program;
- optional UI preferences.

The workspace model should be compatible with the concepts in
`implementation/library_Import_export.md`, while keeping native A8E support
optional and explicitly scoped.

## Implementation phases

### Phase 1: drive abstraction

- Replace the single-disk assumption with a drive collection.
- Route SIO device IDs to D1: through D8:.
- Preserve current D1: behavior as a compatibility path.
- Add mount, eject, and save APIs without UI changes.

### Phase 2: local repository

- Add persistent library metadata and binary storage.
- Import ATR and XEX files.
- Compute and verify content hashes.
- Track dirty working copies and safe saves.

### Phase 3: floating Library window

- Add the SDL overlay and shortcut.
- Display library entries and drive assignments.
- Add mount/eject/save/import actions.
- Add delete and write-protection confirmations.

### Phase 4: workspace portability

- Export and import the current drive setup.
- Preserve the latest working-copy revisions.
- Add conflict handling for existing local entries.
- Consider compatibility with the jsA8E package format.

## Decisions

- The feature is a separate native A8E subproject.
- The Library backend must be independent from the SDL UI.
- The native drive model must support D1: through D8:, even if the MVP only
  exposes D1: through D4: in the UI.
- Writable disk changes must be tracked as working copies.
- Existing working copies must not be silently overwritten or deleted.
- Content hashes and UTC modification timestamps are required for reliable
  duplicate and revision handling.
- The first UI should be an in-process SDL overlay.
- No third-party UI dependency is assumed for the MVP.
- Existing command-line loading must continue to work unchanged.

## Open questions

- Which platform-specific directory should store the native library?
- Should the native library use the same package format as jsA8E exports?
- Should the MVP expose D1: through D4: or all D1: through D8: immediately?
- How should large disk saves be moved off the emulation thread?
- Should deleted entries move to a recoverable trash area?
- Should a native workspace include CPU/RAM snapshots or only media and
  configuration?

## Non-goals for the MVP

- Remote synchronization between native A8E installations.
- Cloud storage or account management.
- A complete general-purpose desktop file manager.
- Automatic execution of imported XEX files without user confirmation.
- Replacing the existing command-line startup path.
