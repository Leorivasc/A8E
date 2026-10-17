# Full Library Management

Status: current baseline implemented in both jsA8E and native A8E. The portable
package contract, browser and native library views, folder editing, read-only
ATR inspection and integrity diagnostics, recoverable trash, retained revision
selection, non-destructive conflict preservation, and package-operation
progress/cancellation are implemented. Binary conflicts use the explicit
keep-both filesystem policy. Format-aware repair, remote synchronization, and
broader real-image validation remain deferred projects.

Date: 2026-10-16

## Purpose

The disk library should support moving a complete working library between
browsers, computers, and the native application without requiring the user to
download and re-import every ATR or XEX file individually.

The exported library must include the binary content and the information that
makes the collection useful as a working Atari setup: folders, metadata,
working copies, modification times, revisions, and disk assignments such as
`atariwriter.atr` in `D1:` and `docs.atr` in `D2:`.

This document records the canonical library model, the behavior already
implemented, and the intentionally deferred extensions. Requirements that are
still phrased as design guidance are labeled by the implementation-status
sections below; they do not authorize unrelated changes outside the Full
Library project.

## Implemented baseline

The implemented baseline exists in both applications:

- the dependency-free ZIP method-0 codec reads and writes standard `.a8e`
  archives;
- `library.json` schema v1 is validated with the frozen format, version,
  timestamps, entry identity, blob path, size, and SHA-256 rules;
- `jsA8E` can export its current disk-library records and inspect an imported
  package before storage changes are made, including the current D1:-D8:
  assignments;
- native A8E exposes the matching package read/write/manifest-validation core
  plus file-based import/export and blank ATR creation;
- shared regression coverage checks the same package contract in JavaScript and
  native CTest.

The import operation now has a complete browser transaction path:
`jsA8E` previews the package, deduplicates equal hashes, preserves differing
stable-ID content as an imported conflict copy, increments `libraryVersion`,
and commits all new records plus metadata in one IndexedDB transaction. A8E
has the matching backend staging store: it validates and decodes a complete
package before merging new folders, deduplicated records, conflict copies,
payloads, and available workspace assignments into the local snapshot. Folder
records and native folder navigation/editing are implemented; revision
blobs and preferred revision metadata are preserved across browser/native save
and package conflict copies, and both surfaces can promote an explicitly
selected retained revision while retaining the displaced current content.
Interactive selection of local content, imported content, or a merged binary
remains intentionally deferred. The native SIO backend now has independent
D1:-D8: media
slots and Device ID selection, the repository adapter persists the shared
directory contract, and the initial SDL UI mounts entries through that backend.

The browser navigation view is implemented. jsA8E stores
folders in IndexedDB, migrates older entries to the `Library` root, supports
the current-folder path and parent navigation, creates folders, uploads into
the open folder, displays the classic D1:-D4: controls, and provides per-file
download, move, and delete actions. Folder rows also support rename and safe
empty-folder deletion. The library core still preserves D1:-D8: mounts
for newer software and package interoperability, but D5:-D8: are deliberately
hidden from this DOS-oriented view. Folder metadata and entry `folderId` values
are optional schema-v1 fields so older packages remain importable. Native A8E
accepts the same extended manifest fields through its package layer; its native
window exposes the repository mount view and package actions. The browser view now also includes a
mounted-devices panel above the navigation list, showing occupied D1:-D8:
slots, logical folder/file paths, and an `Unmount` action.

The mounted-devices activity indicator is now connected to real SIO operations
in both applications. A short green `*` identifies a read and a yellow `*`
identifies a write or format; the indicator is transient and independent from
the persistent dirty and write-protection state.

The native repository implementation can load and save the
same application-owned `library.json` and `blobs/` directory used by the
shared schema. Loading stages the manifest and every referenced blob, then
validates the complete set before replacing the visible snapshot; saving
writes payloads before installing the manifest. The native floating Library
window and the adapter that maps its records to the native D1:-D8: slots are
now present in the initial mount/eject slice.

Native A8E now also checks the default `library/library.json` at startup. When
the package contains a workspace assignment, the corresponding ATR/XEX payload
is mounted in the requested D1:-D8: slot and its write-protection state is
restored. XEX media is normalized into the same bootable ATR working image used
by the command-line path. A command-line D1: image remains the fallback when
the repository has no workspace assignment. Dirty mounted working copies are
flushed back into updated manifest revisions on eject and emulator exit.

The package layer now also has a separate workspace export. It includes only
the entries currently assigned to D1:-D8:, their content-addressed blobs, the
folder ancestry needed to retain their paths, and the workspace assignment.
Browser callers use `exportWorkspacePackage` and native callers use
`A8E_LibraryRepository_ExportWorkspacePackageFile`; complete-library exports
continue to include every entry.

The native SDL adapter is available through F9. It presents the
repository entries in a compact list with ATR/XEX type labels and D1:-D8:
mount cells. Clicking a drive cell mounts the selected entry, clicking the
same occupied cell unmounts it, and moving an entry to another drive first
ejects its previous logical mount.

