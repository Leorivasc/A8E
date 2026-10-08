# Library Import/Export Subproject

Status: design proposal  
Date: 2026-10-08

## Purpose

Make the jsA8E disk library portable between browsers and computers without
requiring the user to export each ATR or XEX file separately.

The export must preserve not only the library entries, but also the current
working copies of writable disk images and the workspace layout. A typical use
case is AtariWriter with `atariwriter.atr` mounted in `D1:` and `docs.atr`
mounted in `D2:`. Exporting the workspace should carry both images, including
the latest document changes, and restore the same device assignment after
import.

## Scope

The subproject covers:

- exporting library metadata and binary ATR/XEX content;
- importing the export into another browser profile or computer;
- preserving writable working copies;
- preserving D1:/D2: and other device assignments;
- preserving relevant machine and write-protection settings;
- duplicate detection through content hashes;
- revision history and conflict preservation;
- safe import validation and non-destructive conflict handling.

The first implementation is intended to be a portable offline transfer
mechanism. A remote repository and browser-to-browser synchronization can be
built later on top of the same manifest and revision model.

The browser implementation is the primary starting point, but the capability
must remain available in both `jsA8E` and native A8E. Platform-specific storage
and UI adapters are allowed; the manifest, content identity, revision rules,
and observable import/export behavior should remain aligned.

## Cross-application parity policy

Every new project in this repository must be implemented and tested in both
`jsA8E` and native A8E. A feature is not considered complete while it exists
only in one application.

When platform constraints require different internals, both applications must
still provide equivalent user-visible behavior, compatible data contracts, and
matching regression fixtures. Any temporary parity gap must be recorded as an
explicit implementation task rather than treated as completion.

## Core concepts

### Library entry

A library entry describes one ATR, XEX, or supported disk artifact. The entry
contains user-facing metadata and a reference to the binary payload.

### Content identity

Every binary payload is identified by a SHA-256 content hash. Names are not
identities because two files may have the same name while containing different
data.

Content hashes provide:

- duplicate detection;
- integrity verification during import;
- stable references from sessions and device mappings;
- safe storage of multiple files with the same display name.

### Working copy

For writable ATR images, the exported payload must be read from the current
IndexedDB content, not from the original upload record. Changes made by the
emulator must be flushed to the working copy before export.

The working copy is the authoritative content for that library revision.

### Workspace

A workspace is the part of a library export needed to recreate a working
setup. It may include:

- selected library entries;
- D1:, D2:, and other device assignments;
- write-protection flags;
- machine profile and video standard;
- selected XEX or boot program;
- optional HostFS files;
- optional UI/session preferences.

## Export format decision

The portable export should be one package containing a manifest and binary
payloads:

```text
a8e-workspace-export/
├── manifest.json
├── files/
│   ├── <sha256>.atr
│   └── <sha256>.xex
└── hostfs/
    └── ...
```

The user should receive one file from the browser, for example
`atariwriter-workspace.a8e` or `a8e-library-export.zip`.

The exact container implementation remains open. The design constraints are:

- one-file import/export;
- no duplicated binary payloads;
- streaming or bounded-memory processing where practical;
- no requirement to expose raw filesystem paths;
- compatibility with browser file pickers;
- no unnecessary external dependency in the jsA8E browser application.

Embedding binaries as Base64 inside a single `library.json` is rejected as the
primary format because it increases size by roughly one third and can require
large temporary strings. A JSON manifest remains part of the package and can
also be exported separately for inspection or diagnostics.

## Manifest model

A minimal manifest should contain a schema version, export metadata, artifact
records, and workspace state:

```json
{
  "format": "a8e-library-export",
  "version": 1,
  "createdAt": "2026-10-08T15:00:00Z",
  "library": [
    {
      "id": "disk-documents",
      "name": "Documents",
      "type": "atr",
      "path": "files/4a92.atr",
      "size": 92176,
      "sha256": "4a92...",
      "createdAt": "2026-10-01T12:00:00Z",
      "modifiedAt": "2026-10-08T14:45:12Z"
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
    },
    "machine": {
      "videoStandard": "PAL",
      "memoryProfile": "64k"
    }
  }
}
```

Binary data must not be trusted solely because it has a valid filename or
manifest entry. Import must verify the payload hash, size, supported type, and
format before writing it to IndexedDB.

## Library export versus workspace export

Two user-facing operations are recommended:

### Export Library

Exports all library entries, metadata, revisions selected by the export policy,
and their binary payloads.