The native editing workflow is implemented. Typing in the Library
window filters names case-insensitively by substring; Delete removes an
unmounted entry; right-clicking a mounted drive cell toggles runtime write
protection; and dirty working copies are saved on eject and emulator exit. A
working-copy save creates or reuses the content-addressed blob, updates the
entry path, size, hash, modification time, and `libraryVersion`, then reloads
the repository only after the directory save succeeds. Native package
import/export and blank ATR creation are available through the typed SDL
prompt. The native window also supports the initial folder editing slice:
create with `F`, rename the selected folder or entry with `R`, move the
selected entry to the current folder with `M`, navigate with folder rows and
`..`, and delete only empty folders.
Both implementations now expose a read-only ATR integrity check. It verifies
geometry and, for DOS 2.x/MyDOS images, VTOC bounds, directory records,
reserved sectors, complete sector chains, cycles, sector sharing, and payload
length markers. Unknown filesystems remain inspectable and produce a warning;
the browser exposes the check from each ATR row, the native window exposes it
with `V`, and the native API is `A8E_LibraryImage_VerifyAtr`.
When a native XEX working copy is modified, its converted ATR bytes are
persisted as an ATR entry so a later mount never attempts to parse that
working image as XEX.
Runtime mount/eject and write-protection changes now persist immediately in
the schema-v1 workspace maps, so a native restart restores the latest
selection and protection state. Native package interchange and blank ATR
creation are now available through the SDL keyboard prompt: `I` imports a
validated `.a8e` package, `E` exports the current repository, and `N` creates
a standard writable ATR. The prompt is deliberately dependency-free and uses
typed paths/names confirmed with Enter.

The browser navigation also provides interactive global search immediately
above the status bar. Search is case-insensitive and matches any part of a
filename. Results are presented as a virtual folder, include their original
folder path, and retain the normal mount and file actions without changing the
physical folder of an entry.

The browser list provides ATR/XEX and mounted/dirty/clean filters plus
name/type/size/modified ordering; the native window provides ATR/XEX and
mounted/unmounted cycles with `T` and `Q`, plus name/type sorting with `S`.
Directory uploads preserve each file's
`webkitRelativePath` by creating the nested folders below the current folder;
single-file drops continue to target the current folder.

## Project parity

Every new capability in this project must be implemented and tested in both
`jsA8E` and native A8E. Platform-specific storage and UI adapters are allowed,
but the applications must preserve:

- compatible export and import manifests;
- compatible library, revision, and mount semantics;
- equivalent user-visible behavior;
- matching regression fixtures for package validation and conflict handling.

The shared package, folder, workspace, integrity, trash, retained-revision,
and non-destructive keep-both conflict baseline now exists in both
applications. Explicit revision selection is available in both surfaces;
format-aware three-way merge is intentionally unsupported for binary ATR/XEX
payloads.

## Interchange format decision

`library.json` is the canonical interchange contract for the library in both
applications. `jsA8E` and native A8E must be able to export and import the same
schema without conversion through an application-specific format.

The JSON file contains metadata, folders, entries, revisions, hashes, and
workspace/mount information. Binary ATR and XEX content is stored as
content-addressed payloads referenced by SHA-256. A complete portable package
therefore contains `library.json` plus the referenced binary files.

Multiple library entries may reference the same content-addressed blob. This
is intentional: two differently named working entries can contain identical
bytes. The manifest preserves both logical entries, while the package stores
the shared binary only once under `blobs/<sha256>.<type>`.

```text
a8e-library-export/
├── library.json
└── blobs/
    ├── <sha256>.atr
    └── <sha256>.xex
```

This keeps the library format JSON-based and interchangeable while avoiding
the size and memory cost of embedding every binary as Base64. A self-contained
JSON-with-Base64 variant may be supported later for small diagnostic exports,
but it is not the canonical format for full libraries.

The native A8E library directory should use the same structure, so its local
metadata file is also `library.json`. The browser may keep the same logical
records in IndexedDB, but its import/export adapter must produce and consume
the identical JSON schema.

The manifest carries two different version values:

- `schemaVersion` identifies the structure and rules of `library.json` and
  changes only when the interchange format changes;
- `libraryVersion` is a monotonically increasing revision of the library state
  and increments whenever the persisted library or workspace is modified.

An older `jsA8E` or A8E that detects a package with a higher
`libraryVersion` must show a warning popup and still attempt the import. If the
package uses an unsupported higher `schemaVersion`, it must also warn and make
the same best-effort attempt. Any validation or migration failure must abort
the import transaction and show a popup explaining the failure; partial data
must not become visible.

An older application must not silently export a newer library in a way that
loses unknown fields or revisions. If downgrade data loss is possible, the
export must be blocked or require an explicit confirmation.

### Frozen schema v1 decision

The first implementation freezes `library.json` at `schemaVersion: 1`. The
initial implementation must complete and test this schema before adding new
required fields or changing the meaning of existing fields. Additive optional
fields are allowed only when older readers can safely ignore them and the
compatibility warning rules remain effective.

Any incompatible structural change requires a new schema version and an
explicit migration design. It must not be introduced into schema v1 through
an unannounced field rename or semantic change.

## Library operations

The library should expose two related operations:

### Download full library

Exports every library entry, its metadata, and the binary payload needed to
reconstruct the library in another browser or computer. For writable ATR
images, the payload must be the current working copy, after pending emulator
changes have been flushed.

The export should preserve, when present:

- stable library entry identifiers;
- names, formats, folders, tags, and descriptions;
- preferred/current revisions and retained conflict revisions;
- binary content for ATR and XEX files;
- creation and modification timestamps;
- the current `D1:` through `D8:` assignments;
- write-protection state and dirty/working-copy state;
- optional workspace and machine settings.

### Load full library

Imports one complete package and validates it before changing local storage.
The operation must not replace the local library until all manifest records and
binary payloads have passed validation.

Import should detect existing entries by stable ID and content hash, preserve
local content, and apply the default revision policy described below. The
workspace mount map should be restored only after all referenced artifacts are
available.

The import result should summarize added entries, already-present entries,
duplicates, renamed collisions, restored mounts, and conflicts requiring user
attention.

## Full library versus workspace export

These are separate scopes built on the same package format:

- **Full library export:** all library entries and the revisions selected by
  the export policy. This is intended for backup and migration.
- **Workspace export:** only the artifacts required by the current setup,
  including mounted disks, selected XEX files, current writable copies, mount
  assignments, and write protection. This is intended for moving a specific
  AtariWriter-style session.

The workspace export must support the example where the two mounted ATR files
and their latest document changes are transferred together. A later remote
repository can use this same content-addressed package model, but online
synchronization is outside this first subproject.

## Package format

The preferred portable artifact is one file containing `library.json` and its
binary payloads:

```text
a8e-library-export/
├── library.json
├── blobs/
│   ├── <sha256>.atr
│   └── <sha256>.xex
└── hostfs/
    └── ...
```

The browser should offer a single download such as
`a8e-library-export.zip` or `workspace.a8e`, and a single file picker for
loading it.

The `.a8e` format is explicitly a standard ZIP archive with an A8E-specific
extension. It is not an executable or a proprietary binary container. A valid
`.a8e` package must contain `library.json` and may contain `blobs/`, `hostfs/`,
and other versioned directories defined by the schema. Renaming `.a8e` to
`.zip` must make the archive inspectable with ordinary ZIP tools.

The package must not rely on Base64-encoded binaries inside JSON as its primary
representation: that increases size and creates avoidable large temporary
strings. `library.json` remains human-readable and is the shared contract for
both applications.

### Initial ZIP implementation

The first `.a8e` implementation will use a valid ZIP archive with uncompressed
entries (`compression method 0`). The ZIP reader/writer will be implemented in
the project for both `jsA8E` and native A8E, without requiring an external
runtime dependency.

The initial ZIP subset must support UTF-8 entry names, CRC-32, local file
headers, the central directory, and the end-of-central-directory record. It
will initially reject encrypted entries, unsafe paths, unsupported compression
methods, and ZIP64 packages. A package-size limit below 4 GiB is acceptable for
the first version.

This produces a larger package than a compressed archive, but keeps the
interchange path simple, portable, offline-capable, and behaviorally aligned
between both applications. Ordinary ZIP tools must still be able to inspect
and extract the resulting `.a8e` file.

After the uncompressed implementation is stable, the project may adopt an
open-source compression library or add DEFLATE support. Any selected library
must be compatible with GPLv2, preserve its license notices, and be available
to both applications without creating a browser-only or native-only package
variant. Compression is an optimization and must not become a prerequisite for
interchange compatibility.

The package must be validated for:

- schema version and required fields;
- supported ATR/XEX type;
- payload size and configured size limits;
- SHA-256 content hash;
- valid ATR/XEX structure;
- safe relative paths with no traversal;
- mount references that point to package entries.

Authentication tokens, passwords, browser paths, and repository credentials
must never be included.

## Manifest outline

The following is illustrative rather than a final schema:

```json
{
  "format": "a8e-library-export",
  "schemaVersion": 1,
  "libraryVersion": 42,
  "createdAt": "2026-10-08T15:00:00Z",
  "library": [
    {
      "id": "disk-documents",
      "name": "docs.atr",
      "folderId": "folder-projects",
      "type": "atr",
      "path": "blobs/4a92...atr",
      "size": 92176,
      "sha256": "4a92...",
      "createdAt": "2026-10-01T12:00:00Z",
      "modifiedAt": "2026-10-08T14:45:12Z",
      "preferredRevisionId": "rev-002"
    }
  ],
  "workspace": {
    "devices": {
      "D1": "disk-atariwriter",
      "D2": "disk-documents"
    },
    "writeProtected": {
      "D1": false,
      "D2": false
    }
  }
}
```