### Export Workspace

Exports only the artifacts required by the current setup, including:

- images mounted in D1:/D2:;
- selected XEX files;
- current writable working copies;
- device mappings;
- write-protection state;
- machine configuration.

`Export Workspace` is the preferred workflow for AtariWriter-style projects.
`Export Library` is intended for backup or full migration.

## Modification timestamps

All timestamps are stored as UTC ISO 8601 strings.

The following timestamps must remain distinct:

- `createdAt`: when the library entry or revision was created;
- `modifiedAt`: when the binary content last changed;
- `lastMountedAt`: when the artifact was last mounted;
- `lastExportedAt`: when it was included in an export.

Only content changes update `modifiedAt`. Mounting, browsing, or exporting an
artifact must not make it appear newer.

The emulator should mark a writable ATR dirty when it changes disk content and
flush the current bytes and `modifiedAt` before export. Timestamp values must
not depend on the local filesystem timestamp of the original upload.

## Revision and conflict model

Each content revision should include a revision identifier, its content hash,
its parent hash when available, the modification time, and an origin/device
identifier:

```json
{
  "revisionId": "rev-002",
  "parentHash": "sha256:base",
  "sha256": "sha256:browser-a",
  "modifiedAt": "2026-10-08T14:45:12Z",
  "modifiedBy": "browser-a"
}
```

This supports the following rules:

- If hashes match, there is no content conflict.
- If one revision is a descendant of the other, keep the descendant as the
  preferred revision.
- If two revisions have the same parent but different hashes, preserve both
  because they were modified concurrently.
- When concurrent revisions have different timestamps, prefer the newest by
  default while retaining the other as a conflict/revision.
- If timestamps are equal or unreliable, use revision identity and content
  hash for deterministic ordering, but still preserve both revisions.

The default policy is therefore `keep-newest-with-history`, not destructive
last-write-wins.

## Import behavior

Import should be transactional from the user's perspective:

1. Read and validate the package manifest.
2. Validate every payload's size, type, and SHA-256 hash.
3. Detect existing entries by content hash and stable library ID.
4. Import new entries and revisions without overwriting existing content.
5. Apply the default conflict policy.
6. Restore workspace mappings only after all required artifacts are available.
7. Report skipped files, duplicates, and conflicts in a summary.

The default conflict policy is:

- keep the newest revision selected as preferred;
- retain older or concurrent revisions;
- never silently delete a local working copy;
- use a suffix or conflict marker when two display names collide;
- allow the user to choose local, imported, newest, or both.

Authentication tokens, passwords, browser-specific paths, and private
repository credentials must never be included in an export.

## Security and integrity

The importer must:

- reject unsupported or malformed ATR/XEX payloads;
- enforce configurable size limits;
- prevent path traversal in package entries;
- write only to the application-owned IndexedDB namespace;
- avoid executing an imported XEX automatically without user confirmation;
- verify content hashes before making an artifact available;
- preserve old content until the import transaction is complete.

## Implementation phases

### Phase 1: portable workspace package

- Define `manifest.json` schema version 1.
- Export selected ATR/XEX files and current working-copy bytes.
- Restore D1:/D2: assignments and write-protection flags.
- Validate hashes and formats on import.

### Phase 2: complete library migration

- Export all library entries and metadata.
- Preserve stable IDs, timestamps, tags, and descriptions.
- Add duplicate and name-collision handling.

### Phase 3: revisions and conflicts

- Add parent hashes and revision IDs.
- Preserve concurrent working copies.
- Add an import conflict summary and selection UI.

### Phase 4: remote repository integration

- Use the same manifest and content-addressed payload model for remote
  storage.
- Treat IndexedDB as a local cache rather than the only source of truth.
- Add synchronization only after local export/import behavior is stable.

## Open decisions

- Final package container: ZIP, a small custom container, or another standard
  archive format.
- Whether a full library export includes every historical revision or only the
  preferred revision plus explicitly retained conflicts.
- Whether snapshots of CPU/RAM/jsA8E state belong in this package or in a
  separate state file.
- Whether HostFS files are included by default in workspace exports.
- Whether conflict copies receive user-visible names immediately or remain
  grouped under one logical library entry.

## Non-goals

- Silent cloud synchronization without explicit user consent.
- Destructive last-write-wins behavior.
- Embedding credentials in portable files.
- Treating filenames as unique identities.
- Replacing the emulator's existing local library before the imported package
  has been fully validated.