`D1:` through `D8:` are the supported disk device slots. The manifest should
remain extensible for HostFS, cassette, and other pluggable devices without
making those devices mandatory for a disk-only import.

## Identity, dates, and revisions

Filenames are display names, not identities. Each binary revision should have
a SHA-256 hash. Stable library IDs identify logical entries; hashes identify
exact content.

Store timestamps as UTC ISO 8601 values and keep these meanings distinct:

- `createdAt`: entry or revision creation;
- `modifiedAt`: last binary-content change;
- `lastMountedAt`: last mount operation;
- `lastExportedAt`: last inclusion in an export.

Browsing, mounting, and exporting must not make a file appear modified. A
writable ATR becomes dirty when its emulated content changes, and the current
bytes plus `modifiedAt` must be flushed before export.

A revision may contain:

```json
{
  "revisionId": "rev-002",
  "parentHash": "sha256:base",
  "sha256": "sha256:browser-a",
  "modifiedAt": "2026-10-08T14:45:12Z",
  "modifiedBy": "browser-a"
}
```

The default policy is **keep newest with history**:

- equal hashes are the same content and do not conflict;
- a descendant revision is preferred over its ancestor;
- concurrent revisions are both retained;
- when concurrent timestamps differ, the newest is preferred by default;
- equal or unreliable timestamps use deterministic revision/hash ordering;
- the non-preferred revision remains available as history or a conflict copy.

This permits recovery when the same disk was modified in two browsers. It is
not destructive last-write-wins behavior.

The implemented schema-v1 extension stores revision objects under an entry's
optional `revisions` array. Each object has an `id`, content-addressed `path`,
`size`, `sha256`, UTC `createdAt`/`modifiedAt`, and optional `parentId`; the
entry may identify `preferredRevisionId`. Revision blobs are validated and
deduplicated just like current entry blobs. The browser persists their bytes
in IndexedDB, while native working-copy saves retain prior referenced blobs in
the manifest. Browser and native surfaces can promote a chosen retained
revision; the displaced active bytes are first retained as another revision.
The older single-revision manifest remains valid.

Deleted entries now move to a local recoverable trash collection in both
applications. Browser trash is stored in its own IndexedDB object store and
native trash is represented by the optional `trash` array in `library.json`;
restore checks folder/name collisions, while purge removes the entry and any
now-unreferenced payloads. Full-library and workspace exports intentionally
omit trash records and their blobs.

Both surfaces also support an explicit age-based purge. The user supplies a
retention age in days, receives a destructive-operation confirmation, and only
trash records with `deletedAt` older than the computed cutoff are purged. No
fixed retention policy is imposed by the library.

## File-system model

The logical library is organized into folders. The initial visual design does
not require a tree navigator: the current folder and `..` are sufficient for
navigation. The underlying model nevertheless supports nested folders and
stable IDs.

```mermaid
erDiagram
    LIBRARY ||--o{ FOLDER : contains
    LIBRARY ||--o{ FILE_ENTRY : contains
    LIBRARY ||--o{ WORKSPACE : provides
    FOLDER ||--o{ FOLDER : parent_of
    FOLDER ||--o{ FILE_ENTRY : organizes
    FILE_ENTRY ||--o{ REVISION : has
    REVISION }o--|| BLOB : references
    REVISION ||--o{ REVISION : derived_from
    FILE_ENTRY ||--o{ ENTRY_TAG : tagged
    TAG ||--o{ ENTRY_TAG : labels
    WORKSPACE ||--o{ MOUNT : defines
    FILE_ENTRY ||--o{ MOUNT : mounted_entry
    REVISION ||--o{ MOUNT : mounted_revision

    LIBRARY {
        string library_id PK
        string name
        datetime created_at
        datetime modified_at
    }
    FOLDER {
        string folder_id PK
        string library_id FK
        string parent_folder_id FK
        string name
    }
    FILE_ENTRY {
        string entry_id PK
        string library_id FK
        string folder_id FK
        string name
        string format
        string current_revision_id FK
        boolean deleted
    }
    REVISION {
        string revision_id PK
        string entry_id FK
        string blob_hash FK
        string parent_hash
        datetime modified_at
        string modified_by
        boolean preferred
    }
    BLOB {
        string sha256 PK
        integer size
        string format
        string payload_path
    }
    TAG {
        string tag_id PK
        string name
    }
    ENTRY_TAG {
        string entry_id FK
        string tag_id FK
    }
    WORKSPACE {
        string workspace_id PK
        string library_id FK
        string name
        string machine_profile
    }
    MOUNT {
        string mount_id PK
        string workspace_id FK
        string entry_id FK
        string revision_id FK
        string device_id
        boolean write_protected
        boolean dirty
    }
```

Important invariants:

- each mount device is one of `D1:` through `D8:`;
- one workspace cannot mount the same logical library entry in two devices at
  the same time;
- a mount identifies the logical entry and the selected revision, not only a
  content hash;
- deletion must be guarded when an entry is mounted or has unsaved changes;
- downloading a file exports its current working-copy bytes;
- imported copies with different stable IDs remain distinct even when their
  display names match.

## Library user interface

The proposed browser and native library views follow a compact
Midnight-Commander-style panel rather than a tree-and-details layout.

In native A8E, this view is a floating Library window. It provides the same
operations and layout as the `jsA8E` Disk Library panel, while using the native
library directory and the shared `library.json` contract underneath.

### Navigation panel

- show the contents of the current folder;
- provide `..` to move to the parent folder;
- use folder icons for folders;
- show `ATR` and `XEX` type tags for files;
- omit the separate details pane for now;
- keep the current path visible in the panel header.

Each file row should provide:

- the file name and type tag;
- an `RW` column containing only a small `*`: red for read-only and green for
  writable;
- mount controls for `D1:` through `D8:`;
- a `Download` action for that file's current bytes;
- a `Delete` action with the safety rules below.

The `RW` marker describes the effective media mode. A write-protected mount
must appear red even when the underlying ATR has writable structure. The
marker is separate from both the live SIO activity asterisk and the
persistent `dirty` state.

### Upload and drag-and-drop

The navigation panel should provide an `Upload` button and accept file drops.
Both paths have the same behavior:

- accept supported ATR and XEX files;
- add each delivered file to the folder currently open in the navigation
  panel;
- preserve the original filename, format, and upload timestamp;
- validate the file structure and content before making it visible;
- calculate its SHA-256 content identity during ingestion;
- initialize a writable ATR working copy from the uploaded bytes;
- report rejected, duplicate, and successfully added files in the panel status
  area.

The current folder is part of the operation's context. Changing folders before
the operation starts changes the destination; a file must not silently be
placed in the library root merely because the upload originated from a global
toolbar.

When a name already exists in the current folder, the UI should offer an
explicit choice such as replace/create a renamed copy/cancel. Replacement must
follow the normal revision and working-copy rules and must never silently
discard a local dirty copy. Files with the same name in different folders are
allowed.

Browser directory uploads and native SDL directory drops preserve their
relative folder hierarchy beneath the folder currently open in the navigation
panel. Native drops also accept complete `.a8e` packages; direct ATR/XEX drops
use the same content-addressed storage, duplicate-name checks, folder IDs, and
validation rules as ordinary uploads. Symbolic links are not traversed by the
native recursive importer.

### Create a blank ATR

The navigation toolbar must also provide a `Create blank ATR` action. It must:

- create a valid, writable blank ATR image in the folder currently open;
- propose a non-conflicting filename and allow the user to edit it before
  creation;
- make the new image immediately available for mounting, editing, download,
  and complete-library export;
- preserve the normal stable ID, timestamps, dirty-state, and SHA-256 rules;
- never replace an existing entry without an explicit confirmation.

The first implementation should use a documented standard blank-disk geometry;
the selected baseline is a 90 KiB ATR containing 720 sectors of 128 bytes. The
geometry remains an implementation constant rather than being inferred from
the current mounted drive.

### Folder and entry organization

The initial library implementation must allow users to create, rename, and
move folders. It should also allow renaming and moving library entries while
preserving their stable IDs, revisions, timestamps, tags, and mount identity.

Moving an entry that is mounted must update its displayed path without
changing the active device assignment. Moving or renaming a dirty entry must
not discard its working copy. Imported name collisions in the destination
folder use filesystem-style numeric suffixes: `file.atr`, `file(1).atr`,
`file(2).atr`, with case-insensitive matching and the extension preserved.
Explicit replace/cancel choices for interactive local edits remain outside the
non-destructive package-import path.

### ATR contents view

Clicking or opening an ATR should reuse the same library panel while changing
its list view from library navigation to the contents of the selected disk
image. It should not require a second permanent details pane or a separate
application window.

The panel header should show the context and provide a way back, for example:

```text
Library / Projects / docs.atr
[Back] [ATR info] [Download image]
```

For a recognized Atari filesystem, the contents view should initially provide
a read-only directory listing with entries such as:

```text
README.TXT    12 sectors
LETTER.DOC    48 sectors
INDEX.DAT      3 sectors
```

The first filesystem targets are DOS 2.x and MyDOS. Selecting an internal file
may later open a text/hexadecimal preview or offer a file download. The view
must preserve the parent library folder and return to it through `Back` or
`..`.

If the ATR is a boot disk, game disk, XEX-converted image, or another image
whose filesystem is not recognized, the same panel should show the ATR header
and sector geometry and offer a raw sector/hexadecimal view instead of
pretending that the image contains a normal directory.

Filesystem inspection is read-only in the first phase. Editing, importing, or
deleting files inside an ATR requires separate support for the relevant DOS
directory, VTOC, allocation, density, and protection rules. The view and its
recognized-format results must remain behaviorally aligned between `jsA8E` and
the native A8E floating Library window.

### Initial ATR viewer scope decision

The first ATR viewer is intentionally limited to a read-only inspection path:

- ATR header and sector geometry;
- filesystem detection for DOS 2.x and MyDOS;
- directory listing for recognized images;
- individual-file extraction/download;
- ATASCII-aware text preview and hexadecimal fallback;
- explicit raw-sector view for unrecognized or custom images.

The cross-application inspection core for this scope is now in place. It
validates ATR geometry and recognizes the shared DOS 2.x/MyDOS VTOC and
directory layout in both jsA8E and native A8E, while keeping image inspection
read-only. jsA8E integrates the contents view, internal-file download,
ATASCII preview, and hexadecimal fallback in the existing panel. The native
floating Library window now provides the corresponding initial contents view,
including directory selection, ATASCII/hexadecimal preview, and typed-path
internal-file download.

The first viewer will not edit, import, delete, repair, or reallocate files
inside an ATR. Those operations remain later projects because they require
filesystem-specific VTOC, directory, allocation, density, and protection
rules. This scope applies equally to `jsA8E` and the native A8E floating
Library window.

### Internal file extraction and ATASCII preview

The contents view should support downloading an individual file from a
recognized ATR without downloading the complete disk image. The extracted file
must retain its Atari filename where possible and use the file's detected type
for its download name.

Text files should offer an ATASCII-aware preview and an optional conversion to
modern text. The original bytes must remain available for download, and bytes
that do not map cleanly to modern text must not be silently discarded. Binary
files should fall back to a hexadecimal preview.

Importing, replacing, or deleting internal files is a later write-enabled
feature and must follow the image's DOS allocation, VTOC, directory, density,
and write-protection rules.

### Filesystem detection and status bar

The ATR viewer should identify the filesystem when possible, initially
including DOS 2.x and MyDOS and later allowing additional filesystem adapters.
The detected type must appear in the panel status bar, for example:

```text
Filesystem: MyDOS  |  720 sectors  |  Read-only inspection
```

For an unrecognized boot, game, XEX-converted, or custom image, the status bar
must say so explicitly and show the ATR geometry rather than presenting an
inferred directory as authoritative. The selected internal file's detected
type may also be shown in the same status area.

### Integrity verification and repair

The library should provide a diagnostic verification action for ATR entries.
It should detect malformed ATR headers, invalid sector ranges, inconsistent
VTOC/directory allocation, and payload/hash mismatches. The first repair mode
is diagnostic only: it reports findings and never changes the image.

Any future repair operation must require explicit confirmation, create or
retain a recoverable revision first, and be unavailable while the image is
mounted read/write unless the working-copy transition is clearly controlled.

### Interactive library search

The panel should place a search field immediately above the status bar. Search
is interactive: results update while the user types, without requiring a
submit button.

The initial search behavior is:

- search all library files by default;
- match the query anywhere in the filename, not only from the beginning;
- ignore letter case;
- show an empty query as the normal current-folder view;
- present non-empty results as a virtual folder in the file list;
- preserve the normal mount, Download, Delete, and open-ATR controls on each
  result;
- show the original folder path for each result so a match is not ambiguous.

For example, typing `ezum` must return `Montezuma`. Selecting a result must
allow the user to mount its image immediately without first navigating back to
its physical folder. The virtual search view is a presentation state only; it
must not create or move library entries.

### Status bar and revision information

The panel status bar should also expose the active revision information for the
selected file or current ATR view, including when available:

- active revision identifier;
- revision count;
- last modification time;
- conflict/history indicator;
- detected filesystem or internal file type;
- current read-only/writable state.

For example:

```text
Revision rev-002  |  3 revisions  |  Modified 2026-10-08 14:45 UTC  |  MyDOS
```

The status bar must remain concise and should summarize multiple selected files
instead of creating a separate details pane.

This revision summary is now implemented in both surfaces. A single selected
entry shows its preferred revision (or retained-history count), modification
timestamp, dirty/clean state, and mounted device; multiple selections keep the
compact count summary.

### Mounted-devices panel

A persistent panel above the navigation list should show, for every occupied
device:

- device name (`D1:`–`D8:`);
- mounted folder/file path;
- the logical library entry and active revision when useful;
- write-protection and dirty indicators;
- a small media-activity asterisk next to the mounted image;
- an `Unmount` action.

When a row's mount button changes, this panel must update immediately after the
operation completes. The panel is the authoritative visual answer to “what is
mounted where?” when files are distributed across different folders.

### Media activity indicator

The mounted-devices panel should reuse the library's small asterisk activity
indicator next to each mounted image:

- blink or pulse in **green** while the emulated device is reading that image;
- blink or pulse in **yellow** while the emulated device is writing that image;
- remain hidden or inactive when no media operation is in progress.

The indicator represents live I/O activity, not merely that an image is
mounted. It must be driven by the same SIO read/write events in both `jsA8E`
and native A8E, so the color reflects the operation actually performed by the
emulated device. A write must also continue to update the separate persistent
`dirty` state used to indicate unsaved working-copy changes; the activity
asterisk and the dirty marker must not be conflated.

If read and write activity overlap, the write state takes priority visually.
The indicator should have a short minimum visible/pulse duration so very fast
operations remain perceptible, while not delaying emulation or SIO timing.

### Mount exclusivity

The same logical library entry may not be mounted in two devices at once. If a
user selects another device for an already mounted entry, the UI should offer
to move it, with `save`, `discard`, or `cancel` when there are pending changes.
This rule preserves physical-media realism. Separate imported entries with
different stable IDs may still represent separate media, even if their bytes
currently have the same hash.

### File actions

`Download` exports the current working copy, not a stale original upload. For
an XEX that has been converted to a writable runtime disk image, the action
must clearly identify the resulting format/name.

`Delete` must be recoverable where practical, or at minimum guarded by a
confirmation. If the file is mounted or dirty, the user must be offered a
safe choice such as save-and-delete, discard-and-delete, or cancel. Deleting a
library entry must not silently delete a retained revision needed by another
entry or conflict record.

## Import and conflict behavior

The import flow should be transactional from the user's perspective:

1. Read the package and manifest.
2. Validate every payload before making it visible.
3. Match stable IDs and content hashes against local records.
4. Add new entries and revisions without overwriting local content.
5. Select the preferred revision using the default conflict policy.
6. Resolve name collisions with a numeric suffix (`file(1).atr`,
   `file(2).atr`, and so on) without replacing local content.
7. Restore mount assignments only after all referenced entries exist.
8. Report duplicates, conflicts, skipped records, and restored devices.

If imported and local content has the same hash, the payload should be
deduplicated. If content differs, both revisions must remain recoverable even
when the newest one is selected by default.

### Import preview and confirmation

Before committing an import, the UI should present a preview summary showing:

- new entries and folders;
- entries already present by stable ID or content hash;
- name collisions and the proposed renamed copies;
- newer, older, and concurrent revisions;
- mount assignments that can be restored;
- entries requiring user choice or that cannot be imported.

The user may confirm, cancel, or resolve supported conflicts from this preview.
Validation still runs for every payload before confirmation, and confirmation
must commit the validated plan atomically. Canceling the preview must leave the
local library unchanged.

The browser preview now reports newer, older, and concurrent stable-ID
conflicts separately, together with the transported revision count, before
the confirmation prompt. The current default conflict handling is
non-destructive: an imported divergent entry is retained as a separate
recoverable copy. Choosing local content, imported content, or a merged
revision interactively remains a follow-up because ATR/XEX bytes do not have
a safe generic three-way merge operation.

Native A8E now provides the matching non-mutating package preview summary for
keyboard and drag-and-drop imports. Its SDL confirmation reports new entries,
duplicates, divergent conflicts, new folders, payloads, and available
workspace assignments before the existing staged merge runs; the staged merge
retains divergent imported content without replacing the local entry.

## Import/export security and integrity

The importer must:

- reject unsupported or malformed ATR/XEX payloads;
- enforce configurable package and payload size limits;
- prevent path traversal and unsafe archive entries;
- write only to the application-owned library storage;
- verify size, type, structure, and SHA-256 before exposing a payload;
- preserve old content until the import transaction is complete;
- avoid executing an imported XEX without explicit user confirmation.

Both package implementations now enforce bounded defaults before exposing
archive contents: 256 MiB per archive, 16 MiB for `library.json`, 64 MiB per
payload, and 256 MiB total payload bytes. The JavaScript package API accepts
`maxPackageBytes`, `maxManifestBytes`, `maxPayloadBytes`, and
`maxPayloadTotal`; native callers can pass the equivalent
`A8E_LibraryPackageLimits_t` to the `WithLimits` package and repository APIs.
Zero-valued native fields retain the defaults.

Exports must never include authentication tokens, passwords, browser-specific
paths, or private repository credentials.

## Progress and cancellation

Full-library import and export must expose progress and cancellation for large
collections. The UI should report at least the current phase, completed item
count, total item count when known, and the current filename or payload.

This contract is now implemented in both surfaces. Browser package and disk
library APIs accept progress/cancellation options, and the panel exposes a
Stop action for export, preview, and import. Native repository APIs retain the
original synchronous wrappers and add callback variants for full and
workspace package operations; cancellation is checked before staged writes and
the SDL window reports the current phase in its status line and cancels when
the focused Library window's Escape key is held during the operation.

Cancellation must stop the operation at a safe transaction boundary. It must
not leave a partially imported entry, blob, revision, or mount mapping visible
to the user. Temporary files or records may be cleaned up after cancellation;
the existing local library must remain usable throughout.

## Version migration and compatibility

The importer must distinguish `schemaVersion` from `libraryVersion`. A higher
`libraryVersion` is a newer library state and requires a warning, but does not
by itself make the package unreadable. A higher `schemaVersion` may contain
unknown structure and therefore requires a stronger compatibility warning.

In both cases the older application should attempt a non-destructive import.
If validation, migration, or required-field handling fails, the operation must
abort atomically and show a popup with an actionable explanation. Successful
best-effort imports should report fields or revisions that were ignored.

The current readers accept a higher schema version when the known v1 required
structure remains valid, ignore unknown additive fields, and warn in the
browser/native import preview. Older or invalid schema versions remain
rejected before any repository mutation.

Every persisted library/workspace mutation increments `libraryVersion`, while
runtime-only SIO activity does not. The increment and the associated content
revision must be committed atomically.

## Import/export delivery phases

The import/export portion of this project follows these phases:

### Phase 1: portable workspace package — complete

- define `library.json` schema version 1;
- export selected ATR/XEX files and current writable ATR copies;
- restore `D1:` through `D8:` assignments and write protection;
- validate hashes and file formats during import.

The browser transaction path is implemented. Its preview/commit API is
available through the disk library and the browser panel now exposes Export
Library and Import Library actions. Native A8E has the corresponding staged
package store and merges validated package contents with its persistent
multi-drive repository atomically, while failed imports leave the active
workspace mounted and unchanged.

### Phase 2: complete library migration — complete

- export all library entries and their metadata;
- preserve stable IDs, timestamps, tags, folders, and descriptions;
- deduplicate identical payloads;
- handle duplicate names without overwriting local entries.

### Phase 3: revisions and conflicts

- add parent hashes and revision identifiers; **baseline complete** through
  optional `revisions`, parent IDs, and preferred revision IDs;
- preserve concurrent working copies; **baseline complete** for browser and
  native package/save paths;
- report conflicts and preserve both local and imported content;
  **complete** through explicit retained-revision selection and filesystem
  numeric naming for incoming copies. A generic three-way merge is not
  attempted for binary ATR/XEX payloads.

### Phase 4: remote repository integration — deferred

- reuse `library.json` and content-addressed payloads for remote storage;
- treat local IndexedDB or native files as a cache/local working store;
- add synchronization only after offline import/export is stable.

### Final desirable phase: real-image validation

After the functional features are stable, add a curated fixture set of real
and representative ATR images covering DOS 2.x, MyDOS, protected disks, game
disks, XEX-converted images, malformed images, and unrecognized custom layouts.
Run the same directory, extraction, detection, and verification checks in
`jsA8E` and native A8E.

This phase is desirable and important for confidence, but it is not a reason
to block the initial library UI. Core parser tests with synthetic fixtures and
the shared cross-application contracts remain mandatory throughout earlier
phases.

## Implementation order

The following list is retained as a traceable implementation history. Items
1–12 describe the current baseline; items 13–14 remain deferred:

1. finalize the common manifest, `schemaVersion`, `libraryVersion`, and
   validation rules; **complete**;
2. implement content-addressed package creation/loading with progress and
   cancellation; **complete**;
3. export/import complete ATR/XEX library entries and current ATR working
   copies, including compatibility warnings and atomic migration; **complete**;
4. add folder metadata, the compact navigation view, Upload, drag/drop, and
   Create blank ATR; **complete**;
5. add create/rename/move operations for folders and library entries;
   **complete**;
6. add interactive global search as a virtual-folder view; **complete**;
7. add the ATR viewer, filesystem detection, status-bar type reporting, and
   the read-only sector fallback; **complete**;
8. add internal-file extraction and ATASCII-aware previews; **complete**;
9. add the RW column, D1–D8 mounted-devices panel, mount exclusivity, and SIO
   activity indicators; **complete**;
10. add per-file and complete-library Download/Delete actions plus revision
   information in the status bar; **complete**;
11. add diagnostic integrity verification; **complete**. Explicit repair
   support remains deferred;
12. add the import preview and confirmation workflow; **complete**;
13. add the final desirable real-image fixture and differential validation
    phase; **deferred**;
14. extend the same package model to remote repositories later; **deferred**.

## Post-initial-implementation backlog

The following ideas are intentionally deferred until the first implementation
is stable:

- richer sorting beyond the implemented native name/type/size/modified cycle
  and browser direction toggling remains optional;
- richer trash policy (recoverable trash, restore, purge, and explicit
  age-based purge are implemented; automatic retention remains optional);
- recovery of pending working copies after an unexpected shutdown (browser
  debounced/transactional persistence and native five-second autosave are
  implemented; a user-facing recovery chooser remains optional);
- full Midnight-Commander-style keyboard navigation (compact native
  Up/Down/Page/Home/End/Enter navigation is implemented; panel-wide focus and
  command-key parity remain optional);
- browser quota and native storage-capacity reporting (implemented through the
  browser storage estimate action and native `H` status action);
- broader directory-drop variants (the current browser and native paths
  recreate nested folders, and native SDL accepts direct ATR/XEX files and
  complete `.a8e` packages);
- richer repair operations after diagnostic verification;
- remote repository synchronization.

Any new phase or extension must have corresponding jsA8E and native A8E tests
before it is considered complete.

## Non-goals

- automatic cloud synchronization without explicit user consent;
- silent destructive last-write-wins merging;
- credentials or private browser paths in packages;
- automatic execution of imported XEX files;
- forcing a tree navigator or a right-hand details pane in the first UI;
- implementing code as part of this documentation task.
