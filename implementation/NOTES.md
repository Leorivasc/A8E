# NOTES.md

- 2026-11-11 (jsA8E: console keys fit on mobile): on phones the five console keys
  (about 380 px wide) overflowed the screen and HELP was cut off on the left.
  `style.css` now has a `max-width: 780px` block (the layout's mobile breakpoint):
  the bar spans 92% of the screen width, centered, and the keys share it equally
  (`flex: 1 1 0`) at 34 px high, so it scales with the screen and stays
  finger-sized. Desktop is unchanged. Checked with headless Chromium screenshots
  at 360 and 412 px; not checked on a physical phone.
- 2026-11-11 (jsA8E: remote sync, converted XEX blob extension): a third browser
  failed with "The remote is missing blobs/<sha>.atr" although `blobs/<sha>.xex`
  was on the server. Cause: an XEX that was run is kept as an ATR runtime image
  (`runtimeBytes`), so the library exports it as `format: "atr"` while its
  revisions still hold the original XEX bytes; `makeManifest` names those
  revision blobs with the entry type, giving `blobs/<sha>.atr`. The first browser
  had uploaded the same bytes as `.xex`, and publish tracks remote blobs by hash,
  so nobody re-uploaded it under the new name. Fix in `remote_library.js`
  (`downloadBlob`): when the named blob is missing, the same hash under the other
  type (`atr`/`xex`, shared `BLOB_TYPES`, also used by the cleanup) is tried; the
  SHA-256 check still applies. This also heals remotes already in that state.
  New `tests/remote_library_xex_blobs.test.js` (three browsers, XEX converted by
  the second; fails without the fix with the reported message) and a
  `convertXex` option in `tests/remote_test_support.js`. Not changed: a
  converted XEX still appears as `.ATR` in other browsers, and the manifest
  still names the revision `.atr`; only the lookup became tolerant.
- 2026-11-11 (jsA8E: on-screen console keys overlay): new `js/app/console_keys_ui.js`
  (loaded from `index.html`, initialised in `ui.js` like the disk activity
  indicator), markup `#consoleKeys` inside `.screenOverlay`, styles at the end of
  `style.css`. Five slanted keys (HELP, START, SELECT, OPTION, RESET) at the top
  right of the screen, hidden by default, shown while the pointer is over the top
  strip (56 px) and faded out on leave; on touch a first tap on the strip reveals
  them (hidden again after 3 s) and does not press a key. A key is held while the
  pointer is down (`onKeyDown`/`onKeyUp` with F1-F5 and SDL syms 282/285/284/283/286,
  the same ones the virtual keyboard sends) and takes the write-activity orange
  (`#ff9d2e`) while pressed; idle keys use the read-activity yellow (`#ffe04b`).
  `tests/console_keys_ui.test.js` (in `test:automation`) covers hidden-by-default,
  hover, press/release, staying visible while held, and the touch rules; rendering
  checked with a headless Chromium screenshot. Not checked: a real touch device.
- 2026-11-11 (jsA8E: no extra cycle for decimal ADC/SBC): the 6502 MIPS
  Benchmark 1.3 scored jsA8E at 0.240 (86%) on "Integer arithmetic", while real
  hardware, Altirra and the native A8E score 0.261 (94%). Cause: `adcValue` and
  `sbcValue` in `js/core/cpu.js` added one cycle when the D flag was set. AHRM 3.2
  and 3.6 say that extra cycle exists only on the 65C02; the NMOS 6502 does not
  take it (the native `6502.c` never did). That test runs 18 decimal ADC/SBC per
  203-cycle iteration, so the error was about 9%. Removed the cycle, and the
  `cycleCounter--` in `opISC`/`opRRA` that only cancelled it, so their net timing
  is unchanged. `cpu_undocumented_opcodes.test.js` now expects 2 cycles for
  `ADC #`/`SBC #` in decimal mode (it asserted 3, from the fake6502 reference,
  which models the 65C02). Verified by running the benchmark XEX headless: before
  0.240 / 86% (average 92%), after 0.261 / 94% (average 94%), other lines
  unchanged. `test:automation` and lint pass. The 2026-03-26 note on
  "RRA/ISC decimal-cycle cancellation" no longer applies.
- 2026-11-10 (jsA8E: MCP server restrictions): file arguments (`path`, `file`,
  `sourcePath`) are now confined to `--cwd` by default: the path is resolved,
  checked by name and again on its real path (symbolic links), and refused with
  `-32602` if it leaves the directory; `--allow-any-path` / `confinePaths: false`
  lifts it. New `--no-network` / `allowNetwork: false` refuses the five `*FromUrl`
  actions. Before this, an agent could load any readable local file or fetch any
  URL and read it back through the emulator. `resolvePath` takes a `confine`
  flag and `readBinaryInput` takes a resolver. `tests/mcp_server.test.js` covers
  `..`, absolute paths, a symlink out, paths inside, the opt-out, every URL
  action blocked and the CLI flags; a real stdio run confirmed `/etc/hostname`
  is refused by default and accepted with `--allow-any-path`. Not covered:
  limits on sizes and run time (a blocking program still blocks the process),
  and the `bwrap` recipe in `implementation/MCP.md` was not run. Behavior
  change: callers that passed paths outside `--cwd` now need `--allow-any-path`.
- 2026-11-10 (jsA8E: MCP server documentation): `mcp_server.js` was only described
  in two sentences. New `implementation/MCP.md` (linked from `AUTOMATION.md`, `jsA8E/README.md`,
  the root `README.md` and `CHANGELOG.md`) documents startup options, ROM lookup,
  the protocol and its limits, the per-action argument mapping, binary inputs,
  results and errors, programmatic use, testing and security. The examples come
  from real sessions. Findings recorded there, not changed: (1) the server
  looks for `ATARIXL.ROM`/`ATARIBAS.ROM` in the repository root, not in
  `jsA8E/`, so without `--os-rom` the machine starts with no ROMs; (2) requests
  are handled concurrently and answers can arrive out of order; (3) the
  standard `notifications/initialized` is not recognised (only `initialized`)
  and `ping` is not implemented, so a standard client gets an error reply with
  `id: null`; (4) `buildAndRun` with the default `awaitEntry: true` did not
  return for a tight-loop program on the real ROM (use `awaitEntry: false`);
  (5) `tests/mcp_server.test.js` uses a stub runtime, so it checks the mapping
  but never boots the emulator.
- 2026-11-10 (jsA8E: cleanup pass, no behavior change): removed dead code found
  by ESLint and a manual sweep: `drawPlayerSpan`, `drawMissileSpan`, `playerStep`
  and `missileWidth` (`gtia.js`, superseded by the span queue), `zeroPageAddress`
  (`memory.js`), `deleteRecord` (`disk_library.js`), the unused IRQ constants and
  `pokeyRestartTimers` that `atari.js` passed to `io.js`, two unused panel
  constants in `assembler_ui.js`, the write-only `mobilePanelSyncing` flag in
  `ui.js`, a stale local in `antic.js` and `library_package.js`, and unused
  `catch (err)` bindings. `no-case-declarations` in `io.js` (SKCTL write) fixed
  with a block; `eslint --fix` added braces to single-line `if`/`for` bodies
  (formatting only). `npm run lint` now reports zero errors. Eleven passing
  tests that no npm script ran (`pokey_pot_cpu_dispatch`, `pokey_pot_io_path`,
  `antic_vscrol_timing`, `ahrm07_pmg_{xex,boot}`, `ahrm08_pokey_{xex,matrix_xex,
  stage2_xex}`, `ahrm10_priority_collision_boot`,
  `vbxe_blitter_short_attrmap_timing_{asm,boot}`) are now in `test:automation`
  and `test:vbxe:full`. AHRM review: this cleanup removes only code with no
  caller, so no hardware behavior changes; the core changes made after the
  2026-11-04 AHRM review are VBXE hooks (PIA IRQ and PORTB remap, citing AHRM
  5.7 and 12.4) and the gamepad, which only drives PORTA/TRIG0 active-low bits.
  Docs: root `README.md` and `CHANGELOG.md` now mention the remote library sync.
  Verified: `test:automation` and `test:vbxe` pass, lint clean. Not run: native
  `ctest` (no C changes) and `test:vbxe:full`.
- 2026-11-07 (A8E native: gamepad support): the native build now has the same
  feature. New `A8E/Gamepad.c/.h` (in `A8E_CORE_SOURCES`) uses the SDL joystick
  API, not SDL_GameController, so plain USB joysticks work without a mapping
  database: hot-plug on `SDL_JOYDEVICEADDED`/`REMOVED` (up to four pads),
  `Gamepad_Poll` once per frame after the event loop (axes 0/1 past half range
  or the first hat; buttons 0-3 fire; pads merged; opposites cancel).
  `AtariIoGamepadState` (new, `AtariIo.c`) applies the result to `PORTA` bits
  0-3 and `TRIG0` while tracking its own held bits (`cGamepadDirections`,
  `bGamepadFire` in `IoData_t`); the keyboard path and `cJoystickArrowMask` are
  unchanged and a key-held direction stays pressed. F5 reset clears the pad
  bits too. `SDL_InitSubSystem(SDL_INIT_JOYSTICK)` is separate from
  `SDL_Init` so a failure cannot stop startup. Limit: pad fire and Left
  Control share `TRIG0`, so releasing the pad button releases the trigger even
  if Left Control is still down. New `gamepad_probe` (ctest) covers the
  mapping, the `PORTA`/`TRIG0` effect including keyboard interplay (checked by
  breaking the protection on purpose: it fails exactly there), and the real SDL
  path with an SDL virtual joystick (attach, axes, hat, buttons, unplug while
  held; skipped on SDL older than 2.0.14). Results: native `ctest` 17 of 18,
  only `pokey_sio_contract_probe` fails, as already recorded on a clean `main`.
  The ROM-dependent probes need `ATARIXL.ROM`/`ATARIBAS.ROM` in the repo root
  (gitignored); I copied them there for the run and removed them afterwards.
  Smoke run of the full `A8E` with the SDL dummy drivers: it detected the
  Xbox 360 Controller connected to this machine and ran until the timeout.
  Not verified: real button presses on that pad (no way to press them), the
  window-focus behaviour of SDL joystick events, and Windows/macOS builds.
- 2026-11-07 (jsA8E: physical gamepad support): there was none. The keyboard
  arrows/Control and the on-screen stick were the only joystick inputs, and
  the native A8E has no gamepad code either (no SDL, no `/dev/input`); an
  earlier statement in this session that "the joystick is implemented in both"
  referred to the keyboard and virtual stick only. New `js/app/gamepad.js`
  (`window.A8EGamepad`): pure `readJoystickState(pads)` (d-pad buttons 12-15 or
  stick axes 0/1 past 0.5; face buttons 0-3 fire; opposite directions cancel;
  disconnected pads ignored; several pads merged) and a `createPoller` that
  runs on `requestAnimationFrame` only while a pad is present and calls back
  only on change. `ui.js` routes changes to the existing
  `setJoystickDirection`/`setJoystickFire`, so the worker and main-thread
  paths behave the same and the core is untouched. `gamepad_mapping.test.js`
  (in `test:automation`) covers the mapping and the poller (changes only,
  single loop, release on unplug, restart). Verified in the Chromium on port
  9222 over CDP, in a new tab with the cache disabled and `navigator.getGamepads`
  replaced by a fake: reading `PORTA`/`TRIG0` through `api.peek`, axis and
  d-pad left/right/up/down, fire from two face buttons, combinations, release
  and unplug all gave the expected active-low bits. Not tested with a physical
  pad. Lessons: (1) a first run that "did nothing" was Chromium serving a
  cached old `ui.js` from the 8090 static server (fetch with `no-store` saw the
  new file while the page ran the old one), so disable the cache when
  verifying UI changes; (2) physical keys are listened to on the canvas, not on
  `window`. Unexplained and not investigated: in a fresh page the first
  ArrowRight press (keyboard, also via the gamepad path) was ignored once while
  later ones worked; left, up and down did not show it. ESLint could not run
  (no `node_modules`); `node --check` passes.
- 2026-11-11 (jsA8E: remote sync hardening, post-merge): (1) hash cache:
  `getManifest()` passes `hashOfRevision` (WeakMap, revisions are immutable) to
  `makeManifest({revisionHash})`; `readBlob` and the tombstone hashes no longer
  cache the current bytes, which sector writes mutate in place (this fixed a
  latent stale-hash bug). (2) `client.head()` returns `lastModified`,
  `client.deleteFile()`, `sync.collectGarbage()` and the "Clean up remote" button
  (age >= 7 days, never touches blobs referenced remotely or locally; needs
  `DELETE` in CORS). (3) Opt-in "Remember the password" (unencrypted
  localStorage) with automatic reconnection on load; rejected stored passwords
  are discarded. (4) Gamepad sampling counts as activity for the idle sync.
  (5) "Unknown worker request" now explains the stale-cache cause. Tests:
  GC cases in `remote_library_tombstones.test.js`. Native client is blocked on
  the HTTPS/TLS dependency decision (see `OnlineDrive.md`).
- 2026-11-10 (jsA8E: remote renames and moves, Phase 2b): entries carry a
  persisted `metaModified` (set by `moveFile`, name-changing `replaceFile`,
  `restoreTrash`; manifest field `metaModifiedAt`, validated as optional).
  `library.applyMetadata()` (core + proxy + worker + parity test) applies remote
  moves/renames only when newer, never creating duplicate names, and reports
  `newer` values so the sync republishes them. Remote folders already known
  locally are passed to the importer under their local name (avoids `-import`
  duplicates). Native A8E still lacks fast-forward, tombstones and metadata merge.
  Test: `tests/remote_library_metadata.test.js`.
- 2026-11-10 (jsA8E: automatic remote sync, Phase 3): `client.head()` and
  `sync.checkRemote()` (HEAD + ETag compare, both scopes). `remote_sync_ui.js`
  polls every 60 s and on focus/visibility, shows "Update" when the remote moved,
  and runs the pending sync after 5 min without keyboard/pointer input; opt-out
  checkbox `.remote-auto` in the dialog (saved as `auto`). A vetoed merge is never
  retried automatically. Gamepad activity is not detected. Password is still memory
  only. Tests: `checkRemote` assertions in `remote_library.test.js`.
- 2026-11-09 (jsA8E: remote deletions, Phase 2b tombstones): `deleteFile` /
  `deleteFolder` record tombstones in the IndexedDB `metadata` store (no schema
  bump); `restoreTrash` removes them and bumps `modified`. Core API
  `getTombstones`/`applyTombstones`/`dropTombstones` (proxy + worker + parity
  test), `getManifest()` emits `tombstones`, the sync fingerprint includes them.
  A tombstone only covers an entry whose contents it listed and whose `modified`
  predates the deletion, so a later edit/move/restore always wins; remote
  deletions go to the local trash, never purge. Tombstones expire after 90 days.
  Also: empty remote folders now merge. Renames/moves still do not propagate.
  Native A8E has no tombstones yet (parity debt). Test:
  `tests/remote_library_tombstones.test.js`.
- 2026-11-08 (jsA8E: remote full-library sync, Phase 2a): new mode "Whole
  library" next to the workspace MVP. `js/app/remote_library.js` keeps
  `library.json` + `blobs/<sha256>.<type>` on the WebDAV folder, transfers only
  the blobs the other side lacks (SHA-256 verified on download, `HEAD` then
  `PUT If-None-Match: *` on upload, manifest guarded by `If-Match`), imports in
  <=48 MiB batches through the existing `importPackage`, and does not sync
  mounts. Needs `MKCOL` in the server's CORS methods (creates `blobs/` once).
  New library APIs `getManifest()`/`readBlob(sha)` in `disk_library.js`,
  `app_proxy.js` and `emulator_worker.js`; the parity test now also scans the
  remote modules. Core fix found while testing: `planImport` treated every
  same-id/different-hash entry as a conflict, so a plain "edit in A, sync in B"
  produced a `(1)` copy even though the revision graph said B's copy was an
  ancestor. It now fast-forwards (adds the new revisions, advances the working
  content and keeps the drive) when the local content is a retained ancestor of
  the imported entry, ignores imported content that is already a local
  revision, and keeps copies only for diverged branches. NOT mirrored in native
  A8E yet (parity debt). Tests: `remote_library.test.js` (shared fixtures in
  `remote_test_support.js`: pull, incremental upload/download counts, revisions,
  concurrent edits, vetoed first merge, corrupted blob), `remote_workspace`
  updated (fast-forward keeps D1, merging side keeps both variants), proxy test
  covers the new messages. Not yet validated against Nextcloud; the worker
  handlers themselves have no automated test. ESLint could not run.
- 2026-11-08 (jsA8E: remote workspace sync MVP, branch `OnlineDrive`): added
  optional manual synchronization of the mounted workspace with a WebDAV
  folder. `js/app/remote_workspace.js` (fetch client + sync coordinator, no
  DOM) keeps one `workspace.a8e` plus `.a8e-remote.json`, guards every write
  with ETag `If-Match` / `If-None-Match: *`, and merges remote content through
  the existing non-destructive `previewImport`/`importPackage` (it only uses the
  public library API, so worker and main-thread paths both work and
  `emulator_worker.js`/`app_proxy.js` are untouched). `js/app/remote_sync_ui.js`
  adds the title-bar control, the connection dialog and the LED (reuses
  `assets/leds.png`, also as a badge on the top-bar and mobile Disks buttons).
  The password stays in memory; only URL/user/repoId/ETag/fingerprint go to
  localStorage. `tests/remote_workspace.test.js` (in `test:automation`) runs two
  independent libraries against an in-process ETag-aware server: auth failure,
  foreign folder, missing-ETag diagnosis, publish, no-op sync, pull, sequential
  edits, concurrent edits (412 -> merge -> republish, both variants kept) and a
  vetoed first merge. Chromium headless smoke test: page loads, control and
  badges initialize, no console errors. Verified by the author against a real
  Nextcloud with jsA8E served from the same server (Firefox + Chromium: pull,
  push, collisions kept as `(1)`); a first failed attempt was a wrong URL. The
  status text now says when the remote is empty and nothing is mounted instead
  of a bare "up to date". Findings:
  `libraryVersion` only increments on import, not on local edits, so pending
  changes are detected with a manifest fingerprint instead; `replaceFile`
  unmounts a mounted entry (tests remount it). Tombstones, the incremental
  `library.json` + `blobs/` repository, automatic sync and native parity are
  designed in `OnlineDrive.md` but not implemented. ESLint could not run (no
  `node_modules`); `node --check` passes.
- 2026-11-06 (jsA8E: Disk Library parity with and without the worker): the
  library UI talks to either the core `disk_library.js` (main thread) or the
  proxy in `app_proxy.js` (worker). Comparing both APIs showed that the proxy
  lacked `exportWorkspacePackage`, `renameFolder`, `listRevisions`,
  `selectRevision`, `verifyFile` and `getStorageEstimate`. With the worker the
  "export mounted workspace" button was not wired at all, folder rename threw
  a TypeError, and revision info, ATR verification and the storage estimate
  were missing. Added the proxy methods, the matching worker commands
  (`diskLibraryRenameFolder`, `...SelectRevision`, `...Verify`,
  `...StorageEstimate`; workspace export reuses `diskLibraryExport` with
  `workspaceOnly`), and a `revisions` map in the `diskLibrarySnapshot` message so
  `listRevisions` stays synchronous. `app_proxy_library_export.test.js` covers the
  new proxy calls. Progress and
  cancel of export, import preview and import now work with the worker too:
  the proxy tags the request with an `opId`, the worker posts
  `diskLibraryProgress` messages with that id, and the proxy sends
  `diskLibraryCancel` when the caller's `isCanceled` or `signal` is set
  (checked on each progress report and on a 50 ms timer; a
  cancel already set when the call starts rejects immediately with
  `a8e_library_canceled`, as in the main-thread core). Verified in Chromium over
  CDP in an isolated browser context (the real profile's library was not
  touched), with and without `?a8e_no_worker=1`, after loading `ATARIXL.ROM` and
  `ATARIBAS.ROM` into the page (jsA8E is not fully usable before the ROMs):
  add, create/rename folder, revisions, verify, storage estimate, export (6
  progress events), workspace export, import preview and cancel give identical
  results in both modes. Also verified in the user's test Chromium tab (worker,
  73 MB library, 43 files): export, workspace export, rename, verify, revisions
  and storage estimate work. Cancel limit, same with and without the worker:
  the worker only sees a cancel when its event loop is free, and a 73 MB export
  spends about 4 s building the manifest and 2.5 s writing the archive in
  synchronous code (measured from progress timestamps), so a cancel issued
  during those stages is ignored until the next yield. Making export/import
  truly interruptible would need yielding inside `library_package.js`
  (manifest hashing and archive writing); not done.
  `disk_library_api_parity.test.js` (in `test:automation`) fails if the UI calls
  a library method that is missing from either the core or the proxy. Root
  cause of the whole group: the two paths (worker proxy and main-thread core)
  are selected at runtime (Firefox and Tauri use the main thread) and had
  drifted apart since the Full Library work of 2026-10-09/16; the Firefox
  main-thread default of 2026-11-04 only exposed it.
- 2026-11-06 (jsA8E: "Export the complete library" downloaded the text
  `undefined`): the UI read `result.bytes`, but only the worker proxy
  (`app_proxy.js`) converts the export's `buffer` into `bytes`. The main-thread
  library (`atari.js` -> `disk_library.js`) returns `{ buffer, manifest,
  fileName }`, so `new Blob([undefined])` produced a file containing
  "undefined". `disk_library_ui.js` now uses a `packageBytes(result)` helper
  (accepts `bytes` or `buffer`, throws if neither) for both the library and the
  mounted-workspace export. Not verified in a browser; the main-thread path
  was inferred from the code. No automated test covers the UI handler.
- 2026-11-06 (VBXE merge readiness and Altirra source audit): prepared the
  `VBXE` branch for merging into `main` as an experimental, opt-in feature (the
  merge itself is done by the maintainer). Results: jsA8E 59 of 59 VBXE tests
  pass (including `vbxe_blitter_attrmap_phase_boot`, which is intermittent),
  native `ctest` 16 of 17 (`pokey_sio_contract_probe` fails identically on a
  clean `main` worktree, so it is not from this branch); the diff has no
  binaries, ROMs or build output. Read `build/Altirra-4.40-src/src/Altirra/source/vbxe.cpp`
  (memory maps, `ReadControl`/`WriteControl`, XDL decoder, blitter) against
  `vbxe.js` and `Vbxe.c`: registers, MEMAC and XDL match; blitter differences
  D1-D7 were found and recorded, not changed (mode 6 collision nibble order,
  mode 7 treated as copy by Altirra, mode 4 zero-source cost, `BLITTER_BUSY`,
  per-row budget, undefined register reads, attribute-map cell). The renderers
  and priority tables were not audited. All open items now live in
  [VBXE_ROADMAP.md, Known issues and pending work](VBXE_ROADMAP.md#known-issues-and-pending-work);
  resume from there. Side effect to remember: `npm run test:vbxe:browser`
  drove the Chromium on port 9222 that was open with Commando. READMEs and
  `VBXE.md` now point to the list; the root README no longer says the native
  core lacks VBXE.
- 2026-11-05 (jsA8E VBXE: MEMAC A above $D800, Commando terrain): in
  `commando230810.xex` the player walked over palms, rocks and the bridge in
  jsA8E but was blocked in A8E. Disassembling the game showed that its
  collision routine ($394E/$3872) does not use GTIA or VBXE collision
  registers (it never writes HITCLR and reads <500 VBXE registers per run); it
  indexes a tile map in plain RAM at $4000-$5F3F. Level init ($2078/$20F6)
  fills that map by opening MEMAC A as a 4K window at $E000 (`$D65E=$E8`,
  `$D65F=$C0|bank`, OS ROM off) and copying it from VRAM. jsA8E's
  `installIoHandlers` capped every MEMAC A window at `$D000`
  (`Math.min(0xd000, ...)`), so a window at $E000 was never routed and the copy
  read RAM zeros: the map stayed empty and nothing blocked the player. Windows
  are now split around the hardware pages and may cover $D800-$FFFF (RAM only,
  ROM keeps priority, as in the native `Vbxe_SyncWindows`). After the fix the
  map is byte-identical to A8E and the player stops at the rock plateau.
  `vbxe_memac_window_sync` gained a $E000 read/write/close case. Lesson:
  when a game "works in one core", compare the CPU-visible memory at the same
  game moment first; here an 8000-byte diff pointed straight at the cause.
- 2026-11-05 (Gacek VBXE: BASIC and BCB latch): `Gacek_vbxe_f+.xex` showed two
  separate problems. (1) Noise instead of bombs/enemies: the game keeps its
  sprite sheet in RAM `$8000-$B03F` and copies it to VRAM; with BASIC enabled
  the part from `$A000` reads the BASIC ROM. The 16 rows of the source sprite in
  VRAM matched `ATARIBAS.ROM` byte for byte (read bottom-up). Not an emulator
  bug: run with `-o` (A8E) or "Option on start" (jsA8E), as Altirra does for
  executables. Open question: whether loading an XEX should disable BASIC by
  default. (2) Trails behind moving sprites with BASIC off, in both cores:
  Altirra's `BLITTER_START` loads the first BCB immediately (vbxe.cpp ~line
  1356: "some demos are a bit creative and overwrite the first entry without
  checking blitter status"); we read it when the 21-cycle load finished, so a
  program that reuses the block right after START (Gacek queues its next sprite
  that way) changed the blit in flight and the erase blits were wrong. Fix in
  both cores: START copies the 21 bytes (`preloadedBlock` in `vbxe.js`,
  `aPreloaded` in `Vbxe.c`); the load cycles still cost time. Tests:
  `vbxe_blitter_start_latches_bcb` and `TestBlitterStartLatchesBcb`, both
  failing without the fix. VBXE suite 57 of 58 (only the unstable
  `vbxe_blitter_attrmap_phase_boot`), `ctest` 16 of 17 (`pokey_sio_contract_probe`).
  Still different from Altirra and not changed: `BLITTER_BUSY` bit 1 is set only
  while processing (not while loading the BCB), and a START written while the
  BCB loads restarts the blit; both cores ignore a START while loading. Tooling
  note: native screenshots for such checks came from a debug copy of `A8E.c`
  built outside the repo, with env-driven frame dumps and key/fire injection.
- 2026-11-05 (VBXE overlay priority for ANTIC hires): `vbxe_fx124_priority_probe_boot`
  (known failing "legacy bit 6 must win over PF2") traced to Altirra's
  `RenderMode8` (`vbxe.cpp`, lines 2530-2690): in ANTIC hires (modes 2, 3, F
  with PRIOR bits 7-6 clear) the priority logic sees PF2 for every pixel; the
  luma bit only changes the color. Only FX 1.26 with extended color
  (VIDEO_CONTROL bit 1) uses PF1 for set pixels (comments at lines 2539-2540:
  "For V1.26+, use PF1 priority for set pixels. For V1.25-, use PF2/PF3
  priority for all pixels"). jsA8E and the native core always gave set pixels
  PF1, so the FX 1.24 bit-6 band did not cover them. Fix in both cores
  (`hiresPriorityForOverlay` in `vbxe.js`, `Vbxe_Composite` in `VbxeVideo.c`):
  the overlay's priority and collision input maps PF1 to PF2 for hires lines
  unless FX 1.26 with extended color, and never for reverse attribute cells
  (they read the data as lores). GTIA's own priority/collision data and the
  attribute-map colors are unchanged. Results: the probe passes; the VBXE suite
  is 56 of 57 (only the unstable `vbxe_blitter_attrmap_phase_boot` fails, as
  before); `vbxe_probe` passes with a case for extended color. Not done: in
  Altirra, without extended color a set pixel in an attribute-map cell takes the
  cell's PF2 color with only the PF1 luminance (lines 2610-2620); both cores
  still use the full PF1 color. No real program showed the difference yet.
- 2026-11-05 (VBXE text mode: clipped top of characters): in Textmode Test
  modes 3 and 4 (80x30, 80x32) the XDL uses entries of 7 lines with
  `OVSCRL Y=1` (skipping the usually blank first glyph row). `nextXdlLine`
  already starts each entry at `textRow = scrollY`, but `renderTextXdlLine`
  added `textScrollY` again (`sourceRow = textRow + textScrollY`), so the
  first line showed glyph row 2 and the top of every character was cut. Fixed
  in both cores (`sourceRow = textRow`); the `vbxe_device_state` render case
  was rewritten for the corrected semantic, and `vbxe_probe` has
  `TestTextVerticalScrollStartsAtLatchedRow`. The text, scroll, collision and
  Textmode Test boot tests still pass.
- 2026-11-04 (Native A8E: VBXE stage 2 on a real demo): running `demoD600.xex`
  (`./A8E -128k -n --vbxe`) showed every other screen column black. Cause: the
  project's `u32` is `unsigned long`, 8 bytes on LP64, and the ARGB overlay
  plane and its copy into the 32-bit SDL surface used `u32` as the pixel type.
  Pixel buffers now use `uint32_t`; keep that in mind for any new pixel code
  (the existing `u32` is fine for values, wrong for memory layouts). The first
  suspects (priority bits of ANTIC hires, the blitter) were ruled out by
  logging the first 400 BCBs and 128 page checksums at blit 300 in both cores:
  identical. Also added reverse attribute-map cells for plain ANTIC hires and
  lores (the demo's Fuji logos use them) and averaging of hires/text pixel
  pairs. Probe: `TestOverlayReachesScreen` now checks three consecutive screen
  pixels; `TestHiresPairIsAveraged`.
- 2026-11-04 (Native A8E: VBXE stage 2): `A8E/VbxeVideo.c` ports the video
  side of `vbxe.js`: the XDL engine (`Vbxe_NextXdlLine`: control bytes,
  repeat, END after the repeat run, OVADR/OVSCRL/CHBASE/ATT/MAP/MISC fields,
  latches kept across VSync), the standard, lores, hires and text overlay with
  Altirra's transparency rule (VIDEO_CONTROL D2 set = opaque), overlay
  priority tables per profile (FX 1.20/1.24 without the background bit), COLMASK
  collisions into COLDETECT, playfield palettes from MISC, the attribute map
  (43-cell line buffer, scroll, cell size, PF3 bitmap) and the DMA slots a line
  takes (22 per new XDL entry, overlay 64/80/84 machine cycles by width, text
  195/243/255, 172 for a map reload), subtracted in `Vbxe_EndOfLine`. A line is
  composed by `Vbxe_ComposeLine` right after `AtariIoDrawLine` into an ARGB
  plane (`pOverlay`, 456 x 312, 0 = no VBXE pixel); `AtariIoDrawScreen` copies
  it over the 8-bit frame in the direct and the scaled paths. Native limits,
  documented in `A8E/README.md`: output is the 336-pixel window, so hires and
  text overlays average each pair of source pixels into one (a first version took one sample and showed vertical stripes on dithered hires images); each line is composed once
  when it closes (no GTIA mid-line replay); reverse attribute-map cells rebuild the ANTIC source bits from the GTIA layer
  of each pixel (hires pairs, lores values) and only the GTIA special-mode
  combinations fall back to the plain selection; slot
  accounting is aggregate. As in jsA8E, the playfield palette only applies on
  lines where the overlay or the map is enabled. Tests: four new cases in
  `vbxe_probe` (standard overlay with repeat/END/priority/collision, text,
  attribute map plus playfield palette, overlay reaching the screen surface);
  a mutation of the XDL update cost makes the probe fail. `ctest` unchanged:
  the same two older failures.
- 2026-11-04 (Native A8E: VBXE stage 1 and parity check): compared the branch
  against `main`; everything jsA8E changed outside VBXE is already in the
  native core (GTIA `$D01B-$D01E` reads, no DLI in vblank, player/missile early
  return). The remaining gap is the VBXE device, so it is being ported in
  stages. Stage 1 is `A8E/Vbxe.c`/`Vbxe.h` (a port of the relevant parts of
  `vbxe.js`): register bank with revisions `$10`/`$20|$24|$26`, 512 KiB VRAM,
  palette latches with the D7 to D0 expansion, configuration latch, MEMAC A/B
  for CPU, ANTIC and instruction fetch, blitter (BCB load, modes 0-6, zoom,
  pattern, signed steps, byte and nibble collisions with the AHRM `value>>5`
  groups, linked blocks, stop), completion IRQ as a level source placed at its
  cycle inside the line, `BLITTER_START` running the rest of the scanline's
  budget (Altirra behavior that Mr. Proper depends on), and the
  `$D080-$D0FF` reset strobe. Native specifics: MEMAC windows are installed as
  access handlers only over RAM-mapped addresses (ROM and `$D000-$D7FF` keep
  priority) and are rebuilt only when the routing bits change or when `Pia.c`
  changes the OS/BASIC/Self-test mapping; `6502.c` got `pfnFetchStage`/
  `pfnFetchRestore` hooks to run code from a window; `Pia_IrqAsserted` ORs the
  VBXE line; `AtariIo_ReadAnticMemory` (and the display-list reads) go through
  MEMAC. Not done yet: XDL parser, overlay, attribute map, priority/collision
  composition, XDL/overlay local-bus slots (the blitter budget is 912 minus
  MEMAC accesses), FX 1.26r RAMBO, snapshots, UI selector. CLI:
  `--vbxe[=fx1.20|fx1.24|fx1.26]`, `--vbxe-d7`. Test: `tests/vbxe_probe.c`
  (11 cases; a mutation of the mid-line budget makes it fail). `ctest`: 15 of
  17 pass; `antic_graphics_modes_probe` and `pokey_sio_contract_probe` were
  already failing. Also updated `implementation/DIAGRAM.mermaid` (VBXE in both
  cores, Tauri shell, ROM library, headless/MCP, Firefox main-thread default,
  test counts).
- 2026-11-04 (Evaluation of moving work to the GPU, no code changes):
  `render/gl.js` already uploads the 8-bit indexed framebuffer and applies the
  palette, VBXE and CRT in shaders; the CRT has no measurable CPU cost in
  Firefox (emulator thread 92-100 % with or without it). What remains in JS
  cannot be moved without losing accuracy: CPU/ANTIC/GTIA/POKEY and the
  blitter are sequential and the program reads their results (collisions);
  `applyPlayfieldAttributes` alters the colors/priorities that GTIA collisions
  use. The only movable piece would be `renderXdlLine` (overlay, ~5-7 % of the
  active CPU), which would require uploading the 512 KB VRAM with change
  tracking and per-line XDL/palette state, and keeping two bit-for-bit
  equivalent paths (GL and software/headless). Small gain versus the
  maintenance cost: discarded.
- 2026-11-04 (Interactive Firefox and per-row blitter): interactive session
  with a graphical Firefox (own instance with a BiDi port, key and screenshot
  recorder, file-based command channel) with the user playing Popeye in worker
  mode: the worker stopped answering `getCounters`/`captureScreenshot` for
  4-15 s, with the `DOM Worker` thread at ~92 % of a core, from the moment the
  game went from loading to the title screen (before any user key). Without
  human intervention, the same sequence gave an emulation speed of 83-92 % in
  that phase, that is: the worker is at the limit of one core and any added
  load (my screenshot queries, the user's Chromium with jsA8E open at ~35 %)
  leaves it behind. In Chromium the same phase used 72 % of the main thread.
  V8 profile of Popeye during play: `advanceBlitter` 12.2 % (the top),
  `clockAction` 8 %, mode 4/5 5 %, attribute composition 4.5 %. Change:
  `advanceBlitter` processes rows without X zoom with a tight loop (same
  per-byte rate and the same free slots consumed in the same order; the last
  byte of the row stays in the per-byte path, which handles row and block
  rollover). Equivalence checked: Mr. Proper and Popeye give the same VRAM
  hash, the same cycle counter, the same collision code and the same blitter
  state before and after. Result in Chromium: `advanceBlitter` 12.2 % to 3.3 %
  and thread occupancy 72 % to 63 %. Firefox's native profiler
  (`MOZ_PROFILER_STARTUP`) only delivered the parent process, so there is no
  SpiderMonkey profile. Full suite: 120 of 122; the two known ones fail
  (`vbxe_fx124_priority_probe_boot` and the unstable
  `vbxe_blitter_attrmap_phase_boot`).

- 2026-11-04 (Firefox: worker mode): on the user's desktop Firefox the worker
  mode (the default) had several seconds of input lag; a minimal request to
  the worker (`getCounters`) hit the 4 s timeout, and with the emulation on
  the main thread (`?a8e_no_worker=1`, private window) the game was playable.
  On the development machine's windowless Firefox 158 (software WebGL) the
  worker ran at 58-60 fps with a 14-25 ms round trip, so it was not reproduced
  and the cause inside Firefox (`OffscreenCanvas` presentation or the worker's
  rAF scheduling) is not identified. Palliative measure: `supportsWorker()`
  returns false on Firefox unless `?a8e_worker=1`, as it already did for the
  Tauri WebView. Pending: test on Firefox with `a8e_renderer=2d` in worker
  mode and without the CRT effect to see whether it is the worker's WebGL, and
  remove the exception if it is fixed.

- 2026-11-04 (AHRM review and generality): reviewed this session's changes
  against the AHRM. Fixed: the blitter's byte collision mask used
  `(value-1)>>5`; AHRM 12.4 says bit 0 = `$01-1F`, bit 1 = `$20-3F`, that is
  `value>>5` (Altirra does the same). Fixed: the blitter's mid-line start now
  subtracts that line's screen DMA (overlay, XDL, attribute-map reload)
  instead of using all the remaining time. Documented as deliberate deviations
  from the AHRM text, both because of Altirra and real software: polarity of
  `VIDEO_CONTROL` D2 and the bits of `MEMAC_B_CONTROL` (D7 CPU, D6 ANTIC; the
  AHRM gives them the other way round). No change depends on a title: all are
  device rules or optimizations that preserve the output (verified pixel by
  pixel on Mr. Proper). The `vbxe_blitter_short_overlay_timing_boot` marker
  went from VCOUNT 56 to 57 because of the DMA discount; the test does not fix
  the value and the documented spread versus Altirra was already one sample.

- 2026-11-04 (Mr. Proper: fruits that cannot be eaten, and performance with
  MEMAC B): `mrproper_vbxe.xex` boots and draws, but the user saw fruits that
  could not be eaten and repeated blocks. Cause: the game reads
  `BLT_COLLISION_CODE` (`$D650`) a few cycles after writing `BLITTER_START`
  (`$25da`-`$25e2`, without waiting for the blit to finish) and stores the
  result in the object. In Altirra (`vbxe.cpp`, case `0x53` of `WriteControl`)
  the start loads the BCB and immediately runs whatever is left of the
  scanline (`maxBlitTime = (mBlitterEndScanTime - now) * 8`), so the first rows
  of the sprite have already detected collision when the game reads the
  register. We gave the full line budget at the end of the line, so `$D650`
  was almost always 0 (1823 of ~1900 reads) and detection never fired. Now
  `io.js` calls `startBlitterMidLine` when `BLITTER_START` is written with the
  blitter stopped: `(114 - line cycle) * 8` slots are run without a bus
  schedule, `blitterEarlyRun` is set so that that line's budget is not spent
  twice (`antic.js`) and, if the blit finishes, the end IRQ is placed at its
  cycle. With the change, 1021 of ~2000 reads are non-zero. New test:
  `vbxe_blitter_midline_start.test.js` (in `test:vbxe`). The other blitter
  timing tests still pass (the unstable `vbxe_blitter_attrmap_phase_boot`
  fails the same with and without the change, 3 of 4 runs under load).
  The frames with green smudges and a cyan band that appear in Mr. Proper also
  appear in Altirra (checked by capturing both); they are not an artifact.
  Performance: the game writes `$D65D` (MEMAC B) twice per blit, about 21
  `installIoHandlers` calls per frame, and each one walked 16 K addresses
  calling `vbxeMemacAddress` (11.6 % of the Node profile).
  `installIoHandlers` now decides per range using the CPU enable bits, fills
  the whole range with `fill` when everything was RAM and is not rebuilt if
  the window set has not changed (`onlyIfChanged`, only from
  `syncVbxeWindows`; the memory-map rebuild still walks address by address so
  as not to overwrite ROM). `applyPlayfieldAttributes` looks up the attribute
  map cell once per cell run and has a fast path for cells without Rev (the
  Rev chain is only evaluated on Rev cells); decoded cells are stored on the
  row buffer itself. Mr. Proper in Node: 42 to 51 fps; the output is
  identical pixel by pixel before and after. Windowless Firefox 158, main
  thread, 60 fps with callbacks averaging 10 ms but p95 of 29 ms and a maximum
  of 58 ms (stutter); in worker mode 60 fps with the main thread almost free.
  There are still about 45 garbage collections per 300 frames in Mr. Proper
  (versus 1 in BASIC and 6-16 in other VBXE games), spread across
  `renderXdlLine`, the attribute map and the blitter; the exact source of the
  allocation was not located. Native A8E does not implement VBXE, so there is
  nothing to port.

- 2026-11-04 (performance, second round): the CPU profile taken inside
  Chromium (CDP `Profiler`, not Node's) showed that the most expensive thing
  was not VBXE but GTIA's `drawPlayerMissilesClock` (36 %): it runs on every
  color clock of every line even when there are no players or missiles. It now
  returns early when no shift register has bits, nothing can load in the span
  (`pmgMayReloadInSpan`) and there is no pending catch-up of earlier spans;
  the per-pixel loop and collision mixing changed nothing in that case. The
  same fix is in native A8E (`AtariIo_PmgMayReloadInSpan`). Other VBXE changes:
  `attributeMapPf3MaskBit` exits immediately with an empty mask (it was 32 %
  of the Node profile on D600) and without `Math.floor`; `installIoHandlers`
  only walks the addresses MEMAC can cover and reuses the capture mask (D600
  rewrites a MEMAC register every frame); `buildLocalBusSchedule` reuses its
  buffer; `loadAttributeMapBuffer` copies with `set`; and
  `applyPlayfieldAttributes` makes a single pass per pixel (the two decision
  chains were identical) and writes the same RGB to the native plane and the
  legacy one with the same guards each pass had. Results (the machine was
  saturated by other user tabs, load 8-12, so these are lower bounds): D600 in
  the Node harness 28 to 49 fps, windowless Firefox 158 34 to 49 fps. Thread
  occupancy in Chromium is not comparable between runs under that load.
  Lessons: leaving measurement processes alive (a windowless Firefox kept
  running the demo) corrupts everything measured afterwards; the instance and
  the CDP tabs must be closed when done. Native A8E was not timed; its
  `antic_graphics_modes_probe` probe was already failing before with the same
  message (`TestPmgModeZeroPlayfieldMix`).

- 2026-11-04 — Summary of the "VBXE with real software" session (the detail is
  in the following entries, from newest to oldest). Starting point: almost all
  real VBXE software stayed in the loader, and D600, Popeye and company were
  slow or did not draw. Result: Popeye playable, D600 correct and at 60 fps in
  Chromium, Phoenix/Celeste/Galaga/Crysis/Falcon working. Causes, in the order
  they appeared:
  1. MEMAC window remapping (RAM that did not return to RAM when the window
     was disabled; a full map rebuild that erased the RAM under the ROM).
  2. Performance: per-DMA-byte `window.A8EVbxe` lookups, a 912-slot rescan per
     blitter byte, `Math.*` in hot paths.
  3. GTIA reads `$D01B-$D01E` (`$FF` instead of `$0F`).
  4. Polarity of `VIDEO_CONTROL` D2 (transparency) inverted with respect to
     Altirra; the AHRM describes it the other way round.
  5. Instruction fetch from MEMAC windows (the CPU read the RAM).
  6. Spurious DLI in vblank (region-exit decision with VSCROL without checking
     for a visible line). Also ported to native A8E, together with (3).
  Methodology that worked: (a) compare with Altirra 4.40 under wine (`/run`,
  debugger with F8, `ba w <addr>` to see who writes an address, `.writemem`
  to dump 64 KiB, `.vbxe_xdl`, `.antic`, `.restart`) and with jsA8E's RAM;
  (b) pcHooks in jsA8E to count and order the flow; (c) read the loader
  structure from the XEX (Popeye: 623 segments with an LZ decompressor at
  `$8E6A`); (d) the stack on VBI entry reveals what was interrupted; (e)
  `Object.defineProperty` on an `ioData` property to see who writes it; (f)
  measure fps in the Node harness, in a fresh Chromium tab over CDP (port 9222,
  `Page.bringToFront`, `Performance.getMetrics`) and in Firefox over WebDriver
  BiDi (port 9223).
  Pitfalls: in the headless harness every access to a global (`window.X`,
  `Math`) is a slow lookup in the `vm` context, so it overestimates that cost
  compared with the browser; several files mix CRLF and LF line endings (edit
  by bytes and check `git diff --stat`); `pkill -f`/`pgrep -f` with a pattern
  that is present in the command itself kills the shell; a script of mine
  named `dis.py` shadows Python's `dis` module; the `phase_boot` tests and
  similar use wall-clock timeouts and fail intermittently when the machine is
  loaded; `vbxe_fx124_priority_probe_boot` was already failing before this
  session. Pending: `vbxe_real_software_scene` gates that wait for the end of
  loading, Firefox (≈2x slower than Chromium), and comparing
  Galaga/Crysis/Falcon/Phoenix/Celeste with Altirra.

- 2026-11-04: Native A8E: ported the two core fixes made in jsA8E; the VBXE
  ones do not apply because the native core does not implement VBXE.
  (1) `AtariIo.c`: the region-exit DLI decision with VSCROL (cycle 6) is only
  evaluated on lines 8-247; without that guard a last display-list command
  `$94` after `$B4` left `bModeLineExitDli` active and ANTIC raised a DLI on
  every line 249-261 (in Popeye it blocked the game). (2) GTIA register table:
  `PRIOR`, `VDELAY`, `GRACTL` and `HITCLR` read `$0F`, not `$FF` (AHRM 6.1).
  Tests: `TestExitDliIsNotArmedInVerticalBlank` in `antic_timing_probe.c` and
  `TestUnassignedReadsReturnF` in `gtia_consol_probe.c` (they fail without the
  fixes). The existing probe `TestVscrolExitDliDeadlineCycle5` now fixes a
  visible line (100) before arming the DLI. CTest runs with the repository
  root as the working directory and needs the ROMs there; checked with
  temporary links. Baselines already broken in the native build, unrelated:
  `antic_graphics_modes_probe` and `pokey_sio_contract_probe`.

- 2026-11-04: Popeye now advances and is usable: after the title and the
  score table it reaches the game screen with all colors. The blocker was a
  spurious DLI in vblank. `clockAction` (`playfield/renderer_base.js`) arms
  `io.dliCycle` at cycle 6 of each line when `modeLineExitDli` is active and
  the row counter matches VSCROL, but did not check that the line was visible.
  If the last display-list instruction is a region exit with scroll and DLI
  (`$94` after `$B4`), `modeLineExitDli` stayed active, the row counter
  stopped advancing in vblank and kept matching VSCROL: ANTIC generated a DLI
  on every line 249-261. Popeye's DLI handlers are multi-line routines with
  WSYNC (color kernel), so one of them ran for the whole vblank, the VBI
  handler entered its `$21A1` loop (wait for `VCOUNT=$7E`) on line 44 of the
  next frame and the next VBI interrupted it before line 252, forever: the
  main thread (30 s wait at `$A7C1` with exact RTCLOK equality) never ran
  again. Now the decision is only evaluated on lines 8-247. How it was found:
  the interrupted PC pushed by the VBI (always `$21A3`), the stack (VBI frame
  over VBI frame) and an Object.defineProperty access on `io.dliCycle` to see
  who armed it.

- 2026-11-04: Popeye now works (title, "TOP FIVE CHART", scenery with the
  attribute-map colors). Cause: the CPU fetches opcode and operands directly
  from `ctx.ram[pc]`, so the code the game executes from a MEMAC window (it
  configures `$D65E=$99`, `$D65F=$80`: an 8 KB window at `$9000-$AFFF` over
  VRAM, decompresses its character sets and its code there, and jumps to
  `$A516`) was read from the underlying RAM (graphics data) instead of VRAM.
  `installIoHandlers` now builds `ctx.vbxeFetchMask` with the addresses that
  MEMAC routes to VRAM, and `run`/`executeOne` stage the 3 instruction bytes
  in `ctx.ram` (`stageWindowFetch`) and restore them when done
  (`restoreWindowFetch`). With no active window the cost is one comparison
  with `null` per instruction. New test `tests/vbxe_memac_code_fetch.test.js`
  (in `test:vbxe`). How it was reached: Altirra under wine with the debugger
  (watchpoints and `.writemem`) showed that the code at `$A516` existed in its
  RAM; the XEX does not contain it (623 segments with an LZ decompressor at
  `$8E6A`) and jsA8E traces showed the decompression destinations inside the
  MEMAC window.

- 2026-11-04: D600 (blitter demo) now looks like Altirra: ANTIC hires bitmap
  colored by the attribute map (one color per line) with the blitter spheres
  on top. The cause was the polarity of bit 2 of VIDEO_CONTROL. Altirra
  (`WriteControl`: `mbOvTrans = (value & 4) == 0`, and `RenderOverlay` skips
  color 0 only in that branch) makes overlay color 0 transparent with D2 = 0
  (reset value) and opaque with D2 = 1; D3 adds color `$F` only in the
  transparent case. jsA8E had it the other way round, following the AHRM
  prose, and with `VIDEO_CONTROL=3` (the value D600 and Popeye use) the
  zero-filled overlay was painted as opaque black covering the background.
  New helper `overlayTransparency` in `vbxe.js`. Since the inversion is exact,
  the tests keep their intent by inverting D2: `videoControlActive` values in
  `vbxe_device_state.test.js` and the writes to `$D640` in the `.asm` sources
  of `implementation/AHRM Validation` (29 files), with all the `.XEX` files
  regenerated with the project assembler (including the `_V2_`, `12`, etc.
  aliases that the tests declare).
  Performance (measured in the headless Node harness, not in the browser):
  D600 went from 8 to about 27-45 fps. `advanceBlitter` walked the 912 local
  bus positions for every copied byte (it now counts once and subtracts),
  `attributeMapCell` caches the cell per line and drops one closure per call,
  and `blitByteCycles`/the column division avoid `Math.*` on the per-pixel/
  per-byte path (in the `vm` context every global is a slow lookup).
  D600 with BASIC active stays waiting for a line from `E:` (it needs ENTER and
  then a key): same as Altirra with BASIC. Popeye still does not draw the
  playfield (ANTIC's screen memory stays at zero); that is another problem.
  `vbxe_fx124_priority_probe_boot` was already failing in the previous commit
  ("legacy bit 6 must win over PF2"); it is not a regression of this change.

- 2026-11-03: GTIA reads of `$D01B-$D01E` (PRIOR, VDELAY, GRACTL, HITCLR)
  returned `$FF`; AHRM 6.1 and Altirra return `$0F` across `$D015-$D01E`
  (no floating bits). Popeye reads `$D01C` and branches on bit 7. Fixed in
  the `hw.js` table and covered by `tests/gtia_unassigned_reads.test.js` (in
  `test:gtia-spans`). This is not enough for Popeye to draw its screen.
  Compared with Altirra (VBXE FX 1.26 via wine): the XDL is identical,
  effective DMACTL is `$21` in both and the GTIA colors are 0 in both; the
  difference is that in jsA8E ANTIC's screen memory (`$B029-$BFFF`) stays at
  zeros except for the status line, i.e. the game does not get to draw the
  playfield.

- 2026-11-03: with VBXE the emulator ran 2.7 times slower (31 fps versus 83
  without VBXE, measured with Celeste headless). The profile showed two fixed
  costs per scanline/DMA byte: (1) `readExpansionMemoryByte` (called for every
  ANTIC DMA byte) consulted `window.A8EVbxe` 4 to 8 times per call, and in a
  `vm` context every access to the global is slow; now the API is resolved
  once (`getVbxeApi`) and only if VBXE is enabled. (2) `buildLocalBusSchedule`
  walked the 912 local bus positions on every scanline to count the free
  ones; now `reserveLocalSlot` keeps the counter. Result: 77 fps with VBXE
  (83 without it). `test:vbxe` passes. Pending observation (Popeye): its main
  loop at `$21A3` waits for `VCOUNT=$7E` and then toggles DMACTL between 3 and
  0 with cycle timing inside the line; the playfield does not appear, and the
  overlay at `$0-$1E000` stays empty with the blitter not started.

- 2026-11-03: fixed two MEMAC window remapping bugs that lost CPU writes and
  explained why most real VBXE software did not get past the loader. (1)
  `installIoHandlers` routes RAM addresses under an active MEMAC window to
  `ioAccess`, but never returned them to RAM when it was disabled; outside the
  window `ioAccess` treats the address as a write-only register (`sram[addr] =
  v`) and the RAM did not change. Now they are restored to RAM before the
  active windows are reinstalled. (2) `vbxeMapSync` pointed at
  `setupMemoryMap`, which, with the OS ROM off, reloaded `$C000-$FFFF` from
  `sram` (stale while that RAM is visible) when writing
  `MEMAC_CONTROL`/`BANK_SEL`, erasing the image the program had just copied.
  Now it uses `syncVbxeWindows`, which only reinstalls the windows. Phoenix
  copies its image from VRAM to `$0400-$FFFF` with a stub at `$4000` and jumps
  to `$D800`; before, it executed BRK (zeroed RAM), fell into PC=0 and VBXE
  never got activated; now it runs its own code with `VIDEO_CONTROL=1` and XDL
  at `$49000`. `vbxe_memac_window_sync` covers both cases and fails if either
  fix is disabled. Associated diagnosis: the XEXs are mounted as a disk and
  load at normal SIO speed (~5 frames per sector), so the 480-frame gates of
  `vbxe_real_software_scene` only saw the loader; Phoenix needs ~4200 frames,
  Falcon/Crysis ~9000 and Galaga ~19000. Those gates still do not test the
  real software and must wait for the end of loading before accepting a scene.

- 2026-11-03: VBXE cleanup audit: no dead functions or retirable exports were
  found; the blitter, snapshot and MEMAC trace APIs have consumers in the
  runtime or in regressions. The repeated overlay geometry and DMA tables were
  centralized and a redundant scheduler branch that returned exactly the same
  result as the common path was removed.

- 2026-11-03: fixed the overlay DMA start in the local schedule. The table now
  uses Altirra's indices `Narrow=0`, `Normal=1`, `Wide=2` and reserves the
  first slots at `10/18/26`, respectively; before, narrow and wide were
  swapped. `vbxe_blitter_state` covers the three widths. The blitter's
  cycle-by-cycle consumption of the remainder and the physical MEMAC order
  still require an independent differential comparison.

- 2026-11-03: MEMAC accesses now keep a temporal trace with type, AHRM phase,
  CPU cycle, relative scanline cycle and candidate local slot.
  `localBusBudget()` uses that slot when the caller has a timestamp and keeps
  the aggregate path for older accesses. The trace is kept in snapshots and
  `getMemacTrace()` exposes it for differential diagnostics.

- 2026-11-03: `vbxe_browser_backend` compares the four paths against the
  persisted baseline `tests/fixtures/vbxe_browser_golden.json`. It also
  accepts `A8E_VBXE_REFERENCE` to compare an external Altirra JSON with the
  same schema, without introducing dependencies.

- 2026-11-03: the browser gate accepts `a8e_renderer=2d` and forces Canvas2D
  in both main-thread and worker. The VBXE capture now validates four paths
  (WebGL2 main/worker and Canvas2D main/worker), with dimensions, a non-empty
  PNG and an identical hash between the two backends of each pair.

- 2026-11-03: the local scheduler now keeps the MEMAC access type: CPU/ANTIC
  reads reserve phase 1 and CPU writes reserve phase 3. The aggregate counter
  is kept for compatibility with older callers and `vbxe_blitter_state`
  verifies that both types are not mixed.

- 2026-11-03: refined the replay after `COLCLR`: the later span keeps the
  visual composition by `PRIOR`, but the collision mask uses the current
  playfield priority, avoiding reinjecting latched P/M contributors from the
  earlier span. This keeps the historical P5 and GTIA-special oracles while
  leaving the normal replay without `COLCLR` untouched.

- 2026-11-03: completed the raster handling of `COLCLR` during the GTIA
  replay. The line records the horizontal cycle of the clear, discards earlier
  contributions and rebuilds only the later span; on the path validated by
  FX 1.26 the later calculation uses the current playfield priority so as not
  to reintroduce P/M from a pre-clear span. The P5 and GTIA-special probes
  pass again.

- 2026-11-03: cleaned up per scanline the contributor planning of
  `vbxeCollisionPriority` before drawing GTIA. The planning keeps a mark valid
  only for the current line; without this cleanup the collision replay could
  reuse P0/P1 of the same line of the previous frame and break the P5 probe
  when those players were turned off.

- 2026-11-03: added `npm run test:vbxe:browser`, a CDP gate with no external
  dependencies that selects the same application in main-thread and worker,
  waits for a VBXE scene and compares dimensions, size and hash of the PNG
  capture. It restores the original URL and can be made mandatory with
  `A8E_REQUIRE_CDP=1`; without Chromium/CDP available it is an explicit skip.

- 2026-11-03: replaced the purely aggregate VBXE budget with an explicit
  schedule of 912 local slots per scanline. Overlay uses AHRM's even phases,
  MEMAC the odd phases, XDL reserves its 22 slots after the active area and
  the map reload reserves the next 172 cells; the blitter consumes only free
  slots. The aggregate contract is kept and now has a regression on concrete
  positions. The MEMAC access still reaches the model as a counter, so the
  exact CPU-read/write phase on the external bus remains the next refinement.

- 2026-11-03: the VBXE GTIA replay now also recalculates the line's
  `COLDETECT` contribution. Before, it was preserved to avoid double
  counting, which prevented reflecting a mid-line change of `PRIOR`/GTIA mode.
  Now the mask produced by the initial render is removed, rebuilt per span and
  the historical bits of earlier lines are kept. The `COLCLR` cycle is
  documented and covered in the later entry.

- 2026-11-03: fixed the attribute-map buffer reload at the end of a row in a
  repeated XDL entry. The reload no longer depends on decoding a new entry: it
  also happens when the five-bit vertical counter returns to zero, after
  advancing the address by the stride. The regression covers two consecutive
  rows and confirms that the second uses its 43 freshly captured cells.

- 2026-11-03: adjusted the blitter to charge the initial BCB read cycle with a
  constant source (`AND=$00`), which Altirra discounts separately before
  applying the reduced per-output-byte cost. The operation is still
  functional and the state/timing tests remain green.

- 2026-11-03: the VBXE compositor can now rebuild overlay and playfield per
  GTIA span within a single line. `applyGtiaSpans()` redraws each interval with
  the current `PRIOR`/GTIA mode, instead of reapplying only map colors over an
  overlay composed with the first state. The collision is kept from the
  primary render during this replay so as not to count the same pixel twice;
  collision dependent on mid-line changes is still a specific pending
  differential. The P5/multicolor and GTIA-special probes still pass.

- 2026-11-03: also separated the `VIDEO_CONTROL` latch in the temporal model:
  D1-D3 are applied on write and D0 is consumed at VSync, per AHRM 12.4. The
  register regression was updated and remains green.

- 2026-11-03: the attribute map now explicitly captures the 43 four-byte cells
  during row load and every pixel of that line consumes the buffer, not the
  live VRAM. This aligns the model with AHRM/Altirra's line buffer and keeps a
  MEMAC write during display from retroactively modifying the line. The buffer
  is part of snapshots and the state regression covers the immutability of the
  capture.

- 2026-11-03: fixed four edges of the XDL path per AHRM 12.4 and Altirra 4.40's
  `vbxe.cpp`. `VIDEO_CONTROL` applies EXT and the two transparency bits
  immediately, leaving the XDL bit for VSync; the decoder disables the invalid
  mode combination `c0&3==3`; a new text entry starts at `OvScrollY`; and
  VSync/warm reset also keep `characterBase` and the address/stride latches.
  The `vbxe_device_state` and `vbxe_register_snapshot` regressions pass. The
  full raster compositor, the attribute map's temporary buffer and per-phase
  DMA arbitration remained pending; the buffer and the first raster replay
  were completed in the later entries, but per-phase arbitration is still
  open.

- 2026-11-03: completed the first visual gate of the real FX1.26 corpus in
  `vbxe_real_software_scene.test.js`, integrated into `test:vbxe:full`. With
  `turbo=true`, `sioTurbo=true`, 130XE-128K, NTSC and active rendering, the
  gate checks the corpus at checkpoints up to 480 frames. Popeye, DACTest,
  Textmode Test mode 4, Crysis and Falcon produce a non-black frame different
  from any reset; Galaga, Celeste, D600 and Phoenix keep only their boot gates
  for now because the headless capture is black or matches the reset set. The
  initial 120 frames were insufficient for Popeye. The visual gate complements
  the minimal XEX's RAM marker, but is not yet a program-specific mark or a
  golden comparison against Altirra.

- 2026-11-03: hardened the corpus visual gate. The test no longer accepts any
  different digest: it compares checkpoints of 120, 240, 360 and 480 frames
  against all reset digests and requires at least one non-black frame. This
  keeps a temporal variant of the boot screen or a transient black state
  (observed in Galaga) from being interpreted as a valid scene; five cases
  pass and four remain explicitly boot-only.

- 2026-11-03: the visual corpus configuration was separated from the
  synthetic RAMBO test. The real programs use 130XE-128K/NTSC, consistent with
  the documented Altirra validation; the minimal marker keeps RAMBO explicit.
  Galaga is not forced to pass a black capture: it is flagged as pending an
  observable marker or scene in headless.

- 2026-11-03: `npm run test:vbxe:full` went green after integrating the
  hardened visual gate. The output records five visually observable scenes
  and four explicit boot-only cases; pixel-by-pixel equivalence with Altirra
  is not claimed.

- 2026-11-03: the real gate now adds a SHA-256 fingerprint of the 64 KiB of
  memory at each checkpoint. Cases without a visual scene are not relaxed to
  `cycleCounter`: they must change the RAM with respect to the reset set and
  record that marker as evidence of XEX execution. This still does not
  replace a scene-specific marker or an Altirra comparison.

- 2026-11-03: enabled the worker path for VBXE profiles as well. The UI no
  longer forces the main runtime when VBXE is active: the worker receives the
  FX configuration and composes `vbxeRgb`/hires inside its `OffscreenCanvas`.
  A dedicated browser regression comparing worker, main-thread fallback and
  Canvas 2D is still pending; headless functional validation does not cover
  `OffscreenCanvas`.

- 2026-11-03: manual CDP smoke test confirmed both backends with VBXE
  FX1.26 active: worker `true`/WebGL2 and main-thread fallback `false`/WebGL2
  started with a non-black 336x240 PNG capture (`40795` non-black pixels in
  both cases). Automated content equivalence and Canvas 2D remain pending;
  this result only validates that the worker path does not stay black or block
  automation.

- 2026-11-03: the stage 7 check was repeated on the real Chromium instance
  (`localhost:8090/jsA8E`, CDP `9222`) because the headless harness captured a
  common initial screen. `A8EAutomation.runXexFromUrl()` loaded the FX1.26
  corpus and advanced 120 frames with `rendererBackend=webgl2` and
  `worker=false`; the observed PCs left the OS's initial loop. The Chromium
  capture produced a non-black frame. In Textmode Test, the menu digest was
  `8288d135...` and the one with mode 4 selected `8c5f3da9...`, so the visual
  change is observable in the browser. This validates the browser capture
  protocol, not yet equivalence with Altirra or a headless baseline; the
  external comparison is still pending.

- 2026-11-03: closed the first part of the XEX harness hardening. The
  headless run now inherits a configuration comparable to Chromium (explicit
  `sioTurbo` and RAMBO in the diagnostic), and
  `vbxe_xex_scene_marker.test.js` assembles a minimal XEX, boots it and waits
  for the RAM markers `$0600=$A5`/`$0601=$5A`; the test passes and is in
  `test:vbxe:full`. A breakpoint during boot proved unreliable in headless, so
  the gate uses observable memory. The real corpus gates still need their own
  scene markers before accepting visual baselines.

- 2026-11-03: an attempt was made to advance stage 7 with a visual baseline of
  Popeye, Galaga, DACTest, Textmode Test, Crysis, Celeste, D600, Falcon and
  Phoenix. The experiment is not valid evidence: the headless captures
  returned the same frame and the VBXE VRAM stayed at zero; the existing gates
  use `runXex({ awaitEntry: false })` and only check that `cycleCounter`
  advances. A variant that waited for the XEX entry did not reach the entry
  point within the harness limit. The invalid baseline was withdrawn. Before
  comparing images with Altirra the harness must be made to prove real
  execution (XEX entry or scene marker) and capture a non-empty VRAM/frame;
  stage 7 stays in progress and this conclusion avoids declaring visual
  equivalence from a common initial screen.

- 2026-11-03: advanced step 6 of blitter timing. New XDL entries now reserve
  the 22 fixed local update cycles defined by AHRM 12.4, while repeated lines
  do not pay an additional update. The budget regressions were adjusted and
  the continuous/restart pair is still green; the scheduler stays aggregated
  per scanline because there is no horizontal marker yet that would justify
  per-phase arbitration.

- 2026-11-03: completed step 5 of registers, MEMAC, reset and snapshots.
  `vbxe_register_snapshot` checks both banks `$D640`/`$D740`, read-only/
  write-only readback, bit masks, VSync, MEMAC A and the configuration latch.
  It also restores an active XDL and a blitter during the load of its BCB;
  `restoreState()` now sanitizes the impossible bits of that latch in old or
  edited snapshots. Warm/cold reset coverage was already in
  `vbxe_device_state`; the full VBXE suite remains green.

- 2026-11-02: closed the first deterministic VBXE priority and collision
  matrix. The `vbxe_priority_collision_matrix` regression pins the PF0--PF3/P5
  and P0--P3 groups in normal GTIA/9/11, the `$7F` mask measured for visible
  inputs in GTIA 10, and the legacy/full priority tables of FX 1.20, 1.24,
  1.26 and 1.26r. The XEX coverage of `COLMASK`/`COLDETECT`, P0+P1 and P5 is
  also kept. Still pending: widening the differentials of real scenes and the
  transparency/map combinations not yet measured.

- 2026-11-02: implemented the first visible span replay of attribute maps.
  When a line closes, the GTIA write queue rebuilds the map per interval using
  the initial registers and the values of `COLPF3` and `PRIOR`/GTIA mode in
  effect at each event; ANTIC hires PF3 is verified on the legacy and hires
  outputs. The path keeps the overlay pixels and refreshes only the necessary
  map regions. Coverage is still partial: VBXE map register changes and the
  full crossing with hires/text overlay and per-phase timing remain pending.
  `vbxe_device_state` and `npm run test:vbxe:full` pass.

- 2026-11-02: completed the VBXE attribute-map geometry slice. The map now
  shares `OvMisc`'s narrow/normal/wide start and width in both the legacy
  `vbxeRgb` plane and the hires presentation plane, even when the overlay is
  disabled. Added unit coverage for all three widths and updated the normal
  and narrow AHRM boot oracles. Full temporal cross-product replay and
  phase-exact timing remain separate pending work.

- 2026-11-02: fixed VBXE XDL restart state. `verticalSync()` now resets the
  per-frame visual latches while preserving the running overlay and
  attribute-map address/stride latches, as required by AHRM 12.4. Added a
  multi-frame regression proving that the counters continue from the previous
  line, that `AtMapOn` can reuse the carried map state, and that visual
  defaults still reset. The XDL start address remains restarted from
  `XDL_ADR0-2` each frame.

- 2026-11-02: audited the `VBXE` branch against AHRM 12.4, including the local
  uncommitted changes. `npm run test:vbxe:full` and `npm run test:automation`
  pass; two general tests are skipped for lack of ROMs and `npm run lint`
  cannot run because the environment exposes ESLint 6.4 without a compatible
  configuration. The conclusion is practical compatibility, but not complete
  AHRM compliance: in the audited state, `verticalSync()` reset XDL/map
  addresses that AHRM says to keep; that first point has already been fixed
  and regressed on the same branch. The compositor's fixed normal geometry for
  the attribute map was also fixed after that audit. Still open are the XDL
  budget that reserves decoded bytes instead of the 22 AHRM cycles and the
  aggregate local arbitration per scanline. The MEMAC-B polarity uses
  D7=CPU/D6=ANTIC for compatibility with Altirra and software, even though
  the AHRM table labels them the other way round; the MAPPAR scroll remains an
  AHRM/Altirra discrepancy without a conclusive physical differential. These
  conclusions and priorities are detailed in `VBXE.md` and `VBXE_ROADMAP.md`;
  no code was modified during the audit.

- 2026-11-02: documented the VBXE completion plan in `VBXE_ROADMAP.md` with
  separate definitions for practical compatibility, raster fidelity, and
  product integration. Added architecture, scanline, and dependency diagrams;
  stage exit criteria; regression/differential gates; and links from the root,
  native, browser, core, renderer, and worker README/documentation. Corrected
  the documentation boundary so JavaScript FX 1.26r RAMBO is recorded as
  implemented, while worker RGB transport and native VBXE remain optional
  integration work.

- 2026-11-02: began the missing scanline-span path from Altirra's
  `AddRegisterChange`/`RenderScanline` model. In addition to the established
  P/M geometry queue, each line now snapshots and timestamps all four player,
  four playfield/background colour registers and `PRIOR`; I/O records their
  latched values (including the GTIA forced-zero LSB). This is the required
  temporal source for VBXE's later span compositor; rendering those spans is
  still pending, so this entry does not claim visible mid-line fidelity.

- 2026-11-02: wired the first visible consumer of that timeline. For XDL
  lines using the default playfield palette (no attribute map), jsA8E retains
  the decoded XDL line until the scanline closes and reapplies the palette in
  GTIA event spans, selecting PF0--PF3/background from the recorded register
  state. At that point overlay and attribute-map span replay remained open;
  the later map/PF3 slice is documented above. `test:gtia-spans` runs the
  queue's timestamp/order regression independently of the longer VBXE suite.

- 2026-11-02: added the FX 1.26 RAMBO-capable profile (`fx1.26r`). It returns
  `MINOR_REVISION=$A6` and maps the PORTB-D4-enabled `$4000-$7FFF` CPU/ANTIC
  window directly to local `$40000-$7FFFF`, using inverted D6/D5/D3/D2 bank
  bits as documented by AHRM. It is selectable at either VBXE page in the UI
  and proxy configuration; the state regression pins the revision and both
  end-bank addresses, while `vbxe_rambo_bus` verifies actual CPU writes,
  ANTIC reads, D4 disable, and bank isolation through the installed handlers.

- 2026-11-02: aligned `BLITTER_START=0` with Altirra's event handling. A
  stop now cancels a completion IRQ still queued for its in-line phase without
  acknowledging one that already fired; `IRQ_CONTROL` remains the explicit
  acknowledge path. The blitter-state test covers this stop-before-event
  boundary.

- 2026-11-02: updated the PF3 attribute-map boot oracle for the already
  Altirra-aligned CR/CG/CB expansion: a stored `$FE` has D7 set and therefore
  reads as `$FF` after the hardware's D7→D0 expansion. Both PF3-green and
  PF2-red expected components now express that observable value. The same
  stale `$FE` expectations in normal/lores reverse and FX1.24 priority gates
  were updated to `$FF`.

- 2026-11-02: implemented Altirra's VBXE configuration-pin latch at every
  selected `$DxC0-$DxFF` address. It stores only DATA0/DCLK/`/CONFIG` (D0-D2),
  is snapshot-safe, survives warm reset, and clears on a power cycle. The
  device-state regression covers both register pages and reset boundaries.
  The CPU I/O installer now maps that complete latch range as well as the
  normal `$Dx40-$Dx5F` register bank.

- 2026-11-02: matched two remaining XDL timing latches to Altirra 4.40:
  `OVSCRL` now retains only its documented three text-scroll bits, and the
  scanline blitter budget now reserves the FX's distinct narrow/normal/wide
  overlay DMA counts (lores 128/160/168, standard/hires 256/320/336, text
  195/243/255). Focused XDL and blitter-state tests cover high-bit scroll
  masking, width-code-three's narrow alias, and both non-normal reservations.

- 2026-11-02: began the AHRM/Altirra fidelity pass by correcting the XDL
  `OvMisc` latch decode. jsA8E now preserves the narrow alias, ANTIC
  playfield-palette bits 7-6, and overlay-palette bits 5-4; it had read the
  latter from bits 3-2. `vbxe_device_state.test.js` now asserts all three
  fields and the actual descriptor byte count. AHRM's “minus one” wording for
  MAPPAR scroll conflicts with Altirra's literal latch; that remains pending
  an external visual differential rather than being changed speculatively.

- 2026-11-02: aligned three reset-visible details with Altirra: palette writes
  now expand the seven hardware component bits by copying D7 to D0,
  `WarmReset` preserves the P0--P3 priority latches while clearing the blit
  collision code, and every linked blitter control block begins with a fresh
  collision code. Device/blitter state tests cover those latches and the
  linked-list boundary.

- 2026-11-02: replaced the attribute-map's synthetic two-dimensional index
  with Altirra's live map-row state: literal five-bit scroll counters,
  overscroll wrap, 1--32 pixel cells, and address advancement only when the
  row counter reaches cell height. `localBusBudget` now reloads from that
  same row boundary. The existing Reverse-character regression exposed the
  corrected 7-to-8-bit palette expansion; its expected RGB values were
  updated and the attribute-map boot gates remain green.

- 2026-11-02: moved XDL overlay placement onto Altirra's real field bounds:
  standard and lores now occupy narrow `$40-$BF`, normal `$30-$CF`, or wide
  `$2C-$D3` in the ANTIC line buffer; hires/text use the corresponding
  centered 512/640/672-pixel native signals. Every mode transition clears
  both presentation planes, preventing stale standard pixels from leaking
  under hires/text. Device-state coverage now pins all three widths.

- 2026-11-02: made VBXE soft reset match Altirra `WarmReset`: it now disables
  MEMAC while retaining its bank/base latches, preserves XDL addresses and
  `COLDETECT`, and cancels only active XDL processing. A power cycle remains
  the full clear path. Device-state coverage now distinguishes both resets.

- 2026-11-02: implemented the `OvMisc` default playfield-palette path for
  XDL lines without an attribute map. It recolors visible GTIA
  playfield/background samples in the selected VBXE palette while preserving
  player/missile winners; focused device state coverage checks both cases.

- 2026-11-02: corrected MEMAC-B access enables against Altirra 4.40's
  `UpdateMemoryMaps`: bit 7 grants CPU read/write and bit 6 grants ANTIC DMA,
  not the inverse. The previously inverted mapping made the supplied DACTest
  fall back from `$D640` to `$D740` after its CPU-only `$80` probe. Focused
  device-state assertions now cover each one-bit form. A fresh Chrome run at
  128K/FX 1.26 keeps DACTest's probe at `$D640` and reaches its red VBXE field
  instead of `NO VBXE or improper core`.

- 2026-11-02: completed the functional-compatibility validation pass. The
  deterministic register/XDL/map/MEMAC/blitter suite is green, as are the
  supplied FX 1.26 Popeye, Galaga, DACTest, Textmode (all four selections),
  Crysis, Celeste, D600, Falcon, and Phoenix execution gates. `VBXE.md` now
  distinguishes that usable compatibility milestone from the still-open
  phase-exact and optional hardware-fidelity work.

- 2026-11-02: parameterized the non-reversed PF3 attribute-map diagnostic
  with its GTIA mode and raw Graphics-8 source byte, then added reproducible
  FX 1.26 wrappers for GTIA 9, 10, and 11. The attribute-map assembler gate
  now rebuilds and byte-compares all three. Altirra's source confirms that
  PF2-to-PF3 bitmap promotion belongs to its ordinary GTIA renderer; the new
  diagnostic is retained for an externally visible special-mode palette/map
  differential rather than broadening jsA8E from an ambiguous black field.

- 2026-11-02: the phase pair now repeats one measurement per video frame: its
  first DLI paints the visible palette entry blue, the blitter IRQ paints it
  red, and the next frame restarts the same transfer. Fresh Altirra FX 1.26
  captures of both continuous and restarted map forms show the same stable
  red/blue/red scanline geometry. The one forced buffered-map reload has no
  observable whole-line displacement, matching jsA8E's aggregate scheduler;
  no timing change is warranted. A separate horizontal marker would still be
  required to claim sub-line arbitration fidelity.

- 2026-11-02: the corrected phase-pair palette IRQ is now externally visible
  in Altirra: both stable captures are red, proving completion delivery and
  the palette target. A static capture necessarily observes the later frames,
  not the completion frame's in-line edge, because the one-shot blit leaves
  that palette red. The next timing diagnostic must restart deterministically
  once per frame; no jsA8E scheduler change follows from the static result.

- 2026-11-02: aligned `XDLC_END` with Altirra's XDL engine: an entry marked
  `END` now remains active through its complete repeat count, instead of
  disappearing immediately after it is decoded. `vbxe_device_state.test.js`
  covers a terminating standard-overlay entry with one additional repeated
  line. This fixes a real XDL rendering/lifetime gap; the phase-pair assembly
  and boot regressions remain green.

- 2026-11-02: rebuilt the attribute-map phase pair against Altirra 4.40's
  local `vbxe.cpp` decoder. The diagnostic now writes its XDL to local
  `$02000`, supplies its opaque standard source at `$28000`, and accounts for
  `CB` auto-incrementing `CSEL`. Its final map-off entry now repeats beyond
  the visible field, isolating phase from an XDL vertical-end boundary. Both
  wrapper binaries reassemble and their device-state/boot checks pass. The
  palette marker still needs an independently observable completion edge;
  this is not evidence for changing jsA8E scheduling.

- 2026-11-02: added the FX 1.26 sustained-execution gate for the additional
  supplied VBXE XEX corpus: `celeste1.3.xex`, `demoD600.xex`, `falcon1.xex`,
  and `phoenix-vbxe.xex`. Each launches and executes for 400,000 cycles in
  jsA8E with VBXE enabled. The gate is included in `test:vbxe:full`; it is a
  compatibility smoke test, not an Altirra image-equivalence claim.

- 2026-11-02: fresh Altirra FX 1.26 captures of both current phase-pair XEXs
  are stable: each has a red outer field and a blue central XDL band (the
  restarted-map form has a small artifact at the band's upper edge). This
  confirms the blitter completion path is reached, but the two presentation
  planes still hide the intended within-line edge and do not distinguish the
  restarted map fetch. No scheduler change follows from these captures.

- 2026-11-02: corrected the phase-pair capture documentation to name the
  actual Altirra FX 1.26 register page used by this setup, `$D640` (with
  `alt_page=0`), rather than the stale `$D600` page.

- 2026-11-02: `crysis1.xex` reaches its 320x480i presentation screen in
  Altirra 4.40 with VBXE FX 1.26. `vbxe_crysis_boot.test.js` records the
  corresponding jsA8E sustained-execution launch gate and is part of
  `test:vbxe:full`. It deliberately does not assert image equivalence.

- 2026-11-02: the supplied `Galaga_VBXE_1.01.xex` starts in Altirra 4.40
  under the same NTSC, 128K, VBXE FX 1.26 configuration and reaches its title
  screen. `vbxe_galaga_boot.test.js` is the corresponding jsA8E launch gate,
  included in `test:vbxe:full`; like Popeye, it asserts executable sustained
  boot with VBXE active, not frame-image equivalence. The subsequently
  supplied `DACTest (2009, KMK).xex` reaches its self-test menu in Altirra
  and passes the same sustained-execution gate in jsA8E. `Textmode Test
  (2009, KMK).xex` reaches its 80x24/25/30/32 mode-selection screen in
  Altirra. Its jsA8E FX 1.26 regression sends each of the four menu keys,
  verifies delivery through POKEY, and confirms that the rendered result
  changes from the menu. This covers the interactive mode transition, though
  it is still not a pixel-for-pixel Altirra comparison.

- 2026-11-02: began real-software validation with the user-supplied
  `build/Altirra-4.40-bin/popeye.xex`. Altirra 4.40 starts its VBXE FX1.26
  detection/instructions screen successfully. `vbxe_popeye_boot.test.js`
  now boots that exact XEX under jsA8E FX1.26 and asserts sustained execution
  with VBXE still enabled; it is included in `test:vbxe:full`. This is an
  entry/initialisation compatibility gate, not a claim of automated gameplay
  or image equivalence.

- 2026-11-01: Altirra 4.40 under Wine successfully ran the known
  `VBXE_BLITTER_IRQ_TEST.XEX` and showed its expected black/blue IRQ stripes,
  validating this local external environment and its FX 1.26 setup. The phase
  continuous capture nevertheless stayed blue, so the phase probe cannot yet
  establish timing. It now records `POLLSEEN` at `$0084`: the DLI shows green
  when polling observed completion but `IRQSEEN` (`$0083`) did not, separating
  a missing IRQ from an unfinished blit before the pair is interpreted again.
  A second `STARTED` marker at `$0085` now makes an active blit yellow and an
  unreached start blue. Altirra then established that the old VCOUNT polling
  never reached its start write; the shared probe now arms the blit from its
  first DLI instead. This gives both wrappers the same visible scanline phase
  and removes the invalid VCOUNT-dependent pre-start state. Its first external
  capture was black, however, so it is likewise invalid: do not tune jsA8E
  from it. The remaining immediate task is to debug this diagnostic-only DLI
  start path until it yields its self-checking red field in Altirra. The next
  variant lets the DLI release only a RAM flag and has the main loop write
  `BLITTER_START`, preserving shared DLI phase without issuing that device
  write from NMI context. Its first external run still remained in the blue
  pre-DLI state. Enabling the standard OS VBI (`NMIEN=$C0`) instead yielded a
  black display, because the OS recovered its own video state; neither result
  is valid timing evidence. A WSYNC-only replacement also failed the existing
  headless IRQ contract, so it was rejected. The reproducible DLI version is
  restored and all timing conclusions remain deferred until its Altirra RAM
  markers can be observed directly. Altirra's automated debugger breakpoint
  at `READY` now reads `$0082-$0085` as `$09,$01,$01,$01`, validating the
  start, completion poll, and completion IRQ. The apparent all-blue field was
  a visual-probe error: the opaque XDL uses palette 1 entry `$FF`, above the
  GTIA `COLPF1` marker. The diagnostic now changes that VBXE palette entry
  directly; this is required before the pair can expose a phase edge. The
  first palette variant wrote colors on every DLI and made the headless boot
  harness fail to reach its stable loop, so it was simplified: the DLI only
  releases the start and the completion IRQ performs the sole blue-to-red
  palette write, which remains visible for later lines. The subsequent Altirra
  marker read remains valid (`$5B,$01,$01,$01`), but its stopped-frame output
  mixes presentation planes and does not yet expose a clean red edge. Treat
  the horizontal phase capture as pending; do not retune jsA8E from its image.
  The map entry itself has no overlay payload and exposes palette 0/color 0,
  so the probe updates it together with opaque standard-XDL palette-1/color
  `$FF`. Both captures now identify that visible plane. The final phase form
  leaves P0:$00 selected and has each DLI repaint only its three blue RGB
  components; the IRQ paints that same entry red for the remainder of its
  completion scanline, then disables DLI so that edge and its red lower field
  remain stable for capture. This restores a true horizontal edge without
  heavy DLI palette-selection traffic. The DLI disable now precedes the red
  write: an NMI can interrupt a maskable IRQ, so the former order let a pending
  DLI restore blue between the red write and `NMIEN=0`.
  It remains diagnostic work; no jsA8E timing change is justified until a
  red-field capture is obtained.

- 2026-11-01: began roadmap milestone 2. The current continuous/restarted
  phase wrappers reassemble and pass their deterministic boot check. The local
  `build/Altirra-4.40-src` tree is source-only, so `VBXE.md` now records the
  exact external capture protocol: FX 1.26 at `$D600`, stable-loop RAM checks
  (`$0082/$0083`), validity criteria, and comparison of the in-line edge rather
  than RGB shade or raw two-line `VCOUNT`. Fresh Altirra captures remain the
  required external evidence.

- 2026-11-01: completed roadmap milestone 1's first reconciliation pass.
  `VBXE.md` now has a JavaScript support matrix tied to the actual regression
  families; `test:vbxe:full` now runs that complete matrix while `test:vbxe`
  remains its faster historical subset. The pass also removes a duplicated
  device-state heading and records
  the current Altirra-aligned scheduler: actual XDL byte count, aggregate
  overlay reservations of 160/320/243 local slots, 172-slot map-row reloads,
  and delayed in-line completion IRQ delivery. It also distinguishes covered
  text/attribute-map behavior from the remaining non-reversed GTIA-special
  PF3-mask and fine-arbitration work.

- 2026-11-01: recorded the accepted functional-VBXE roadmap in
  `implementation/VBXE.md`. Its ordered exit gates are: consolidate the
  documented/tested contract; close blitter timing with the corrected Altirra
  phase pair; complete XDL/attribute-map combinations; audit MEMAC, registers,
  and IRQ behavior; then validate a curated real-software suite. The immediate
  blocking evidence is a fresh Altirra capture of the deterministic continuous
  and restarted attribute-map phase diagnostics.

- 2026-11-01: compared jsA8E's VBXE scanline scheduler with the local
  Altirra 4.40 source and adapted the observable scheduling model without
  importing its implementation. A decoded XDL entry now reserves precisely
  the number of local-VRAM bytes it consumed (rather than a fixed 22); normal
  overlay lines use the reference model's aggregate reservations (LR 160,
  SR/HR 320, text 243); and a machine-driven blitter completion is scheduled
  at `line end - remaining local slots / 8` before it raises its level IRQ.
  Focused device, blitter, boot IRQ, and phase-pair regressions cover the
  changed behavior.

- 2026-11-01: the corrected Altirra phase captures still did not expose a
  usable within-line edge: one showed only a full orange scanline and the
  other only the blue field. The shared probe now latches completion in RAM;
  its DLI paints blue before that latch and red on every subsequent line,
  while the IRQ still turns the remainder of its own line red. This preserves
  the intended horizontal marker and adds an unambiguous persistent red lower
  field. The boot regression asserts the latch as well as the VRAM setup.

- 2026-11-01: a boot regression with VRAM prefilled to `$A5` found two more
  phase-probe construction errors. Its 21-byte blitter block still encoded
  destination `$00000` because the `$01` had been placed in the destination
  X-step field rather than destination address byte 2, so the transfer erased
  the displayed source. The XDL also occupied local `$01000`, inside that
  source. The shared probe now stores the XDL at `$02000` and encodes its
  512-by-64 destination as `$10000`; both wrappers must be rebuilt before an
  Altirra comparison. The boot regression poisons VRAM before launch and
  verifies the complete visible source and all 4 KiB of map storage.

- 2026-11-01: the phase-pair initialisation fix was incomplete. Although it
  cleared the first 256 bytes at local `$22000`, an 8-pixel-high map spans 24
  rows with `$00A0` stride, so later 172-byte buffered-row fetches reached
  uninitialised VRAM and the continuous diagnostic still varied between
  Altirra launches. The shared setup now clears the full 4 KiB reachable map
  range before XDL is enabled. The paired boot regression poisons local VRAM
  before launch and asserts that both wrappers clear the complete display and
  map ranges. Rebuild both wrappers; their new captures must be stable before
  interpreting the blue/red phase edge.

- 2026-11-01: the first external phase capture showed that
  `VBXE_BLITTER_ATTRMAP_PHASE_CONTINUOUS_TEST.XEX` was not a valid probe: it
  left both the Graphics-8 source and the `$22000` attribute-map row
  uninitialised, so Altirra legitimately displayed prior local-VRAM contents
  (black, coloured blocks, or blue stripes) between launches. The shared
  probe now fills the display source with `$FF` and the sole map row with
  zero through the appropriate MEMAC-B bank before enabling XDL. That capture
  then exposed a second diagnostic-only error: its blit wrote 32 KiB to local
  `$00000`, overwriting the displayed source while it measured it. It now
  writes to local `$10000`, outside both the display and map. All prior phase
  captures are discarded; rebuild both wrappers before comparing them.

- 2026-10-31: added the paired `VBXE_BLITTER_ATTRMAP_PHASE_*_TEST.XEX`
  diagnostics for the sub-line attribute-map question. A DLI restores a blue
  Graphics-8 field on every scanline; the blitter-complete IRQ changes only
  the remainder of its completion scanline to red. The continuous and
  four-line-restarted map cases therefore expose their relative completion
  phase as a horizontal red edge, rather than collapsing it into `VCOUNT`'s
  two-scanline buckets. The pair is assembled reproducibly with the existing
  include-aware assembler path and awaits its Altirra differential capture.

- 2026-10-31: added `VBXE_BLITTER_ATTRMAP_RESTART_TIMING_TEST.XEX` to
  isolate an early attribute-map restart. Its second `AtMapOn`/`MAPADR`
  begins four scanlines after the first, forcing one extra 172-byte buffered
  fetch before the usual eight-line rollover. jsA8E records raw `VCOUNT`
  `$27` (one count after its `$26` continuous-map short probe). Altirra 4.40
  records `$24`, the same raw two-scanline `VCOUNT` bucket as its continuous
  probe, so this observation cannot confirm or reject the reload's sub-line
  cost. Its source identity and headless completion contract pass; a
  horizontal-phase diagnostic is required for a decisive external result.

- 2026-10-31: refined the attribute-map DMA contract from AHRM 12.4 without
  changing the measured global throughput. `AtMapOn` and an XDL map-address
  update now reset the map-row phase and force the 172-byte line-buffer
  reservation immediately, even when the prior row had not reached its cell
  height rollover. A focused blitter-budget regression covers this restart
  case. The remaining one-`VCOUNT` short-probe delta is deliberately not
  hidden by an unsubstantiated global timing adjustment.

- 2026-10-31: Altirra 4.40 FX 1.24 readback established
  `CORE_REVISION=$10`, `MINOR_REVISION=$24` at `$D640`, contrary to the
  older AHRM prose that names `$11` for the latest FX core. jsA8E now returns
  `$10` for each selectable full-FX revision and its profile regressions
  assert it. `VBXE_FX124_PRIORITY_PROBE.XEX` then matched Altirra's three
  priority bands: legacy `$00` over a background is visible, `$00` is hidden
  by PF2, and bit 6 restores the overlay over PF2. Its blue/purple RGB shade
  varies with the emulator's NTSC palette, while the indexed priority result
  and geometry agree. The first priority visual was intentionally retired:
  its inherited OS display list left uncontrolled PF2 content beneath the
  overlay, so it could not isolate the documented background case.

- 2026-10-31: Altirra 4.40 FX 1.20 returned `CORE_REVISION=$10`,
  `MINOR_REVISION=$20` and matched the same green / PF2-hidden / bit-6-green
  priority field as FX 1.24. FX 1.20 and FX 1.24 are therefore externally
  validated for the shared legacy priority profile; their remaining
  differences, if any, are outside this documented table-109 scope.

- 2026-10-31: Altirra 4.40 FX 1.24 returned `$03,$7F,$03,$40,$7F,$40`
  from `VBXE_XDL_GTIA_SPECIAL_COLLISION_PROBE.XEX`, exactly the established
  FX 1.26 result. The P0+P1 multicolor and P5 collision contributors in
  GTIA 9/10/11 therefore use the shared current collision path for FX 1.24;
  no revision-only branch is warranted for this measured matrix.

- 2026-10-31: Altirra 4.40 FX 1.20 returned the same
  `$03,$7F,$03,$40,$7F,$40` GTIA-special collision matrix. The currently
  measured P0+P1/P5 contributor behavior is now externally shared by FX
  1.20, 1.24, and 1.26.

- 2026-10-31: added selectable FX 1.20, 1.24, and 1.26 JavaScript profiles
  at both VBXE register pages. The legacy FX 1.20/1.24 priority table follows
  AHRM 12.4 table 109: a zero mask remains visible over background, bit 6
  selects PF2, and bit 7 selects PF3/P5; FX 1.26 keeps its full layer map.
  Device-state regressions cover aliases, revision reads, and the legacy
  priority cases. The remaining Altirra pass is a direct visual differential.

- 2026-10-31: extended the AHRM 12.4 non-reversed attribute-map PF3-mask
  rule from Graphics 8 (mode F) to all ANTIC hires sources (modes 2, 3, F).
  A focused mode-2 state regression verifies that a set byte-0 mask bit
  replaces PF2 with GTIA PF3 and a clear bit retains PF2. GTIA-special
  combinations remain outside this AHRM-defined ordinary-mode rule.

- 2026-10-31: the VBlank-synchronised GTIA-special collision differential
  returned `$03,$7F,$03,$40,$7F,$40` in Altirra. GTIA 9 and 11 retain the
  ordinary visible contributor result, while GTIA 10 exposes its final
  special-color input group to VBXE's `COLDETECT` as `$7F`. jsA8E applies that
  GTIA-10 collision mapping only; ordinary GTIA collision registers and RGB
  composition are unchanged. The earlier pre-VBlank-clear `$77` observation
  was discarded as a mixed-field sample.

- 2026-10-31: added `VBXE_XDL_GTIA_SPECIAL_COLLISION_PROBE.XEX` for the
  remaining collision case: P0+P1 multicolor and P5 under GTIA 9, 10, and 11.
  It records six independently frame-synchronised `COLDETECT` samples at
  `$0082-$0087`. Its source/XEX and ROM-backed regression are in `test:vbxe`;
  the subsequent VBlank-synchronised Altirra result and implementation rule
  are recorded above.

- 2026-10-31: Altirra 4.40 FX 1.26 returned `$43,$40` from
  `VBXE_XDL_P5_MULTICOLOR_PROBE.XEX`, exactly matching jsA8E's separate
  P0+P1-multicolor and P5 samples. This externally validates the final-layer
  contributor handling for those basic PRIOR bit-5 and bit-4 cases; only
  profile combinations remain in this area.

- 2026-10-31: added `VBXE_XDL_P5_MULTICOLOR_PROBE.XEX` to isolate the two
  outstanding FX 1.26 overlay-collision contributors. It stores the P0+P1
  multicolor result and the P5 (missile-as-PF3) result at `$0082-$0083` after
  separate whole-frame samples. jsA8E produces `$43,$40`; the source/XEX
  identity and ROM-backed assertion are in `test:vbxe`. The external Altirra
  comparison remains deliberately pending.

- 2026-10-31: added `VBXE_XDL_TEXT_COLLISION_PROBE.XEX` to identify which
  text fetch byte (`character`, `attribute`, or `glyph`) the hardware applies
  to `COLMASK`. It records the three `COLDETECT` results at `$0082-$0084`.
  Altirra 4.40 FX 1.26 returned `$00,$40,$00`: the attribute byte is the
  source. jsA8E now passes that byte through its existing COLMASK compositor;
  direct and ROM-backed regressions cover the observed rule.

- 2026-10-31: added `VBXE_BLITTER_SHORT_ATTRMAP_TIMING_TEST.XEX`, a no-wrap
  512-by-64 counterpart to the visual attribute-map timing probe. It leaves
  the map active and records the completion IRQ's raw `VCOUNT` at `$0082`.
  Its source/XEX identity and headless completion/acknowledgement/non-wrap
  contract are included in `test:vbxe`. Altirra 4.40 FX 1.26 recorded `$24`
  versus jsA8E's `$26`; after the one-count base sampling offset, the
  attribute-map difference is one remaining `VCOUNT` tick, so the documented
  172-byte buffered-row reservation is retained rather than overfit.

- 2026-10-31: the no-wrap overlay probe measured `$4C` in jsA8E versus `$2F`
  in Altirra. The prior scheduler had charged standard-overlay DMA across all
  912 local slots and charged a 22-cycle XDL decode on every repeated line.
  AHRM 12.4 confines overlay cycles to the active interval and only decodes a
  new XDL entry; standard/hires, lores, and text reservations are now 216,
  108, and 162 cycles. The local-bus regression covers a decoded entry. With
  that correction the same probe records `$30` in jsA8E, within one sample of
  Altirra's already observed `$2F`.

- 2026-10-31: the no-wrap baseline probe recorded raw completion `VCOUNT`
  `$25` in jsA8E and `$24` in Altirra 4.40 FX 1.26. That one-line sampling
  phase difference validates the base blit duration without changing the
  scheduler. Added the equivalent active transparent-standard-overlay/XDL
  probe, `VBXE_BLITTER_SHORT_OVERLAY_TIMING_TEST.XEX`, for the next external
  local-bus measurement.

- 2026-10-31: added `VBXE_BLITTER_SHORT_TIMING_TEST.XEX`, a 512-by-64
  MEMAC-B blit probe whose completion IRQ stores the raw `VCOUNT` in `$0082`.
  The transfer completes within one NTSC frame, so this value is a valid
  direct jsA8E/Altirra calibration datum rather than an ambiguous wrapped
  long-transfer marker. Source/XEX reproducibility and ROM-backed completion,
  acknowledgement, and non-wrap assertions are part of `test:vbxe`.

- 2026-10-31: the attribute-map timing probe exposed a stale jsA8E
  presentation-plane bug: after `VIDEO_CONTROL` disabled XDL at VSync, the
  prior attribute-map RGB values could remain above ANTIC/GTIA. The renderer
  now clears both VBXE output planes for every no-XDL scanline, with focused
  regression coverage. This restores the normal base display and matches the
  hardware's disabled-overlay behavior.

- 2026-10-31: the frame-synchronised `VBXE_BLITTER_TIMING_TEST.XEX` has now
  matched Altirra 4.40 FX 1.26: jsA8E and Altirra place its completion-IRQ
  horizontal marker at the same scanline while ANTIC reads the visible field
  through MEMAC B. This externally validates the current 912-cycle baseline,
  mode-0 cost, actual MEMAC reservation, IRQ delivery, and frame-phase
  integration. Overlay/XDL/attribute-map contention remains separate work.

- 2026-10-31: `VBXE_BLITTER_OVERLAY_TIMING_TEST.XEX` matches Altirra 4.40
  FX 1.26 at the same relative completion-marker scanline. This validates the
  standard-overlay and XDL local-DMA reservations against the prior MEMAC B
  baseline. The diagnostic disables the overlay only after completion and a
  VSync latch, solely to reveal the saved base-field marker.

- 2026-10-31: added `VBXE_BLITTER_ATTRMAP_TIMING_TEST.XEX`, which activates
  the documented periodic 172-byte attribute-map line-buffer fetch over the
  same MEMAC B field. The XEX, source reproducibility, and headless marker
  construction are covered. Its current external marker is obscured by the
  attribute-map presentation path in both emulators, so it is not yet a valid
  Altirra timing observation; it must not be used to tune the scheduler.

- 2026-10-31: added `VBXE_BLITTER_OVERLAY_TIMING_TEST.XEX`, a transparent
  standard-overlay differential. It leaves the MEMAC B Graphics 8 marker
  visible while exercising standard-overlay and XDL local DMA. Its source/XEX
  reproducibility and ROM-backed marker tests cover construction.

- 2026-10-31: added `VBXE_BLITTER_TIMING_TEST.XEX`, a reproducible external
  timing probe. It runs a long mode-0 local-VRAM blit while ANTIC uses MEMAC B,
  waits for a VCOUNT frame boundary, captures the completion-IRQ `VCOUNT`,
  and encodes it as a black/blue horizontal split. Its assembler and
  ROM-backed boot regressions verify the binary, completion acknowledgement,
  and marker construction; its exact jsA8E/Altirra split comparison is
  recorded in the newer validation entry above.

- 2026-10-31: Altirra 4.40 FX 1.26 rendered the blitter IRQ probe with its
  unambiguous stripe marker while jsA8E remained solid. This established that
  an enabled completion IRQ reaches the CPU. jsA8E now treats enabled uncleared
  `IRQ_STATUS` as a level-sensitive shared CPU IRQ source, reconciles it after
  every blitter slice and VBXE register write, and releases it when the guest
  writes `IRQ_CONTROL`. The headless IRQ diagnostic now verifies guest handler
  entry, acknowledgement, and the visible marker.

- 2026-10-31: replaced the blitter's arbitrary 256-output-byte scanline
  budget with the AHRM 12.4 uncongested local-bus model: 912 local cycles per
  scanline, 21 cycles to load a block, and the documented one-, two-, or
  three-cycle mode/source costs, including constant-source and X-zoom fetch
  elision. State coverage now verifies partial block loading and cycle-gated
  copy/fill progress. The eight-phase display/XDL/MEMAC contention arbiter is
  still pending.

- 2026-10-31: added scanline local-bus reservation for the VBXE blitter. It
  accounts for XDL, overlay mode, buffered attribute-map rows, and actual
  CPU/ANTIC MEMAC accesses before scheduling the lowest-priority blitter. The
  maximal standard-overlay case is asserted at AHRM's 236-cycle minimum;
  phase-exact ordering remains the next timing refinement.

- 2026-10-30: added the first functional VBXE blitter state machine. It loads
  21-byte VRAM blocks and implements linked lists, signed X/Y source and
  destination steps, width/height, zoom, pattern source, modes 0-6, byte and
  nibble collision-code latching, stop, snapshots, and `IRQ_STATUS`.
  It originally advanced with a fixed output-byte scanline budget; its current
  cycle-based scheduler is described by the newer entries above.
  `BLITTER_BUSY` exposes the documented distinct load (D0) and
  active (D1) states, so guest polling waits for both to clear. The new
  `vbxe_blitter_state` regression covers a strided 2D copy,
  snapshot resume, every operation, zoom/pattern, linked lists, collisions,
  completion status, plus assembled and headless-booted copy diagnostics.

- 2026-10-31: Altirra 4.40 FX 1.26 and jsA8E both completed
  `VBXE_BLITTER_COPY_TEST.XEX` and rendered the same centered 40-byte by
  192-line Graphics 8 field. Their blue differs because each uses its own
  GTIA palette conversion; the result confirms the blitter's visible copied
  data and display geometry, not an RGB-palette calibration.

- 2026-10-31: added `VBXE_BLITTER_IRQ_TEST.XEX` as an external observation
  probe for the CPU-delivery path. It uses the OS immediate IRQ vector and
  visibly distinguishes an entered-and-acknowledged completion IRQ
  (black/blue vertical stripes) from polling-only completion (solid blue),
  without depending on GTIA palette calibration or assuming a PBI status-bit
  mapping. The jsA8E/Altirra stripe comparison validates the resulting shared
  level-sensitive IRQ behavior.

- 2026-10-30: Altirra 4.40 FX 1.26 and jsA8E both rendered
  `VBXE_ATTRMAP_REVERSE_CHAR7_GTIA11_TEST.XEX` as opaque palette color 0.
  This completes the remaining Reverse/GTIA attribute-map matrix: hires
  modes 2/3/F, lores characters 4/5, selector characters 6/7, and graphics
  modes 8-E all have externally observed behavior in GTIA 9/10/11. The
  focused selector-mode regression now asserts the final mode-7/GTIA-11 case.

- 2026-10-30: Altirra 4.40 FX 1.26 and jsA8E both rendered
  `VBXE_ATTRMAP_REVERSE_CHAR7_GTIA9_TEST.XEX` as opaque palette color 0.
  The tall selector-character GTIA-9 case is now directly asserted. Only the
  mode-7 GTIA-11 observation remains in this Reverse/GTIA matrix.

- 2026-10-30: Altirra 4.40 FX 1.26 and jsA8E both rendered
  `VBXE_ATTRMAP_REVERSE_CHAR6_GTIA11_TEST.XEX` as opaque palette color 0.
  Selector-character mode 6 is now directly asserted in both GTIA 9 and 11;
  tall selector-character mode 7 remains a separate observation.

- 2026-10-30: Altirra 4.40 FX 1.26 comparison of
  `VBXE_ATTRMAP_REVERSE_CHAR6_GTIA9_TEST.XEX` established opaque palette
  color 0 in reversed ANTIC selector-character mode 6 with GTIA mode 9.
  jsA8E now applies that narrow source/mode rule only for valid raw lores
  values, with focused state coverage. Mode 7 and the GTIA-11 selector cases
  remain separately pending.

- 2026-10-30: Altirra 4.40 FX 1.26 and jsA8E both rendered
  `VBXE_ATTRMAP_REVERSE_CHAR3_GTIA11_TEST.XEX` as opaque palette color 0.
  The tall hires-character mode-3 GTIA-11 Reverse case is now directly
  asserted alongside its GTIA-9 counterpart.

- 2026-10-30: Altirra 4.40 FX 1.26 and jsA8E both rendered
  `VBXE_ATTRMAP_REVERSE_CHAR3_GTIA9_TEST.XEX` as opaque palette color 0.
  This externally confirms the tall hires-character mode-3 GTIA-9 Reverse
  case already covered by the shared valid-hires path. The focused state
  regression now asserts that result directly; GTIA 11 remains a separate
  observation.

- 2026-10-30: Altirra 4.40 FX 1.26 comparison of
  `VBXE_ATTRMAP_REVERSE_LORES_B_GTIA11_TEST.XEX` established opaque palette
  color 0 in reversed ANTIC graphics mode B with GTIA mode 11. Together with
  the separately observed modes 8/A and C-E, this completes the graphics
  mode 8-E GTIA-11 subset. The GTIA-9/11 graphics compositor now applies the
  opaque result to the complete source family, with a focused mode-B
  regression.

- 2026-10-30: Altirra 4.40 FX 1.26 comparison of
  `VBXE_ATTRMAP_REVERSE_LORES_A_GTIA11_TEST.XEX` established opaque palette
  color 0 in reversed ANTIC graphics mode A with GTIA mode 11. jsA8E now
  includes that exact source/mode pair in its GTIA-11 opaque subset, with
  focused state coverage. Only mode B remains pending for that source family.

- 2026-10-30: Altirra 4.40 FX 1.26 comparison of
  `VBXE_ATTRMAP_REVERSE_LORES_8_GTIA11_TEST.XEX` established opaque palette
  color 0 in reversed ANTIC graphics mode 8 with GTIA mode 11. jsA8E now
  includes that exact source/mode pair in its GTIA-11 opaque subset, with
  focused state coverage. Modes A/B remain pending.

- 2026-10-30: Altirra 4.40 FX 1.26 comparison of
  `VBXE_ATTRMAP_REVERSE_LORES_B_GTIA9_TEST.XEX` established opaque palette
  color 0 in reversed ANTIC graphics mode B with GTIA mode 9. Together with
  the independently observed modes 8/A and C-E, this completes the graphics
  mode 8-E GTIA-9 subset. jsA8E now applies the opaque result to that complete
  source family, with a state assertion for mode B. GTIA-11 modes 8/A/B are
  still pending and remain outside this rule.

- 2026-10-30: the same Altirra 4.40 FX 1.26 comparison for
  `VBXE_ATTRMAP_REVERSE_LORES_A_GTIA9_TEST.XEX` established opaque palette
  color 0 in reversed ANTIC graphics mode A with GTIA mode 9. The narrowly
  scoped GTIA-9 graphics compositor and state regression now include mode A.
  Mode B remains unvalidated; this observation does not affect GTIA 11.

- 2026-10-30: Altirra 4.40 FX 1.26 comparison of
  `VBXE_ATTRMAP_REVERSE_LORES_8_GTIA9_TEST.XEX` established that a reversed
  ANTIC graphics-mode-8 field in GTIA mode 9 is opaque palette color 0. The
  jsA8E diagnostic instead initially retained the ordinary red/blue/green
  lores-reverse bands. The GTIA-9 graphics compositor now includes mode 8 in
  the already validated C-E opaque subset, with focused state coverage.
  Modes A/B remain pending, as does mode 8 in GTIA 11; no broader rule is
  inferred from this one comparison.

- 2026-10-30: completed the reproducible diagnostic set for the remaining
  Reverse/GTIA matrix observations. The mode-3 hires-character probes now
  cover GTIA 9 and 11, modes 6 and 7 now cover GTIA 9 and 11, and graphics
  modes 8/A/B now have GTIA-11 probes. Each is an intentionally neutral
  external-differential XEX: its result must be recorded from Altirra FX 1.26
  before changing the compositor. The assembler regression checks every new
  source/artifact pair, so the exact binaries used for the external runs are
  reproducible. Existing graphics-mode probes remain unclaimed until that
  comparison is made.
  The GTIA-9/11 graphics compositor is correspondingly limited to the
  externally observed C-E modes; it must not generalize their opaque result
  to modes 8/A/B before those probes are run.

- 2026-10-29: implemented the first attribute-map subset from AHRM 12.4.
  XDL now retains `AtMapOn`/`AtMapOff`, map address and four-byte stride,
  scroll, and 8x1 through 32x32 cell layout. Active cells select P0-P3
  priority, override the overlay palette, and raise the attribute-map
  collision bit for non-transparent overlay pixels; the documented 43-cell
  line-buffer limit is applied. The playfield-color/PF3-mask and reverse-mode
  controls still require earlier ANTIC/GTIA composition work and are not
  claimed. Added the reproducible `VBXE_XDL_ATTRMAP_TEST.XEX` (227 bytes),
  which should show alternating green/blue 16-pixel stripes in a centered
  normal-width text field. Its attribute-map row stride uses the AHRM's native bits 7-2
  encoding (`$A0` for 160 bytes), rather than a shifted byte. Its palette
  setup writes CR/CG/CB in order because CB increments CSEL. It sets MAPSTEP
  to zero, deliberately reusing one initialized 40-cell row for the complete
  field; its text stride is also zero, because only one character row is
  initialized. Attribute-layout scroll values are now decoded as the AHRM's
  documented pixel counts minus one; static diagnostics omit that optional
  block and use the VSync default of zero scroll. `VBXE_XDL_ATTRMAP_V2_TEST.XEX` is byte-identical to the
  corrected diagnostic under a distinct filename, so visual testers cannot
  accidentally rerun the prior 227-byte artifact. Its vertical MAPSTEP
  companion validates map-row advancement independently. Added a separate
  checkerboard scroll diagnostic with four-pixel horizontal/vertical map
  offsets. Altirra and jsA8E now match for its cell order and scroll phase;
  their field dimensions differ only with host presentation. Focused state
  and assembler regressions pass. Attribute-map overscrolling beyond a cell
  dimension is validated by the 12-pixel checkerboard diagnostic: Altirra and
  jsA8E match for the initial partial cell and the continuing checker phase.
  Attribute-map cells now retain their three playfield values, playfield
  palette, and reverse flag as well as their already-rendered overlay fields.
  The first playfield subset applies per-cell PF0-PF2 palette colors to
  visible normal playfield pixels while preserving an overlay that won
  priority. `VBXE_ATTRMAP_PF0_V4_TEST.XEX` is the first external differential
  for that path: it contains no overlay and uses palette-0 PF0 overrides;
  it clears the whole attribute row and sets the ordinary Atari PF0 to black,
  so the region outside the normal-width map aperture is deterministic too.
  The reproducible `VBXE_ATTRMAP_PF12_TEST.XEX` extends the external
  differential scene to the PF1/PF2 byte fields with a mode-F bit pattern;
  it stores the complete 7.5 KiB mode-F screen, XDL, and map in known local
  VRAM through MEMAC B, eliminating CPU/ANTIC extended-RAM bank ambiguity;
  it also clears GTIA `PRIOR`, which fixes mode F to its documented PF1/PF2
  interpretation before comparison. PF3 masks and reversal remain pending.
  Its 191-line display-list loop uses `BNE` rather than signed `BPL`: the
  original `$BE` counter was negative on its first iteration and generated
  only one mode-F line. The ROM-backed `vbxe_attrmap_pf12_boot` regression
  now checks all 191 non-LMS lines plus the complete 192-line VBXE RGB field.
  Altirra and jsA8E externally match for that field, validating PF1/PF2 as
  well as the earlier PF0 path. Added a deterministic XCOLOR diagnostic with
  odd map entries and a state regression that verifies odd values are retained
  when VIDEO_CONTROL enables extended color; Altirra and jsA8E also match for
  its green/magenta result. The per-cell playfield-palette diagnostic also
  matches externally: alternating cells select palette 0 red and palette 3
  blue for the identical PF0 color index.
  Headless automation now loads the VBXE device module too, so its XEX runs
  can inspect the same VBXE configuration and render path as the browser.
  Attribute composition now also receives the active ANTIC mode at the
  ANTIC/VBXE boundary. This is deliberately preparatory: exact PF3-mask and
  reverse behavior must use the source mode and raw ANTIC bits, rather than
  incorrectly infer either from the final GTIA color. The first PF3-mask
  subset now covers ordinary non-reversed ANTIC mode F: a set map-mask bit
  replaces a visible PF2 source with the palette-selected GTIA PF3 color,
  at AHRM's 1/2/4 standard-pixel mask resolutions. Reverse interpretation,
  character sources, and GTIA-special modes remain pending.
  `VBXE_ATTRMAP_PF3_TEST.XEX` supplies an all-PF2 mode-F field with an `$AA`
  PF3 mask per 8-pixel cell, producing alternating green PF3 and blue PF2
  pixels. Its ROM-backed regression verifies those two colors on all 192
  display lines. Altirra and jsA8E externally match in the active field for
  mask phase, density, and green/blue colors; isolated Altirra pixels below
  the 192-line field are outside the diagnostic's active display and are
  treated as host presentation.
  Reverse mode now preserves the raw mode-F ANTIC bit stream through the
  playfield scratch/copy path. For a reverse attribute cell, adjacent source
  bits are decoded as PF0/PF1/PF2/PF3, with byte 0 again acting as PF0 and
  PF3 coming from the shadowed GTIA register; unfetched/border positions are
  explicitly excluded. `VBXE_ATTRMAP_REVERSE_TEST.XEX` repeats source pairs
  `$1B` and expects doubled red/blue/green/magenta PF0-PF3 stripes. Its
  ROM-backed 192-line assertion and the complete focused VBXE suite pass.
  Altirra and jsA8E externally match for color order, phase, and stripe
  width. Reverse decoding for GTIA-special modes remains pending. AHRM
  identifies ANTIC character modes 2 and 3 as hires, so their decoded glyph
  bits now share the mode-F PF0-PF3 pair interpretation.
  `VBXE_ATTRMAP_REVERSE_CHAR_TEST.asm` renders a mode-2 `$1B`
  glyph pattern and its ROM-backed regression verifies the PF0/PF1/PF2/PF3
  sequence across all 192 scanlines. Multicolor character modes 4 and 5 use
  two-bit lores glyph values at the same cadence as D/E, so they now use the
  same lores-to-hires rule. `VBXE_ATTRMAP_REVERSE_LORES_CHAR_TEST.asm` covers
  mode 4 with `00`/`01`/`10`/`11` glyph pairs and its ROM-backed assertion
  verifies the full 192-line field. The D/E lores subset follows AHRM's rule
  that lores data becomes
  pairs of hires pixels: each original two-bit lores value becomes two hires
  samples, on a PF2 base, and each set source bit substitutes PF1's luminance
  while retaining PF2's hue. It is therefore not a PF0-PF3 lookup. Raw D/E
  values are carried through the scratch/copy and snapshot paths; borders and
  unrelated modes remain marked invalid. `VBXE_ATTRMAP_REVERSE_LORES_PROBE.XEX`
  uses wide `00`/`01`/`10`/`11` source bands and distinct PF0/PF1/PF2 map
  colors to identify the real hardware mapping without high-frequency display
  ambiguity. It uses a narrow 32-byte ANTIC row because it divides ANTIC's
  4 KiB display-memory window exactly; the earlier 40-byte version crossed
  that window and therefore changed phase after its wrap. Video snapshots
  retain raw hires bits from modes 2/3/F and raw lores values from 4-E used
  by the reverse paths. Modes 8/A retain each repeated two-bit source value
  so Reverse preserves its lower-resolution phase. Modes 6/7 combine the
  glyph bit with their PF0-PF3 character selector, while binary modes 9/B/C
  correctly collapse background and PF0 to the same hires `00` pair. Unit
  coverage verifies each of those source encodings. Modes 2/3/F now also
  retain their raw hires bits during the currently supported GTIA-special
  rendering paths, so a later special-mode compositor does not lose Reverse's
  input; special-mode composition semantics themselves remain pending.
  External comparison then exposed that the attribute-map output was still
  presented through the legacy 256-pixel Atari compositor aperture, shrinking
  a normal-width 320-pixel field. Attribute-map colors now also enter the
  640-sample presentation plane directly from ANTIC's native normal-width
  span (physical x=96-415), with two presentation samples per ANTIC pixel.
  This is a signal-geometry correction, not a host-window scaling change.
  The legacy plane remains only as a compatibility mirror while standard and
  lores overlay rendering are migrated to the same native plane.
  The probe also exposed two independent jsA8E XDL errors before the lores
  behavior could be compared: repeat values were consumed on their loading
  line (so `$BF` lasted 191 rather than 192 lines), and an attribute-map-only
  entry did not clear stale overlay RGB before playfield composition. Both are
  now corrected and covered by device-state regressions. The reverse diagnostic now also places an explicit `AtMapOff` +
  `End` entry immediately after its 192-line repeat: per AHRM, a repeat does
  not terminate an XDL, so this prevents later VRAM from being interpreted as
  more attribute-map lines.
  `VBXE_ATTRMAP_REVERSE_GTIA9_TEST.XEX` reuses the same raw `$1B` source with
  GTIA mode 9 enabled. Altirra shows ordinary Rev stripes only for the setup
  frame, then its stable mode-9 background is black. As AHRM specifies the
  individual Rev and GTIA mechanisms but not their final combined compositor.
  The paired no-XDL baseline confirms AHRM mode-9 luminance bands in both
  emulators; with the reversed attribute map active, Altirra instead produces
  opaque palette color 0. jsA8E now implements that limited FX 1.26 mode-9
  result. Other source-mode combinations remain explicitly pending.
  `GTIA_MODE9_BASELINE_TEST.XEX` uses the same `$1B` ANTIC source but disables
  VBXE VIDEO_CONTROL, isolating AHRM mode 9's raw-nibble luminance result from
  any XDL or attribute-map behavior.
  The paired mode-11 baseline/reverse diagnostics set `COLBK` to `$0E`, making
  AHRM's raw-nibble hue selection observable before composition. Both
  emulators show the same cyan/yellow baseline; with the reversed map,
  Altirra's stable result is opaque palette color 0 after the setup frame.
  jsA8E now implements that equally narrow FX 1.26 mode-11 result. The
  validated mode-F behavior was then confirmed with both other AHRM hires
  character sources: mode 2 in modes 9/10/11 and tall mode 3 in mode 10.
  Other source-mode combinations remain pending.
  `GTIA_MODE10_BASELINE_TEST.XEX` and
  `VBXE_ATTRMAP_REVERSE_GTIA10_TEST.XEX` use the same controlled `$1B`
  source and bright `$0E` background to isolate the remaining mode-10
  baseline and reverse composition. Both emulators show the same grayscale
  baseline; with Reverse, Altirra makes the 192-line active field opaque
  palette color 0 (apart from its final presentation-edge line). jsA8E now
  applies the same narrow FX 1.26 result to valid hires pairs in all three
  GTIA special modes; other source-mode combinations remain pending.
  `VBXE_ATTRMAP_REVERSE_CHAR_GTIA10_TEST.XEX` carries that check to AHRM's
  other hires source, ANTIC mode 2, before generalizing the externally
  established mode-F result to character data.
  The analogous mode-4 lores probe explicitly clears all four playfield
  registers, including `COLPF0`; its `$1B` source uses that register, so
  omitting it makes a cold-reset color difference look like a GTIA/VBXE
  composition difference.
  The resulting controlled mode-10 lores probes show that `$1B` renders as
  alternating PF0/color-0 groups; changing map PF0 changes the visible
  Altirra group, while raw `$23` (nibbles 2 and 3) is black. jsA8E now
  implements only that observed mode-4/GTIA-10 subset by combining each two
  adjacent two-bit sources into one raw nibble: nibble 1 selects map PF0, and
  measured 2, 3, and `$B` select palette color 0. Other lores special-mode
  combinations remain pending.
  Its stable PF0/color-0 alternation externally matches Altirra for the
  controlled mode-4/GTIA-10 `$1B` field. Mode-4 combinations with GTIA 9 and
  11 are separate from mode 10: both externally produce opaque palette color
  0 for valid lores sources, which jsA8E now implements without generalizing
  to graphics modes 6-E. Tall lores character mode 5 externally confirms the
  same GTIA-10 PF0/color-0 pattern, so the shared mode-4/5 source path now
  implements it; its GTIA-9 and GTIA-11 probes likewise confirm opaque color
  0 in both emulators.
  ANTIC modes 6/7 are separate again: their glyph-bit/PF-selector sources
  produce opaque palette color 0 in the controlled GTIA-10 reverse probes,
  now covered by jsA8E without extrapolating to other special modes.
  The lores reverse rule is covered both by an isolated four-value test and by a ROM-backed
  192-line D/E probe regression before the external probes are used for
  full-frame comparison. `VBXE_ATTRMAP_REVERSE_LORES_GTIA10_TEST.XEX` reuses
  the four-band D/E source with GTIA mode 10 enabled, providing the next
  isolated reference test for graphics-mode special composition. Altirra's
  stable result is opaque palette color 0 for every band, while the initial
  jsA8E result incorrectly applied ordinary lores Reverse. jsA8E now matches
  this limited GTIA-10 behavior for graphics mode E only. The separate
  mode-D derivative then confirmed the same stable opaque result in Altirra;
  it also exposed jsA8E alternating between the normal lores result and black
  on lower scanlines. The mode-D diagnostic was also corrected to use 96
  ANTIC rows (two scanlines each), matching its 192-line XDL repeat rather
  than spilling into a second unmapped field. The D/E graphics source family
  now takes the confirmed opaque GTIA-10 path throughout its mapped field,
  including where the raw source capture is unavailable. The C-mode/GTIA-10
  derivative then confirmed the same stable opaque result in Altirra, so the
  implemented graphics subset is now C/D/E. The B-mode/GTIA-10 derivative
  likewise produced stable opaque black in Altirra, extending the confirmed
  graphics subset to B/C/D/E. The mode-A/GTIA-10 derivative then confirmed
  stable opaque black in both emulators, extending the validated graphics
  subset to A-E. The remaining mode-8/GTIA-10 derivative then confirmed the
  same stable opaque result in Altirra, completing the validated graphics
  8-E subset for GTIA 10. The graphics-mode-E/GTIA-9 derivative then showed
  opaque black in Altirra; the separate mode-D probe confirmed the same
  result. The mode-C probe did too, so jsA8E now implements C/D/E; all other
  graphics GTIA-9/11 combinations remain pending.
  GTIA-11 graphics modes E, D, and C were externally compared next and each
  is stable opaque black in both jsA8E and Altirra. The remaining external
  matrix entries are GTIA-11 graphics B, A, and 8. The implementation must
  remain scoped to externally observed source/mode combinations; ordinary
  AHRM lores reinterpretation is not evidence for the special compositor.
  The vertical companion probe holds each of `00`, `01`, `10`, and `11` for
  32 complete lines, making any hardware reinterpretation visible without
  horizontal resampling ambiguity.

- 2026-10-29: external text diagnostics exposed that the original VBXE RGB
  plane reduced hires/text to the 256-pixel Atari compositor aperture. The
  colors matched Altirra, but high-frequency text stripes and scroll patterns
  did not. Hires/text now render into a 672-pixel scene-width RGB plane with a
  centered 640-pixel normal overlay, which WebGL composites after the indexed
  Atari plane; the 2D fallback samples that plane at its available resolution.
  Presentation, reset, and snapshots preserve the additional plane. Focused
  regressions cover adjacent hires nibbles and the expanded buffer. The text
  diagnostics now match Altirra in their internal stripe/checker density and
  phase; the remaining fullscreen height and margin difference is host
  presentation, not emulated VBXE signal behavior.

- 2026-10-29: added the first XDL hires graphics subset. The compositor now
  projects the 640-pixel mode into the same normal 256-pixel aperture as the
  externally validated standard/lores paths, unpacking each source byte
  MSB-first into two 4-bit palette indices. It applies VIDEO_CONTROL color-0/
  color-`$F` transparency to the unpacked pixel but uses the original complete
  byte for COLMASK, as required by AHRM 12.4. Focused regressions cover nibble
  order, palette lookup, transparency, and byte-group collision selection.
  The shared transparency path now also distinguishes standard/lores `$xF`
  from hires `$F`, including collision suppression for those transparent
  pixels. XDL priority now uses the same final-contributor plane as VBXE
  collisions, so hidden P/M graphics cannot spuriously block or admit the
  overlay.
- 2026-10-29: added `VBXE_XDL_HIRES_TEST.asm` and its reproducible XEX
  artifact, an FX 1.26 diagnostic for a uniform 640x192 hires overlay. It
  writes `$11` bytes to the 320-byte local-VRAM row and programs palette-1
  color 1 blue, making nibble ordering and width errors immediately visible.
  Altirra and jsA8E both display its expected centered, top-aligned uniform
  blue field, externally validating the first hires geometry and nibble path.

- 2026-10-29: extended the XDL decoder with the text-mode state that can be
  established unambiguously from AHRM 12.4: `ChBase`, horizontal/vertical text
  scroll offsets, and a row counter. Text lines now retain their character
  row address for eight scanlines and advance by overlay stride only after row
  7. This state underpins the initial text renderer; its transparency and
  scrolling diagnostics now match Altirra. Attribute maps still await their
  own diagnostics.

- 2026-10-29: rendered the first XDL text subset: 80-column character/
  attribute pairs reference an 8x8, 2 KiB-aligned local font through `ChBase`;
  foreground colors and opaque or transparent backgrounds follow the text
  attribute and VIDEO_CONTROL rules. Text collision detection, scrolling, and
  attribute-map overrides remain excluded. Added a reproducible uniform-field
  `VBXE_XDL_TEXT_TEST` XEX. Altirra and jsA8E both show its expected uniform
  yellow field, externally validating this initial text geometry and `ChBase`
  path.

- 2026-10-29: implemented initial XDL text scrolling. Horizontal scroll
  offsets the 640-pixel font stream; vertical scroll offsets the font row and
  selects the next character row after crossing row 7. Focused tests cover
  both axes, and `VBXE_XDL_TEXT_SCROLL_TEST` provides the first Altirra
  differential scene. Its internal checker/stripe density and phase now
  match Altirra; exact scroll range and edge-fetch behavior remain outside
  this first diagnostic.

- 2026-10-29: implemented the first VBXE overlay-collision subset in jsA8E.
  Standard/lores XDL source bytes now consult `COLMASK` and accumulate the
  PF0-3/P5 and P0-3 layer bits in `COLDETECT`; collision capture is independent
  of XDL overlay priority, and `COLCLR` clears only the VBXE latch. GTIA now
  records a final-contributor plane during P/M composition, so a P/M graphic
  hidden by `PRIOR` is excluded before VBXE samples the line. The scope still
  excludes attribute-map collisions, and complex P5/multicolor/GTIA-special
  combinations need differential validation. Focused device and GTIA
  regressions cover mask groups, PF/PM mapping, priority independence,
  transparency, clearing, and a hidden-versus-visible P0 case.

- 2026-10-29: synchronized the implementation documentation with the current
  VBXE branch. `VBXE.md` now records the implemented FX 1.26 `$D600`/`$D700`
  selection, MEMAC A/B, and initial standard/lores XDL compositor rather than
  describing them as future work. Core, render, worker, and UI notes now
  document the separate RGB plane and the main-thread-only limitation while
  VBXE is enabled.

- 2026-10-29: started the optional jsA8E VBXE device foundation. The new
  `js/core/vbxe.js` models a disabled-by-default FX 1.26 board with 512 KiB
  local VRAM, `$D640` register decoding, palette/write latches, VSync-latched
  video/XDL controls, soft reset, MEMAC register state and CPU/ANTIC address
  resolution, CPU RAM-window mapping, ANTIC DMA reads (with Ultimate1MB
  precedence), and snapshot copying.
  I/O only maps the VBXE page when enabled, so ordinary machines retain their
  prior decode. The XDL renderer, MEMAC mapping, compositing, and blitter are
  intentionally not claimed yet. The focused device-state test and existing
  snapshot, ANTIC, machine-matrix, and headless automation regressions pass.

- 2026-10-29: added `VBXE_MEMAC_B_TEST.asm` and its reproducible XEX artifact
  as the first external differential diagnostic. With an FX 1.26 VBXE at
  `$D640`, it verifies the revision registers, enables CPU+ANTIC MEMAC B bank
  0 at `$4000-$7FFF`, tests a CPU VRAM read/write, and displays an ANTIC text
  screen sourced from that VRAM. It is intended for Altirra comparison before
  extending the device beyond the bus-level implementation.

- 2026-10-29: corrected the first Altirra differential diagnostic after an
  external run: Altirra's `$D600` device option places VBXE registers at
  `$D640` (and `$D700` at `$D740`), while valid FX 1.26 cores can differ in
  the non-major bits of `CORE_REVISION`. The XEX now probes both register
  pages, accepts the defined FX major/minor revision fields, and writes proper
  Atari screen-code spaces instead of displaying `@` characters.

- 2026-10-29: Altirra ran `VBXE_MEMAC_B_TEST.XEX` with VBXE FX 1.26 in its
  `$D600` device range and reported all four expected PASS lines. This is the
  first external differential result: CPU and ANTIC both accessed MEMAC B
  bank 0 successfully. Added a persisted, disabled-by-default VBXE selector
  to jsA8E for FX 1.26 at `$D600`/`$D700`; changes rebuild the machine so the
  MEMAC decode cannot be changed on a live map.

- 2026-10-29: added `VBXE_MEMAC_A_TEST.asm` and its reproducible XEX artifact
  for the next external differential case. It disables MEMAC B, configures
  MEMAC A as the smallest 4 KiB `$6000-$6FFF` CPU+ANTIC window into local bank
  0, then proves CPU read/write and ANTIC display-list fetching through it.

- 2026-10-29: Altirra and jsA8E both ran `VBXE_MEMAC_A_TEST.XEX` with all
  expected PASS lines, externally validating the 4 KiB `$6000-$6FFF` MEMAC A
  window for CPU and ANTIC. Added the next differential diagnostic,
  `VBXE_MEMAC_PRIORITY_TEST`: it overlays MEMAC A bank 0 onto MEMAC B bank 1
  at `$6000`, verifies that disabling A exposes B's sentinel again, then
  verifies ANTIC still fetches from the higher-priority A window.

- 2026-10-29: began the XDL milestone with snapshot-safe frame state and a
  tested per-line decoder for overlay graphics/text enable, repeat, overlay
  address and stride, optional block skipping, and XDL termination. It does
  not composite pixels yet; direct VBXE RGB output is the next renderer step.

- 2026-10-29: added a separate 32-bit RGB plane to the software video path
  for VBXE composition. It is copied at presentation time and takes priority
  only when nonzero, leaving normal indexed Atari rendering unchanged. XDL
  drawing will populate this plane rather than mutate the Atari palette.

- 2026-10-29: connected the first visible XDL subset: standard-resolution,
  normal-width graphics now draws 320 palette-1 RGB pixels per decoded XDL
  line into the separate VBXE plane after ANTIC/GTIA. Other widths, modes,
  transparency, and priority are intentionally pending comparison.

- 2026-10-29: Altirra comparison of the first XDL XEX found the diagnostic's
  repeated overlay row needed a zero stride; after correction it displays the
  expected uniform red field. A jsA8E WebGL texture-allocation ordering bug
  was also fixed: creating the VBXE RGB texture no longer redirects the Atari
  palette upload into that texture.

- 2026-10-29: made WebGL shader-source loads bypass the HTTP cache so a
  renderer change (including the new VBXE RGB sampler) cannot silently run
  against a stale fragment shader during visual differential testing.

- 2026-10-29: the worker renderer remains disabled only while VBXE is active:
  its frame path still loses the separate VBXE RGB plane. The main-thread
  WebGL renderer remains enabled, preserving the original CRT postprocess
  while XDL output is validated.

- 2026-10-29: external visual validation confirmed jsA8E now matches Altirra
  for standard and lores XDL field geometry, palette RGB output, and stable
  frame presentation. The original WebGL CRT barrel/scanline effect also
  works with VBXE after changing the RGB texture upload from `Uint32Array` to
  an explicit byte view. Main-thread WebGL remains the active VBXE renderer;
  worker VBXE presentation remains deferred.

- 2026-10-29: added the initial FX 1.26 overlay-priority compositor for the
  standard/lores subset. The XDL priority mask now gates background, PF0-3,
  and P0-3 visibility against the existing Atari per-pixel priority plane;
  focused tests cover priority blocking and allowing over PF0.

- 2026-10-29: made the XDL priority diagnostic deterministic by clearing its
  local VRAM row before use. Repeated Altirra runs show a valid 160-byte lores
  row fills the full normal overlay width; jsA8E therefore scales lores 160 to
  the same 256-pixel presentation aperture as standard graphics.

- 2026-10-29: jsA8E now visually matches Altirra for the first XDL
  standard-resolution test (a uniform 320x192 red field). VBXE currently
  selects the software renderer while active, isolating the validated RGB
  plane from the still-in-progress WebGL path. Added the corresponding lores
  160-pixel renderer path with two-pixel horizontal expansion.

- 2026-10-29: added tested color-0 and color-`$xF` overlay transparency for
  the standard/lores renderer subset, gated by the VSync-latched
  VIDEO_CONTROL transparency field. Without that field, zero remains an
  opaque black pixel.

- 2026-10-29: the XDL graphics descriptor now retains `OvMisc` overlay
  palette and priority fields, and the separate VBXE RGB plane is cleared at
  each frame boundary so transparent pixels cannot leave stale overlay data.

- 2026-10-29: added `VBXE_XDL_LORES_TEST.asm`, the next Altirra/jsA8E visual
  differential diagnostic. It produces a uniform 160x192 green lores overlay
  (doubled horizontally to the normal 320-pixel output width).

- 2026-10-29: rejected the experimental wider VBXE presentation viewport
  after external visual testing: it displaced the normal Atari raster without
  changing the overlay's relative width. Overlay geometry must instead be
  corrected inside the VBXE compositor; the standard 336-pixel viewport was
  restored.

- 2026-10-29: adjusted normal/lores VBXE overlay geometry inside the
  compositor from 320 to 256 presented pixels (4:5), centered at x=128. This
  matches the observed Altirra ratio of a normal-width 320-pixel VBXE overlay
  within the wider Atari raster while preserving jsA8E's standard viewport.

- 2026-10-29: Altirra confirmed the lores XDL diagnostic as a centered,
  top-aligned 320x192 green field over the Atari background. jsA8E's visible
  flicker was caused by clearing the whole VBXE plane at VSync before its
  scanlines were rebuilt; the plane now clears each composed overlay line.

- 2026-10-29: added `implementation/VBXE.md`, the pre-implementation design
  for an optional VideoBoard XE device. It defines behavior-level rather than
  gate-level FPGA emulation, an FX 1.26 / `$D640` first target, 512 KiB VRAM,
  MEMAC and XDL integration, staged compositor/blitter work, snapshot and
  reset expectations, and an Altirra-based differential validation plan. No
  production emulation behavior changed.

- 2026-10-26: added the first jsA8E interface theme system on the `Themes`
  branch. The browser UI now provides persistent presets inspired by Atari
  400/800, 800XL, 65XE/130XE, XEGS, ST, and 2600 hardware, plus the existing
  dark presentation. Theme variables cover the main workspace, toolbar,
  sub-panels, and virtual keyboard without changing the emulated PAL/NTSC
  palette or CRT renderer. The 800XL theme was reset to a white base with gray
  text, black borders, and red/dark-gray highlights; the XEGS theme uses the sampled warm-gray,
  red, blue, yellow, pink, and lilac colors from the supplied reference image.
  The assembler editor and snapshot panel backgrounds now consume the active
  theme surfaces instead of retaining fixed dark backgrounds.
  The selector persists through `localStorage`. Visual browser verification
  remains pending because the local Windows/browser automation runtime was not
  available in this session. `node --check`, `git diff --check`, theme-reference
  checks, and HTTP serving checks pass; ESLint could not run because the local
  `jsA8E` dependency tree does not contain the `eslint` executable.

- 2026-10-26: replaced the mounted-disk library's text activity marker with the
  compact `jsA8E/assets/leds.png` sprite. Its four LED states are mapped to
  green for reads, red for writes, yellow for media errors, and the unlit LED
  when idle. The sprite is rendered at 18px so it fits the narrow library row;
  the activity event handling also recognizes error/failure operation names
  without changing emulation timing.

- 2026-10-26: measured the LED sprite's visible centers at X=29, 81, 133,
  and 186 px rather than assuming equal source cells. Adjusted each 18px
  library crop independently so the colored and unlit indicators remain
  visually stationary when activity changes.

- 2026-10-26: renamed the visible `classic` dark theme label to `CyberDeck`;
  its stored key remains `classic` for preference compatibility.

- 2026-10-26: removed the misleading writable markers from mounted disk rows
  and removed the `RW` column from the disk library. The UI no longer claims
  write protection support until the emulated media path enforces it.

- 2026-10-26: increased the 800XL top-bar gradient contrast and added a subtle
  mid-tone highlight so its white surface reads more like brushed metal.

- 2026-10-26: replaced the OS and BASIC ROM load-button check/cross icons with
  the compact LED sprite. The indicator is unlit when the ROM is absent and
  green when it is loaded; loading behavior and stored ROM handling are
  unchanged.

- 2026-10-23: fixed host `Shift+Arrow` cursor-key handling in jsA8E. The
  keydown records whether an arrow was mapped as an Atari cursor key or a
  joystick direction; keyup releases the same path even if Shift was released
  first. During the cursor chord, the Atari Shift line is temporarily masked
  so the synthetic `Ctrl`+punctuation cursor code is not reinterpreted by
  screen editors as a Shift-modified command. The up/down codes now exactly
  match physical `Ctrl+-` (`$8E`) and `Ctrl+=` (`$8F`) rather than their
  ASCII-key values. This prevents stuck keys while preserving normal Shift
  typing and unmodified arrow-as-joystick behavior.

- 2026-10-23: removed the virtual-disk burst shortcut that could schedule
  `DATA NEEDED` 50 CPU cycles after a write, before the next real POKEY serial
  clock edge. The drive-grant state remains bounded, but both jsA8E and native
  A8E now schedule the holding-register load only from POKEY's clock. This
  prevents accelerated data bytes from creating guest checksum races and
  preserves AHRM serial timing; the normal DOS retry timeout is intentionally
  unchanged.

- 2026-10-23: corrected the first automatic SIO response phase. The simplified
  receive path delivers complete bytes directly to SERIN, so its 1530-cycle
  first-response interval is already guest-visible. Adding another byte time
  had shifted the input-IRQ phase and increased the older OS `CHKSUM` race;
  JS and native paths now use the same 1530-cycle first-byte phase while
  subsequent-byte timing, checksum validation, NAK behavior, and DOS retry
  timing remain unchanged.

- 2026-10-23: live jsA8E capture of `SAVE"D2:OTRO.BAS"` isolated the long
  retry: sector 163 transmitted all 128 payload bytes plus checksum in order,
  with no SEROUT holding-register overwrite, but POKEY raised the first
  `DATA NEEDED` event only four CPU cycles after the first SEROUT store. The
  guest then supplied `$EE` while the transmitted payload checksum was `$71`,
  so the virtual drive correctly returned NAK and DOS waited 15.96 seconds.
  This is the AHRM 5.10 old-OS CHKSUM race, not ATR corruption or a disk-write
  failure. The response-phase correction above removes an erroneous extra
  input-byte interval that was shifting this IRQ phase.

- 2026-10-23: the same capture showed the serial output-ready latch was being
  made visible on the timer edge itself: a sector could raise `DATA NEEDED`
  five cycles after the first SEROUT store. JS and native POKEY now apply the
  two-cycle serial-latch propagation interval after the selected clock edge.
  This preserves the clock edge and ten-bit frame cadence, but prevents an
  emulator-only early IRQ from preempting the following `CHKSUM` store.

- 2026-10-23: corrected SIO command-line ownership in jsA8E and native A8E.
  POKEY `SEROUT` writes no longer force PIA CB2 low or high. The command
  frame is retained until the guest's real CB2 low-to-high transition, then
  the disk begins validation and ACK/NAK timing. This restores the AHRM
  command setup phase before the OS starts its first data byte and avoids
  injecting a virtual response IRQ into the first-byte `CHKSUM` race. The
  focused regression now verifies that no response is queued before CB2 rises
  and that data writes do not reassert COMMAND.

- 2026-10-23: added focused jsA8E SIO transmission diagnostics for the
  `SEROUT` holding register, `DATA NEEDED`, shift-register transfer, and
  `XMTDONE` byte delivery. The trace records pending/active values and
  deadlines so checksum failures can be reproduced without the invasive
  all-memory access hook; its diagnostic ring retains a complete multi-sector
  frame, and emulation timing is unchanged.

- 2026-10-23: corrected the diagnostic wire-byte index so it refers to the
  byte currently being delivered, before the SIO data counter is incremented.
  This changes only trace interpretation; emulation timing and data flow are
  unchanged.

- 2026-10-23: the first byte-by-byte live trace of the problematic SIO path
  showed that CPU `SEROUT` values and transmitted values remain ordered, with
  no holding-register overwrite in the captured command/read sequence. The
  observed NAKs therefore came from the Atari-side checksum value already
  written by the guest (for example, `$EE` supplied where the checksum of the
  four transmitted command bytes was `$41`), not from the virtual-disk
  checksum routine or ATR geometry. The diagnostic still records
  `holdingOccupied` so a real WRITE data phase can distinguish this documented
  guest checksum race from a POKEY overrun.

- 2026-10-23: anchored queued serial-output frames to the previously scheduled
  `XMTDONE` deadline in jsA8E and native A8E. Timed callbacks can be observed
  a few CPU cycles late at an instruction boundary; the next ten-bit frame now
  preserves the existing cadence instead of accumulating that dispatch delay.
  The change does not accept invalid checksums or alter SEROUT replacement
  semantics, and a regression covers a late callback with one queued byte.

- 2026-10-22: revised virtual-disk SIO burst timing to follow the AHRM/Altirra
  device-grant model without copying Altirra source. A write/put/verify command
  now explicitly grants the burst only after entering its data phase; each
  payload byte renews a bounded window, and the checksum byte revokes the
  grant. The original implementation briefly used a 50-cycle minimum lead;
  that shortcut was removed on 2026-10-23 because it could precede the next
  real POKEY output-clock edge. JS and native POKEY paths now share the
  bounded state and preserve normal timing. The regression covers the grant,
  POKEY-clock scheduling, and closure behavior.

- 2026-10-22: aligned the first virtual-disk SIO response with the AHRM
  automatic-response minimum by reducing its delay from 3000 to 1530 CPU
  cycles in both JS and native POKEY. This matches the reference scheduler's
  response timing and avoids an unnecessary response-phase interval before
  DOS prepares the next transfer.

- 2026-10-22: added AHRM-aligned support for standard flat sector dumps
  without an ATR container header. The jsA8E media boundary now recognizes
  90K/130K single-density and standard double-density raw geometries and
  normalizes them to the internal ATR representation; double-density boot
  sectors retain the AHRM rule that only their first 128 bytes are exposed.
  The ATR inspector and automation regression suite cover the raw path.

- 2026-10-22: moved all AHRM guest-test sources, XEX artifacts, individual
  guides, and the cumulative validation guide into `implementation/AHRM Validation/`.
  Updated automated test paths, hardware-validation references, the diagram,
  and `.gitignore` accordingly. Older entries retain their original wording
  as historical change records.

- 2026-10-21: simplified the AHRM10 PMG artwork to one-line-resolution
  solid bars. The moving M0 projectile and P0-P3 bars now use the AHRM 2 KiB
  PMG layout, making the collision scene readable without fragile sprite
  glyph shapes.

- 2026-10-21: corrected the visual presentation of the new AHRM10 scene by
  switching its display list to ANTIC mode 7 (Atari BASIC `GRAPHICS 2`),
  initializing `VDELAY`, using a black/high-contrast text palette, and moving
  the PMG artwork below the instruction rows. The 20-column screen layout and
  status/register offsets were adjusted accordingly.

- 2026-10-21: redesigned `AHRM10_PRIORITY_COLLISION_TEST` as a human-readable
  space scene. A red ship, green target, and moving yellow missile now make
  the collision event visible as `COLLISION WAIT` -> `COLLISION HIT`; the
  scene still cycles all nine `PRIOR` values every 32 frames and exposes the
  live `M0PL`, `P0PL`, and `P1PL` masks. Corrected the missile collision
  register definitions to the AHRM addresses (`$D008-$D00B`) and added a
  headless moving-missile boot regression.

- 2026-10-21: completed the visual validation of the simplified
  `AHRM09_GTIA_MODES_TEST`. The observed output is a fixed full-screen ramp
  with no text or resolution changes; only the GTIA colour interpretation
  changes between the three 128-frame phases. The reported roughly three-
  second colour transitions are accepted as the expected result for the
  tested display setup, with the exact wall-clock interval remaining
  PAL/NTSC- and host-dependent.

- 2026-10-21: simplified `AHRM09_GTIA_MODES_TEST` to a full-screen visual
  diagnostic with no text overlay and one DLI per frame. This removes the
  text-band transition path and makes the three 128-frame GTIA phases easier
  to perceive.

- 2026-10-21: fixed the `AHRM09_GTIA_MODES_TEST` two-DLI phase counter so
  `DLI_STATE` is set after every first DLI, not only when the phase changes.
  This restores the intended one counter tick per frame and the full 128-frame
  pause for each GTIA mode.

- 2026-10-21: extended each `AHRM09_GTIA_MODES_TEST` GTIA phase from 32 to
  128 frames so the mode-9/10/11 differences are easier to observe manually;
  regenerated the XEX and updated the displayed diagnostic text.

- 2026-10-21: moved the two `AHRM09_GTIA_MODES_TEST` phase DLIs onto blank
  guard lines. This prevents a `PRIOR`/`COLBK` transition from splitting a
  visible text or ramp row and removes raster-boundary flicker.

- 2026-10-21: improved `AHRM09_GTIA_MODES_TEST` readability by keeping the
  title in a normal ANTIC band and applying GTIA special modes only to the
  ramp band. Paired DLIs enable and restore the phase without losing the
  color-mode comparison.

- 2026-10-21: corrected `AHRM09_GTIA_MODES_TEST` to enable only DLI NMIs.
  The OS VBI was restoring its GTIA shadow values every frame, masking the
  diagnostic's mode-9/10/11 transitions; the XEX artifact was regenerated.

- 2026-10-21: added the first external-comparison diagnostic batch:
  `AHRM09_GTIA_MODES_TEST` cycles GTIA modes 9/10/11 over a deterministic
  ramp, `AHRM10_PRIORITY_COLLISION_TEST` exercises documented and conflicting
  `PRIOR` combinations with live collision latches, and
  `AHRM11_POKEY_AUDIO_TEST` produces fixed audio-capture phases for square,
  noise, linked-timer, volume-only, and high-pass paths. Each has an assembly
  source, documentation, reproducible XEX artifact, and assembler regression;
  audio and video results remain observational until compared with captures.

- 2026-10-21: added `implementation/AHRM Validation/AHRM_Validation_Tests.md`, the cumulative
  English operating guide for all current memory, ANTIC, GTIA/PMG, POKEY, CPU
  boundary, and host-side validation tests. It records expected screen values,
  PASS lines, observational results, known deviations, and the chapter format
  required when future diagnostics are added.

- 2026-10-21: added `AHRM12_ANTIC_DISPLAYLIST_TEST` for LMS/DLI/JVB,
  HSCROL, and VSCROL comparison, plus `AHRM13_ANTIC_CHARSET_TEST` for OS and
  custom CHBASE sections, CHACTL inversion, and vertical reflection. Both
  include reproducible XEX artifacts, guides, manual boot-smoke validation,
  and new chapters in `AHRM_Validation_Tests.md`.

- 2026-10-21: completed the proposed guest diagnostic set with
  `AHRM14_PMG_DMA_EDGE_TEST`, `AHRM15_CPU_DMA_CONTENTION_TEST`,
  `AHRM16_PIA_CONSOL_INPUT_TEST`, `AHRM17_VIDEO_TIMING_TEST`, and
  `AHRM18_POKEY_RANDOM_TIMER_TEST`. These cover PMG resolution/PMBASE/VDELAY,
  CPU bus contention, live PIA/CONSOL input, PAL/NTSC VCOUNT ranges, and
  POKEY RANDOM/timer observations; each has a reproducible XEX and a chapter
  in `AHRM_Validation_Tests.md`.

- 2026-10-21: the complete JavaScript automation suite passed after adding
  AHRM-14 through AHRM-18. Native CTest remains at 14/16: the existing
  `antic_graphics_modes_probe` mode-0 PF2/player-mix contract and
  `pokey_sio_contract_probe` initial-ACK contract still fail; no production
  emulator code was changed by the guest-test batch.

- 2026-10-21: expanded the English Assembler Editor manual with a 6502
  instruction quick reference, instruction-family examples, and an addressing
  mode table including zero-page indirect-pointer guidance.

- 2026-10-21: corrected the English Assembler Editor's screen-text example by
  placing its indirect-index pointer in zero page (`$0080`), as required by
  the 6502 `(pointer),Y` addressing mode, and by using the correct Atari screen
  codes for uppercase letters and spaces.

- 2026-10-21: improved the jsA8E Assembler Editor line-number gutter
  readability. Line numbers now use the panel's normal text color and full
  opacity, including source lines without assembled addresses, while address
  and byte metadata retain their subdued styling.

- 2026-10-21: translated `implementation/Asembler_editor_manual.md` from
  Spanish to English, matching the official language used by the emulator
  interface and documentation.

- 2026-10-21: added `implementation/Asembler_editor_manual.md`, a Spanish
  user manual for the jsA8E Assembler Editor. It documents the HostFS workflow,
  editor controls, source syntax, executable generation, debugging, common
  errors, and simple 6502 examples.

- 2026-10-21: fixed the jsA8E Assembler Editor HostFS source selector during
  asynchronous Worker/IndexedDB startup. The Worker now waits for the HostFS
  snapshot to be ready, while the editor shows a loading state and refreshes
  when the file list arrives instead of treating the initial empty cache as
  having no assembler sources.

- 2026-10-21: made the Assembler Editor load the selected HostFS source
  immediately when the source selector changes, using the same read and editor
  refresh path as the explicit Load button.

- 2026-10-21: fixed the Assembler Editor initial-load condition so the first
  HostFS source is loaded even though the editor starts with its example
  template; subsequent panel openings preserve the user's current edits.

- 2026-10-21: added a draggable desktop divider between the tools column and
  the Atari display in the browser Work/Development layouts. The column ratio
  updates live through pointer or keyboard interaction, persists in browser
  storage, and is disabled automatically for the mobile single-column layout.

- 2026-10-20: fixed native `-o`/`-O` OPTION-on-start boot mapping. The XL/XE
  reset state now leaves BASIC unmapped when OPTION is requested, so the OS
  can preserve BASIC-disabled memory for disk software or enter Self Test
  without D1:. Added an execution-level regression to
  `A8E/tests/gtia_consol_probe.c`; the JavaScript CONSOL contract remains
  covered by `jsA8E/tests/consol_startup_option.test.js`.

- 2026-10-20: fixed the native Windows Full Library storage-capacity path in
  `A8E/LibraryWindow.c`. `GetDiskFreeSpaceExA` now reads the available-byte
  result from the declared `tAvailable` variable instead of the nonexistent
  `tFree`; the Linux `statvfs` path was unchanged.

- 2026-10-17: started `OptimizationRun1` with an AHRM-preserving GTIA PMG
  allocation reduction. Immutable PMG register maps are now allocated once,
  while per-clock collision scratch buffers are owned by each machine and
  reused. The per-clock priming helpers are also shared instead of recreated
  as closures. The PMG draw order, register accesses, collision writes, and
  cycle timing are unchanged; the scratch buffers are transient and excluded
  from serialized machine state.

- 2026-10-17: made jsA8E's per-instruction debugger trace opt-in. Normal
  gameplay now leaves `instructionTraceHook` disabled, avoiding the register
  snapshot allocations that caused long-run garbage-collection pressure. The
  trace is enabled automatically for breakpoints, stepping, and `runUntilPc`,
  while illegal-opcode detection and breakpoint PC hooks remain available
  independently. The debug mode is exposed through the main-thread and Worker
  app APIs and is reported in `debugState`.

- 2026-10-17: remapped the keyboard joystick triggers from Alt to Control in
  native A8E, jsA8E, and the legacy native input path. Left Control now drives
  TRIG0 and Right Control drives TRIG2; the browser UI, automation joystick
  events, README mappings, and the joystick regression test use the same
  mapping. Alt no longer activates a joystick trigger.

- 2026-10-17: fixed the browser recoverable-Trash view when jsA8E uses the
  Worker backend. The Worker snapshot now transports trash records and the
  proxy exposes `listTrash`, restore, and purge operations, so the UI can
  register the Trash button and keep its actions functional across both
  backends. The Worker proxy regression now covers the snapshot and restore
  boundary.

- 2026-10-17: fixed browser Full Library export when jsA8E uses the Worker
  backend. Export progress/cancellation callbacks and AbortSignals were being
  included in the `postMessage` payload, causing the browser structured-clone
  failure `Function object could not be cloned.` The Worker payload now keeps
  only serializable package options, with a regression covering the export
  request boundary.

- 2026-10-17: fixed `publish-tauri.yml` so the rolling `tauri-latest` release
  no longer force-moves a shared Git tag. The release action now updates the
  existing prerelease assets in place with `overwrite_files: true`; the tag is
  created only on first release creation and remains immutable. The release
  body continues to record the exact `GITHUB_SHA` used to build the packages.
  This prevents local clones from receiving conflicting `tauri-latest` tag
  updates during normal synchronization.

- 2026-10-16: opened the separate real-hardware validation project in
  `implementation/REAL_HARDWARE_VALIDATION.md`. It is a session handoff for
  PAL/NTSC Atari 800 XL measurements covering POKEY/SIO, ANTIC/GTIA, raster
  effects, audio, and representative ATR/XEX software. It records the required
  hardware/capture setup, existing AHRM-07/AHRM-08 fixtures, evidence format,
  and signoff criteria. Until that project is completed, public status remains
  “AHRM-aligned and contract-tested,” not fully hardware-certified.

- 2026-10-16: documented the explicit AHRM alignment boundary for the current
  POKEY, SIO, ANTIC, and GTIA updates. Serial holding/shift-register timing,
  SIO response phases and supported high-speed paths, sector geometry,
  `STATUS`/`FORMAT`/write verification, ANTIC/GTIA DMA and priority behavior,
  and the `CHBASE` delay are AHRM-based and covered by native/JavaScript
  contract tests. Mounting D1:-D8:, dirty/activity state, XEX conversion,
  persistence, tracing, and Full Library behavior are emulator integration,
  not hardware-compliance claims. AHRM-07 is certified only for its stated
  synthetic PMG/GTIA scope; broader real-title and PAL/NTSC comparisons,
  analog POKEY calibration, and the accepted jsA8E P1 CPU/POKEY phase remain
  open validation work.

- 2026-10-15: completed explicit age-based trash purge in browser and native
  Full Library surfaces. Both implementations accept a caller-selected cutoff,
  require confirmation in the UI, purge only older recoverable records, and
  keep automatic retention policy optional; native repository regression
  coverage verifies the cutoff and purged-count contract.

- 2026-10-15: hardened the native age-based trash UI for narrow `time_t`
  platforms by clamping pre-epoch cutoffs before age arithmetic, preserving
  the same no-match behavior as the browser implementation for very large
  retention ages.

- 2026-10-15: clarified the Full Library conflict-status documentation. The
  browser and native paths now explicitly document their implemented
  non-destructive conflict classification and preservation, while leaving
  local/imported/merged interactive choice open as a product decision because
  ATR/XEX payloads have no generic safe three-way merge.

- 2026-10-15: aligned imported name-collision handling with ordinary
  filesystem suffixes in both Full Library implementations. A colliding
  `file.atr` now becomes `file(1).atr`, then `file(2).atr`, scoped to the
  destination folder and preserving the original extension; JavaScript and
  native package regressions cover the policy.

- 2026-10-15: recorded the explicit conflict policy for Full Library imports:
  divergent binary ATR/XEX content is always kept on both sides, with the
  incoming copy receiving the filesystem-style numeric name suffix. This
  avoids an unsafe generic three-way merge while retaining every payload.

- 2026-10-15: completed the package-operation progress/cancellation contract
  in both Full Library implementations. Browser export, preview, and import
  report phase/item progress and honor AbortSignal or callback cancellation;
  the panel exposes a Stop action. Native keeps the original package APIs,
  adds callback variants for complete/workspace export and import, reports
  validation/merge progress, and cancels before staged repository commits;
  the focused native Library window now maps Escape to that callback.
  Regression coverage verifies callback delivery, cancellation errors, and
  unchanged native repository state after a canceled import.

- 2026-10-15: completed the cross-surface revision summary in the Library
  status bars. Browser selection shows preferred revision, history count,
  modification time, dirty state, and mounted device; native repository
  records now parse retained-revision metadata and the SDL window shows the
  same compact information for library and ATR views.

- 2026-10-15: completed the native package preview/confirmation path. The
  repository exposes a non-mutating `.a8e` summary API; SDL keyboard imports
  and package drops now show new, duplicate, conflict, folder, payload, and
  restorable-workspace counts before asking for confirmation, including
  newer/older/concurrent revision categories and name collisions. Both paths
  reuse the staged non-destructive merge, warn when the package library
  version is newer, and restore workspace mounts only after a successful
  commit; canceling the confirmation leaves dirty local media unflushed.
  Native preview folder/name counts now resolve the mapped nested hierarchy
  by parent/name, matching the actual merge even when package and local IDs
  differ; the repository probe covers that case.

- 2026-10-15: aligned the browser package confirmation with the native
  preview summary. The browser prompt now includes new folders, renamed
  entries, transported revisions, unique payloads, and restorable mounts;
  package planning counts the content-addressed payload paths and regression
  coverage verifies the count for both ordinary and revision-bearing exports.

- 2026-10-15: completed configurable package-size guards in both surfaces.
  `.a8e` readers and writers now enforce archive, manifest, per-payload, and
  aggregate-payload limits before import or export; browser callers use the
  four `max*Bytes` options and native callers use
  `A8E_LibraryPackageLimits_t` through the package/repository `WithLimits`
  APIs. Default limits and rejection regressions are covered natively and in
  the JavaScript package test.

- 2026-10-15: completed forward-compatible schema handling for additive
  package fields. Both readers now accept schema versions newer than v1 when
  the known required structure remains valid, preserve the non-destructive
  import path, and expose a warning that unknown fields are ignored; invalid
  older/zero schema versions remain rejected. Browser and native regressions
  cover the warning/version reporting.

- 2026-10-15: aligned browser package-import name conflict handling with the
  folder-scoped native policy. Equal names in different folders now remain
  valid; only collisions within the mapped destination folder are renamed.
  The package regression covers both the preserved nested name and a root
  collision.

- 2026-10-15: completed non-destructive native package merging. Existing local
  records and folders now survive `.a8e` imports; equal hashes deduplicate,
  divergent stable IDs become recoverable imported conflict copies, folder
  hierarchies are remapped beneath sibling-safe IDs, referenced payloads are
  staged atomically, and unoccupied workspace slots may be restored. The SDL
  window now unmounts old media only after a successful import, so a failed
  package leaves the active workspace intact. The native repository probe
  covers local preservation, a divergent same-ID import, and a nested imported
  folder.

- 2026-10-15: completed native SDL drag-and-drop ingestion for direct ATR/XEX
  files, complete `.a8e` packages, and recursive directories. Dropped folders
  recreate nested repository folders, preserve folder-scoped duplicate checks,
  import content-addressed blobs atomically, and do not traverse POSIX symbolic
  links. `library_repository_probe` now covers empty-directory initialization,
  direct image import, payload identity, and duplicate rejection.

- 2026-10-15: completed explicit retained-revision promotion in both Library
  surfaces. Browser history actions select a retained revision transactionally;
  native `Y` accepts a revision ID, unmounts affected media, preserves the
  displaced current bytes in history, updates `preferredRevisionId`, and
  reloads the repository. Native repository probes cover payload/hash checks,
  metadata promotion, and persistence.

- 2026-10-15: added compact keyboard navigation to the native Library list.
  Up/Down, PageUp/PageDown, Home/End, and Enter now move through filtered
  folder/trash rows and activate folders or ATR entries without requiring a
  mouse; the existing keyboard action shortcuts remain unchanged.

- 2026-10-15: added crash-loss mitigation for mounted native Library media.
  Dirty mounted images are now persisted at a five-second cadence as well as
  on eject and shutdown, and the AtariIo dirty latch is cleared only after a
  successful repository commit. Browser debounced flushes and IndexedDB
  transactions remain the corresponding browser-side recovery path.

- 2026-10-15: completed the recoverable trash workflow in both Library
  implementations. Browser deletes atomically move entries into a dedicated
  IndexedDB trash store; the UI provides a trash view, restore actions, and
  purge-all. Native deletes move records into the optional manifest `trash`
  array; `B` opens it, `R` restores to the current folder, and `P` purges the
  selected record. Restores guard name collisions and purges remove payloads
  only after all active and retained-revision references disappear. Package
  exports strip trash records and blobs in both implementations.

- 2026-10-15: added read-only storage-capacity reporting to both Library
  surfaces. Browser exposes `getStorageEstimate()` and a database toolbar
  action using the StorageManager estimate when available; native exposes `H`
  and reports free/used space for the `library` volume using the platform
  filesystem API. Unsupported/unavailable estimates leave library contents
  unchanged.

- 2026-10-15: completed native size/modified sorting for the Full Library
  compact list. `S` now cycles name, type, ascending payload size, and newest
  modification time while retaining deterministic name tie-breaks. The
  repository parser carries optional `modifiedAt` metadata from schema-v1
  records, with an empty fallback for older manifests.

- 2026-10-15: completed native compact-list sorting with `S` for name/type,
  alongside the existing `T` type and `Q` mount-state filters. Sorting is
  applied after folder/search filtering and keeps folder rows at the top.

- 2026-10-15: completed the native side of the Library type/status filter
  slice. `T` cycles all/ATR/XEX and `Q` cycles all/mounted/unmounted while
  preserving folder navigation and search; the browser already exposes the
  equivalent selectors. Both filters are read-only and reset the list scroll.

- 2026-10-15: import planning now merges previously unseen revision records
  into an existing same-ID/same-content entry inside the same IndexedDB
  transaction. Divergent content still remains a separate conflict copy, and
  the preview counts history updates as transported revisions.

- 2026-10-15: enriched browser import previews with newer/older/concurrent
  conflict counts and the number of transported revisions. The confirmation
  dialog now exposes those categories before the atomic commit; the existing
  non-destructive conflict-copy policy is unchanged.

- 2026-10-15: browser directory uploads now recreate `webkitRelativePath`
  subfolders beneath the current library folder instead of flattening them.
  Folder-scoped duplicate checks now match native behavior, so equal display
  names are allowed in different folders while sibling collisions remain
  guarded. Existing single-file uploads and replacements retain their prior
  behavior.

- 2026-10-15: added portable schema-v1-compatible revision history. Browser
  entries now retain revision bytes and parent/preferred IDs across IndexedDB
  persistence, flushes, replacements, exports, and imports; packages validate
  and deduplicate revision blobs, and native working-copy saves retain the old
  content as a revision blob in the manifest instead of deleting it. Native
  removal now prunes all unreferenced historical blobs. Stable-ID conflicts
  therefore remain recoverable on both sides; explicit revision promotion is
  now covered by the browser and native surfaces. Interactive three-way
  merging remains future work. Package, disk library, and native repository
  tests cover the round trip.

- 2026-10-15: connected native ATR integrity diagnostics to the SDL Library
  window with `V` for the selected ATR. The browser and native user surfaces
  now both expose the same non-destructive verification operation; XEX rows
  are explicitly rejected by the ATR-only action.

- 2026-10-15: added browser Full Library sorting and type/status filters.
  The persistent list now exposes ATR/XEX, mounted/dirty/clean filters and
  name/type/size/modified ordering while retaining folder search and selection
  behavior. The native SDL list already reports type and mount state in its
  compact rows; its keyboard surface remains intentionally small.

- 2026-10-15: added a separate workspace export path to the Full Library
  package model. Browser `exportWorkspacePackage` and the native
  `A8E_LibraryRepository_ExportWorkspacePackageFile` include only entries
  assigned to D1:-D8:, their referenced blobs, the required folder ancestry,
  and the existing workspace assignment. The browser marks these packages
  with `scope: "workspace"` and defaults the filename to `workspace.a8e`;
  complete-library exports remain unchanged. The browser package and disk
  library tests and the native repository probe pass.

- 2026-10-15: completed the Full Library diagnostic ATR integrity slice in
  both implementations. `jsA8E` and native A8E now expose the same read-only
  verification model: ATR geometry, DOS 2.x/MyDOS VTOC limits, active
  directory records, reserved/out-of-range sectors, complete sector-chain
  termination, cycles, duplicate allocation, and used-byte limits are
  checked without modifying the image. Unknown filesystems remain usable but
  report a warning. The browser library exposes `verifyFile` and `verifyLibrary`
  and the ATR rows provide a shield action; native A8E exposes
  `A8E_LibraryImage_VerifyAtr` and its report structure. The JavaScript ATR and
  disk-library tests plus the native image probe pass.

- 2026-10-15: completed the first native Full Library folder-editing slice.
  The native repository now loads schema-v1 `folders` records, supplies
  persistent create/rename/delete-empty-folder operations, moves and renames
  entries while preserving stable IDs, and keeps older manifests without a
  `folders` array compatible by treating them as the `root` folder. The SDL
  Library window now navigates child folders and `..`, creates folders with
  `F`, renames the selected folder or entry with `R`, moves the selected entry
  into the current folder with `M`, and deletes only empty folders. Blank ATR
  creation also places the new entry in the current folder. The native
  repository probe covers the folder round trip, name changes, moves, and
  guarded deletion; the four native library probes, complete native target,
  and JavaScript automation suite pass.

- 2026-10-13: opened `ATR/prince_of_persia.md` for a reproducible Prince of
  Persia intro graphics regression. The presentation with music was observed
  as distorted after rebuilding from `main` on Windows and again after
  compiling A8E on openSUSE 16. Windows inspection found the expected static
  SDL2 `2.32.10#1` package from vcpkg, and the generated `main` project did not
  link the stale Full Library object files that remained in the shared build
  directory. The cross-platform reproduction therefore makes an external
  Windows library/backend mismatch unlikely and moves the investigation to a
  common ANTIC/GTIA/CHBASE/CPU timing regression. A clean isolated build,
  exact platform/profile capture, and title-level raster comparison remain
  pending; no fix or title-specific workaround was added.

> Hardware emulation reference: Before implementing any Atari 800 XL PAL/NTSC hardware emulation, use the [AHRM](/AHRM/index.md) as reference.

Simple implementation notes for this repository.

- 2026-10-12: corrected native A8E SIO command-phase sequencing. The host
  now raises the active-low CB2 command line immediately after the fifth
  command byte and before checksum/parameter handling, matching AHRM 9.1 and
  the already aligned jsA8E bus model. This is a generic SIO electrical-state
  correction used by all addressed devices, not a Last Squadron-specific
  workaround. A native diagnostic run with Last Squadron also completed the
  previously failing sector-657 read and continued issuing valid reads
  without a Disk Error or unsupported-command response.

- 2026-10-12: command-line ATR/XEX boot media now take precedence over the
  persisted library workspace. When a positional image is supplied, the
  library no longer restores its D1: assignment over that image; D2:-D8:
  continue to restore normally, and the explicit medium is kept outside the
  library panel's mounted-entry bookkeeping.

- 2026-10-12: aligned native GTIA mode 10 playfield/PMG composition with
  jsA8E and the AHRM priority model. The native per-pixel priority buffer is
  now 16-bit, mode 10 colors retain their PM0/PM1/PM2/PM3 pseudo-priority
  bits, and player/missile masks include those bits when PRIOR selects a
  mode-10 interaction. Background and clipped-border rendering preserve
  mode-10 PMG pixels instead of treating them as ordinary background. This
  is a generic GTIA representation change, not a Last Squadron-specific
  condition.

- 2026-10-12: aligned native A8E CHBASE raster timing with jsA8E and AHRM
  4.4. The pending character-base latch now starts two color clocks after
  the final 6502 bus cycle of the write, rather than from the beginning of
  the instruction. This preserves rasterized character-set changes used by
  programs such as Last Squadron.

- 2026-10-12: aligned native A8E and jsA8E SIO transmission with the AHRM
  5.6 POKEY output holding/shift-register model. SEROUT writes now queue one
  byte, DATA NEEDED loads the shift register, and the virtual SIO device sees
  the byte only when its ten-bit transmission completes. This preserves the
  one-byte replacement behavior and resets the pending output state when
  POKEY enters initialization. Also handled the XL/XE first-byte checksum
  race documented in AHRM 5.10: an invalid command addressed to a mounted
  virtual disk receives NAK so the OS can retry, while invalid frames for
  absent device IDs remain silent as required by AHRM 9.1. Last Squadron was
  exercised for 120 million jsA8E cycles without a dropped command; native
  compilation remains pending because the local MSBuild FileTracker fails
  with Access denied before compilation.

- 2026-10-12: native Library package import now resolves a relative input
  path from the process working directory first and then from the executable
  directory. This lets `library.a8e` be imported when it is beside A8E even
  when Windows starts the executable with a different working directory.

- 2026-10-12: native Library package open failures now include the exact path
  passed to `fopen`, and also log that path to stderr. This distinguishes a
  missing package/path-resolution problem from a later package validation
  error during desktop import.

- 2026-10-12: native Library path commands now discard the command key's
  queued SDL text-input event. Pressing `I`, `E`, `N`, or ATR-view `D` no
  longer prefixes the user-provided path or filename with that command letter.

- 2026-10-12: expanded the native Library window's 5x5 glyph table with a
  real blank-space glyph and common filename punctuation. Previously every
  unsupported character, including spaces, was rendered as `?`, which made
  imported library names and status text appear corrupted.

- 2026-10-12: widened the native Library filename column by compacting and
  moving the drive columns, and added ellipsis truncation at the filename
  boundary. Long names no longer draw over the type or drive cells.

- 2026-10-12: optimized native workspace persistence. Mount, unmount, and
  write-protection changes now atomically rewrite only `library.json`; they no
  longer reload or rewrite every ATR/XEX blob in the repository.

- 2026-10-12: extended native `A8E -h` output with the Atari console-key
  mappings: F1 HELP, F2 OPTION, F3 SELECT, F4 START, and F5 RESET.

- 2026-10-12: aligned the native ATR directory headers and values by using
  shared explicit positions for SECT, START, and STATE instead of relying on
  manual spaces in one header string.

- 2026-10-12: added a three-pixel gap before the ATR SECT column and shifted
  the following directory columns together, keeping their headers and values
  aligned while separating them from filenames.

- 2026-10-12: increased the ATR directory-column offset by another three
  pixels after visual verification, preserving the shared header/value spacing.

- 2026-10-12: corrected the native Library 5x5 `A` glyph's second row from
  `0x05` to `0x11`, restoring the symmetric `#...#` diagonal pattern.

- 2026-10-12: added a native `A8E -h`/`A8E --help` path that exits before
  SDL or emulator initialization. The help output documents all command-line
  arguments, function/system keys, and the native Library window controls.

- 2026-10-12: connected the native A8E floating Library window to the shared
  ATR inspection core. Clicking an ATR opens a read-only directory/geometry
  view; Enter previews a selected DOS 2.x/MyDOS file as ATASCII or hexadecimal,
  D downloads it to a typed path, and unrecognized filesystems expose a raw
  hexadecimal view. No ATR bytes are modified by this UI path.

- 2026-10-11: completed the jsA8E Assembler Editor icon-only toolbar update by
  removing the dynamic Pause/Continue text from the shared debug button while
  retaining its state-specific tooltip and ARIA label.

- 2026-10-11: compacted the jsA8E HostFS, Assembler Editor, and Snapshots
  toolbar buttons to icon-only controls, matching the Disk Library treatment.
  Existing hover titles remain the visible function help and explicit ARIA
  labels preserve accessible names without changing any action handlers.

- 2026-10-11: aligned native A8E STATUS response queuing with jsA8E. The
  native virtual drive now resets the SERIN response index and schedules the
  complete seven-byte STATUS frame through the common response helper. This
  preserves the same response-phase behavior used by PicoDOS while keeping
  the AHRM 9.1/10.2 drive contract unchanged.

- 2026-10-11: aligned native A8E's `$3F` high-speed index response with AHRM
  9.1 and jsA8E. The disk read command now returns `ACK` first and queues the
  separate `Complete + divisor + checksum` data phase, instead of exposing all
  four bytes as one response. This preserves the SIO phase boundary used by
  MyPicoDOS during automatic high-speed negotiation.

- 2026-10-11: fixed native A8E window shutdown. SDL reports the operating
  system close-button action as `SDL_WINDOWEVENT_CLOSE`, not necessarily as
  `SDL_QUIT`; the main window now exits through the normal cleanup path while
  the separate Library window continues to close without terminating A8E.

- 2026-10-10: aligned the native and JavaScript virtual drives with AHRM
  10.1/10.2 for non-DD geometries and controller status. 512-byte-sector
  media now uses native-size transfers from sector 1 in both implementations,
  with the matching status marker; successful PUT, WRITE, VERIFY, and FORMAT
  operations update the per-drive inverted FDC status latch. Added native and
  JavaScript regressions for the geometry and post-write STATUS behavior.

- 2026-10-10: kept jsA8E Disk Library mounted-device rows on one horizontal
  grid row after adding separate activity, read/write, and unmount controls.
  This is presentation-only and does not affect SIO behavior or the library
  package contract.

- 2026-10-10: corrected generic US Doubler response timing in native A8E and
  jsA8E. AHRM 10.5 specifies drive-side transmit timing independently from
  the computer's POKEY receive clock; high-speed response bytes now use the
  approximately 220-cycle US Doubler byte interval instead of the POKEY
  receive period. The `$0A` capability remains advertised only for the generic
  divisor supported by both implementations.

- 2026-10-10: constrained automatic high-speed SIO detection to the generic
  protocol implemented by the virtual drives. AHRM 10 distinguishes the US
  Doubler timing from device-specific Turbo, XF551, and other protocols; the
  native and JavaScript implementations now answer only the standard divisor
  `$28` and US Doubler divisor `$0A` when Timer 3+4 are linked. Unsupported
  probe timings remain silent. This prevents MyPicoDOS from classifying a
  standard drive as 1050 Turbo and using `DAUX2` bit 7 as a sector bit on
  disks larger than 32,768 sectors.

- 2026-10-10: corrected the remaining MyPicoDOS 4.05 detection path. AHRM
  10.3 defines bit 7 of `DAUX2` as the 1050 Turbo high-speed marker, while
  normal 16-bit sector numbers use that same bit only on sector commands.
  Native A8E and jsA8E now NAK a Turbo-marked `STATUS` probe because the
  generic virtual drive does not implement Turbo mode. This prevents the
  detector from selecting Turbo and subsequently reading sector 360 as
  sector 33128, without restricting valid standard reads above sector 32767.

- 2026-10-10: aligned native and JavaScript SIO response timing for drives that
  advertise US Doubler high speed. AHRM 5.6 defines a serial byte as twenty
  half-bit clock periods; response bytes now use the active POKEY Timer 4
  divisor instead of a fixed 900-cycle interval. Native A8E also flushes its
  virtual SIO transaction state when SKCTL enters POKEY initialization, matching
  jsA8E and preventing stale bytes from surviving a PicoDOS speed negotiation.

- 2026-10-10: corrected native A8E handling of unsupported disk commands.
  The `$48` Happy-drive extension is not part of the standard virtual disk
  command set; AHRM 9.1 requires a recognized drive to return `NAK` for such
  a command. A8E previously logged `Unsupported SIO command $48!` and stayed
  silent, which made DOS wait for its timeout and report a disk error. Native
  and JavaScript regressions now cover the immediate NAK behavior.

- 2026-10-10: connected mounted-library activity indicators to real SIO
  operations in both applications. jsA8E now shows a short green `*` for
  reads and yellow `*` for writes/formats beside each mounted device. Native
  A8E records the same operation state per D1:-D8: slot with a bounded visual
  lifetime and colors the mounted drive marker accordingly. The activity
  state is UI-only and does not alter SIO timing, dirty persistence, or the
  library package contract.

- 2026-10-09: generalized jsA8E's logical SIO sector geometry. DD ATR media
  uses 128-byte transfers only for logical sectors 1-3 and 256-byte transfers
  thereafter through sector 65535; 512-byte logical devices retain their
  native transfer size even for sector 1. This follows AHRM 10.1/10.3 and is
  covered by direct 16MB DD and 512-byte-sector regressions.

- 2026-10-09: `jsA8E/js/core/pokey_sio.js` now records an opt-in
  `SIO_COMMAND_DROPPED` trace event whenever a command frame has an invalid
  checksum. The device remains electrically silent as required by AHRM 9.1;
  the trace includes the frame fields, calculated checksum, received checksum,
  and reason solely to diagnose boot-time framing failures. The SIO regression
  verifies both the silence and the diagnostic record.

- 2026-10-09: exposed the bounded SIO diagnostic trace through the browser
  app proxy and Worker debug API. It retains the latest 128 SIO events and is
  observational only, allowing remote boot investigation without changing
  SIO responses or media state. Valid command frames include their source CPU
  PC and a bounded 6502 stack snapshot, which distinguishes the XL/XE OS's
  normal post-boot Type 3 poll from a disk protocol failure and identifies the
  SIOV caller even when output is serviced by an IRQ handler.

- 2026-10-09: corrected jsA8E STATUS handling per AHRM 10.2. Byte +1 is now
  a per-drive, inverted FDC-status latch rather than a fixed media-ready
  value: it begins in the reset state and changes after a completed sector
  operation. The four-byte status payload checksum is calculated from that
  live state. The format timeout remains `$E0`, as required for realistic
  FORMAT behavior. This restores boot compatibility without misreporting a
  successful FDC transfer before one has occurred.

- 2026-10-10: mirrored the AHRM 10.2 STATUS controller-state model in native
  A8E. Its per-drive FDC latch resets when media is mounted or unmounted,
  records a successful sector read, and is checksummed as part of the live
  STATUS payload. This keeps native A8E aligned with jsA8E and restores the
  same boot compatibility without lowering the `$E0` format timeout.

- 2026-10-08: started the Full Library implementation on branch `FullLibrary`.
  Added a dependency-free ZIP method-0 archive codec to both `jsA8E` and
  native A8E for the frozen `library.json` v1 package contract. The codec
  validates UTF-8 paths, CRC-32, central-directory consistency, duplicate and
  unsafe paths, and corruption. A shared deterministic ZIP fixture is read and
  produced by both implementations. The JS suite, full native A8E target, and
  all 13 native CTest probes pass in an isolated Visual Studio/NMake build.
  The pre-existing `build/msvc` solution still has an environment-specific
  MSBuild `FileTracker` `Access denied` failure during its incremental build.

- 2026-10-08: added the first portable package layer on top of the ZIP codec.
  Both applications validate the frozen manifest contract, compute SHA-256
  content identities, and read/write `library.json` plus content-addressed
  `blobs/` entries. jsA8E disk-library instances can export their current
  records and inspect packages through both main-thread and Worker paths;
  native A8E exposes the matching package API and CTest probe. Import is still
  validation-only and does not mutate storage until the atomic migration layer
  is implemented. Also corrected the native ZIP writer's central-directory
  size calculation, which had been measured after the end record began.

- 2026-10-09: implemented the next Full Library import slice in both
  applications. jsA8E now separates non-mutating preview from commit, detects
  equal-hash duplicates, preserves differing stable-ID content as renamed
  conflict copies, restores available D1:-D8: assignments, persists the
  incremented `libraryVersion`, and commits imported entries plus metadata in a
  single IndexedDB transaction. The Disk Library panel now exposes complete
  Export Library and Import Library actions. Native A8E adds an SDL-independent
  staged package store that validates complete packages and merges them into the
  persistent repository without replacing local records. JS and native
  regressions cover conflicts, invalid-package rollback, and unchanged state
  after a failed import.

- 2026-10-09: manually validated the browser workflow on the Full Library
  branch: export the complete library, remove the local contents, and import
  the exported package again. The library was restored successfully, providing
  the first practical end-to-end confirmation of the package flow.

- 2026-10-09: implemented the first compact navigation slice in jsA8E.
  IndexedDB now has a folder store with a root-folder migration for older
  entries; the package manifest can carry optional folders and entry
  `folderId` values; the Worker proxy carries folder snapshots and folder
  mutations; and the Disk Library UI supports the current path, `..`,
  clickable folders, new folders, upload-to-current-folder, classic D1:-D4:
  controls, and per-file download/delete actions. The core continues to retain
  D1:-D8: for package and newer-software compatibility, while D5:-D8: remain
  hidden in this DOS-oriented view. The native package probe accepts the same
  optional folder metadata. The complete JavaScript automation suite and
  folder/package regressions pass. Native incremental compilation could not be
  rerun in this session because `build/msvc-nmake` lacks `nmake`; the existing
  `build/msvc` environment still has the unrelated MSBuild FileTracker access
  failure.

- 2026-10-09: refined the compact navigation layout so the parent-folder
  action is represented only by the `..` row inside the file table. The current
  path remains visible in the panel header, with no separate folder-up row
  between the header and toolbar.

- 2026-10-09: exposed the folder organization operations in the jsA8E view.
  Files can be moved to a selected folder without changing their stable ID,
  bytes, mount state, or metadata; folder rows support rename and safe deletion
  only when empty. The existing core/proxy/Worker move path is now reachable
  from the UI through the per-file folder action.

- 2026-10-09: removed right alignment from the Disk Library action column so
  the per-file action icons, including the trash button, remain fully visible.

- 2026-10-09: simplified the visible Disk Library panel title to `Disk
  Library`; drive support remains represented by the D1:-D4: columns and the
  internal D1:-D8: model.

- 2026-10-09: added the jsA8E mounted-devices panel above the navigation list.
  It derives occupied D1:-D8: slots from the library snapshot, displays each
  mounted folder/file path, and provides an `Unmount` action. Live green/yellow
  SIO activity indicators remain a subsequent integration step.

- 2026-10-09: added interactive global search to the jsA8E Disk Library.
  Typing filters all ATR/XEX names case-insensitively by substring, presents
  matches as a virtual-folder view, shows each original folder path, and keeps
  the normal mount/download/move/delete actions available.

- 2026-10-09: placed the mounted-devices panel before the library action
  toolbar, so the panel order is header, mounted devices, actions, and file
  navigation.

- 2026-10-09: compacted the jsA8E Disk Library toolbar to icon-only controls.
  The existing hover titles remain available as native tooltips and every
  control now exposes an explicit ARIA label. The toolbar stays on one row and
  scrolls horizontally when the panel is narrower than the complete action set.

- 2026-10-09: added the first cross-application ATR inspection core for Full
  Library. jsA8E and native A8E now validate ATR geometry, inspect the DOS 2.x /
  MyDOS-compatible VTOC and directory layout without modifying image bytes,
  enumerate active directory entries, follow standard DOS sector chains for
  read-only file extraction, and decode basic ATASCII text. The browser worker
  loads the same inspector, and synthetic DOS-directory regressions cover both
  recognized and unrecognized ATR images.

- 2026-10-09: connected the read-only ATR inspection core to the jsA8E Disk
  Library. Clicking an ATR name or its open action changes the same panel to a
  contents view with Back, image download, geometry/filesystem status, DOS
  directory entries, internal-file download, ATASCII preview, and hexadecimal
  fallback for unrecognized images. The native A8E floating Library window
  still requires its platform-specific UI adapter.

- 2026-10-09: constrained the ATR file preview to one reusable, shrinkable
  panel with internal scrolling and an explicit hidden-state display rule. Repeated
  previews no longer reserve cumulative page space.

- 2026-10-09: began the native A8E multi-drive backend required by the
  floating Library window. IoData now owns independent D1:-D8: media slots,
  writable/dirty state, names, and mount/unmount/access APIs; native SIO
  selects the addressed slot from the command Device ID and enforces the
  slot's write-protection state. The D1 command-line compatibility buffer is
  preserved. Persistent native repository loading and the SDL Library window
  remain pending, and native compilation could not be run because this
  environment has no C compiler in PATH.

- 2026-10-09: added the native persistent Full Library repository adapter.
  A8E now loads and saves the documented `library.json` plus
  content-addressed `blobs/` directory, stages a complete snapshot before
  replacing the visible repository, and reuses the portable package validator
  for SHA-256, size, path, and schema checks. The repository probe covers a
  save/load round trip. The SDL Library window and its connection to mounted
  IoData slots remain pending; native compilation is still unavailable in this
  environment.

- 2026-10-09: connected the native repository snapshot to A8E startup. When
  `library/library.json` exists, the native application validates and loads
  it, restores the workspace D1:-D8: assignments, applies per-device write
  protection, and leaves the command-line D1: path as the fallback when no
  workspace assignment is present. Native library XEX entries are converted
  to the same bootable ATR working image used by the command-line loader.
  Dirty working-copy flush and the SDL Library controls remain pending.

- 2026-10-09: added the first native SDL Library window adapter. F9 toggles a
  floating, dependency-free repository view; the window lists ATR/XEX entries,
  shows D1:-D8: mount cells, restores the startup workspace map, and lets the
  user click a drive cell to mount or unmount an entry. A logical entry is
  automatically removed from any previous drive before a new mount, preserving
  the single-device invariant. Import/delete/search controls and dirty-copy
  persistence remain subsequent UI slices.

- 2026-10-09: completed the first native editing slice. The SDL Library now
  supports case-insensitive substring search, keyboard Delete with mounted
  media protection, right-click runtime write-protection toggling, and dirty
  working-copy saves on eject and emulator exit. The repository updates the
  content-addressed blob, manifest path/size/hash, modification timestamp, and
  libraryVersion through a staged save/reload path. A8E XEX mounts continue to
  use the shared bootable ATR conversion path.

- 2026-10-09: persisted native runtime workspace changes. Mount, eject, and
  write-protection changes in the SDL Library now update the schema-v1
  `workspace.devices` and `workspace.writeProtected` maps through a staged
  repository save/reload, while enforcing the one-entry/one-device invariant.
  The native delete path also preserves the entry name before repository
  reload, avoiding a stale-record access when reporting the result.

- 2026-10-09: connected native `.a8e` package interchange and blank-disk
  creation. The SDL Library accepts `I` (import), `E` (export), and `N` (new
  blank ATR), with a dependency-free path/name prompt confirmed by Enter and
  cancelled by Escape. Package import validates the complete archive before
  merging it into the local `library/` directory; export uses the same
  canonical `library.json` plus content-addressed blobs used by jsA8E. A fresh
  native installation can create its first schema-v1 library from a blank ATR.

- 2026-10-09: made native entry deletion clean persisted workspace references
  as well as the library record and now require the native repository probe to
  verify that the deleted D1: assignment is absent after reload.

- 2026-10-09: normalized native XEX working copies when they are modified.
  Because an XEX is mounted through the shared bootable-ATR conversion path,
  the first dirty flush now changes its manifest type/path to `atr` instead of
  writing converted ATR bytes under an `.xex` blob name that would be parsed
  incorrectly on the next mount.

- 2026-10-09: adjusted the native SDL Library empty-state layout. Search input
  and package controls no longer overlap at the compact bitmap-font scale, and
  an empty repository now explains that `I` imports a package or `N` creates a
  blank ATR.

- 2026-10-09: tightened the native Library header/first-row spacing and
  shortened the empty-state marker to `EMPTY`, preventing it from spanning
  across the TYPE and drive columns at the fixed bitmap-font scale.

- 2026-10-09: widened normal Disk Library filename presentation by removing
  the unused search-path column from its layout and slightly reducing the
  visible D1:-D4: column widths. Search results retain a separate source-path
  column.

- 2026-10-09: recorded the new Full Library requirement for a `Create blank
  ATR` action. It belongs in the current-folder navigation toolbar and must
  create a valid writable ATR without replacing existing entries. The action
  is documented but not implemented yet.

- 2026-10-09: implemented `Create blank ATR` in jsA8E and added the matching
  native ATR image helper. The action creates a standard writable 90 KiB ATR
  (720 x 128-byte sectors) in the current folder, proposes a non-conflicting
  filename, persists it through the Worker/IndexedDB path, and makes it
  immediately mountable and exportable. Regression coverage verifies the ATR
  header and exact image size.

- 2026-10-09: corrected the SIO `$21` Format response in both jsA8E and
  native A8E. Formatting still clears the ATR data area, but now returns the
  required sector-sized bad-sector list after the command ACK; a healthy disk
  reports an empty list terminated by `$FFFF` (AHRM 10.4). This fixes DOS
  error 138, which was caused by the previous response ending before DOS could
  receive the format result. Added a jsA8E regression for the ACK/data phases.

- 2026-10-09: corrected two AHRM disk-protocol issues exposed by DOS 2.5
  `DUPLICATE DISK`. Both jsA8E and native A8E now report `$E0` as the STATUS
  format timeout instead of the invalid short value `$01`, preventing DOS
  from entering long retry waits when it formats another drive. `$57` WRITE
  now performs an in-memory readback verification before returning Complete
  or Error. Documented the observed approximately 20-second pauses as a
  protocol timeout symptom rather than normal disk latency.

- 2026-10-09: corrected the remaining AHRM write data-phase sequencing issue
  in both jsA8E and native A8E. PUT, VERIFY, and WRITE now return the data-frame
  ACK first and queue Complete/Error as a separate response after that ACK is
  consumed. This matches AHRM 9.1. The JS SIO regression now covers WRITE, PUT,
  VERIFY, and silent handling of invalid command checksums; the multi-drive
  design document was
  corrected to show the separate phases.
  The JavaScript automation suite passes; native build validation remains
  blocked before compilation by the existing MSBuild `FileTracker` access
  error in `ZERO_CHECK`.

- 2026-10-09: Chrome tracing of a clean jsA8E Worker during DOS 2.5
  `DUPLICATE DISK` isolated the remaining approximately 16-20 second pauses.
  Successful writes show `ACK -> valid data frame -> ACK -> Complete`; the
  paused attempts receive a data-frame `NAK` for `$57`, followed by the DOS
  retry timeout. AHRM 5.10 documents the corresponding Atari OS race: the
  first transmitted byte can precede `CHKSUM` initialization, allowing a SIO
  IRQ or VBI to corrupt the checksum; the drive correctly NAKs the frame and
  the older OS can wait through a long retry delay. This is therefore a
  documented guest timing/firmware behavior, not an ATR geometry mismatch or
  normal disk latency. Do not hide it by accepting bad checksums or by
  inventing a shorter device timeout. A remaining optional investigation is
  an AHRM-08 cycle-level comparison against Altirra/hardware to determine why
  the race frequency differs between hosts.

- 2026-10-09: marked the DOS 2.5 duplicate-disk pause investigation as
  pending while Full Library is completed. The complete evidence record is in
  `implementation/A8E_multi_drives.md`: FORMAT response, STATUS timeout,
  WRITE verification, and separate write ACK/Complete phases are fixed and
  tested; the remaining pauses are guest SIO checksum-race retries documented
  by AHRM 5.10. Any future timing correction must be cycle-level, AHRM-08
  based, and implemented in both jsA8E and native A8E.

- 2026-10-09: fixed Full Library export for distinct entries with identical
  binary content. Because blobs are content-addressed, those entries share
  one `blobs/<sha256>.<type>` payload; manifest validation and native package
  reading now accept repeated references while archive storage remains
  deduplicated. Added a jsA8E export/import regression and documented the
  shared-blob rule in the frozen library schema.

- 2026-10-07: corrected the generic jsA8E XEX preflight bank-map analysis. The
  Self-test window now follows the AHRM dependency on OS ROM being enabled, and
  INITAD PORTB tracking uses a conservative 6502 data-flow interpreter instead
  of matching an unrelated nearby immediate value. Added regressions for
  Rio Grande 3D's `LDA $D301` / `AND #$FE` / `STA $D301` sequence, OS-off
  Self-test RAM, and the existing protected-memory cases.

- 2026-10-07: aligned the native PIA model with the same AHRM Self-test rule.
  Native Self-test state now requires both PB7 clear and PB0 set, including
  the initial state derived from PORTB. Added a memory-expansion probe
  regression covering the OS-off transition.

- 2026-10-08: established cross-application parity as a project requirement.
  Every new capability must be implemented and tested in both `jsA8E` and
  native A8E. Platform-specific adapters are allowed, but shared behavior,
  data contracts, and regression coverage must remain aligned; a feature is
  incomplete while it exists in only one application.

- 2026-09-30: added an origin-scoped IndexedDB ROM library for user-provided
  Atari OS (16 KiB) and BASIC (8 KiB) files. Browser startup prefers optional
  server files and falls back independently to saved user files; new uploads
  replace the corresponding local record, and the secondary controls expose a
  delete action. When startup still lacks a ROM, a matching popup links to the
  file selectors. No ROM dump is added to the project.

- 2026-09-30: made the ROM-backed jsA8E headless regressions explicitly skip
  when the user-provided Atari OS/BASIC ROMs are absent. The public CI runner
  cannot distribute those ignored firmware images, while developer and native
  build environments that provide them still execute the guest-level checks.
  The native CI job likewise always compiles every probe but only runs CTest
  when those ROMs are supplied, preventing a public runner from reporting
  license-related missing firmware as an emulator regression.

- 2026-09-30: replaced the upstream GitHub workflows with fork-specific CI and
  publication flows. Validation runs native CTest probes and jsA8E automation
  tests on `main`, `web_publish`, and `Tauri`; GitHub Pages deploys only from
  `web_publish`; and pushes to `Tauri` rebuild DEB/RPM/AppImage assets and
  replace the rolling `tauri-latest` prerelease. The inherited FTP deploys,
  upstream release packaging, and automatic commits to `main` were removed.

- 2026-09-30: made the Linux Tauri packaging helper build and export `.deb`,
  `.rpm`, and `.AppImage` by default. `A8E_TAURI_BUNDLES` can still restrict
  the bundle list when the AppImage `linuxdeploy` toolchain is unavailable.

- 2026-09-30: updated `scripts/build-tauri-linux.sh` to export only current
  Linux packages to `dist/tauri/linux/`. It clears `src-tauri/target/` before
  the build to prevent stale bundle reuse and after export to remove all Tauri
  intermediates from `src-tauri/`; the script now comments each validation,
  build, export, and cleanup step. `dist/` is ignored by Git.

- 2026-09-30: made mobile toolbar state feedback click-driven rather than
  dependent on a sticky touch `:hover` state. Hover decoration now applies
  only to hover-capable pointers; taps show a pressed state and the existing
  `active` class immediately represents each toggle's on/off state.

- 2026-09-30: kept the mobile Help icon and primary lifecycle controls in one
  compact header row. The mobile controls no longer claim a full row, saving
  vertical space above the Atari display.

- 2026-09-30: fixed jsA8E mobile system-keyboard letters on composition-based
  keyboards such as Gboard. During composition, each input update now sends
  only its text delta to the Atari; replacement and deletion updates emit the
  required Backspace events first. The prior implementation waited for
  `compositionend`, so number and control keys could work while ordinary
  letters remained pending in the mobile keyboard.

- 2026-09-29: added a jsA8E mobile `Mobile` keyboard action that focuses a tiny editable
  input to open the Android/iOS system keyboard. Committed text is translated
  through the existing Atari key path, including ASCII symbols, Enter,
  Backspace, Tab, Escape, incremental composition input, and accent stripping
  where an ASCII equivalent exists. The full virtual Atari keyboard remains available
  for OPTION/SELECT/START/RESET and other special controls; the Type button
  reports its active state in the mobile action bar. While Mobile mode is active,
  the Atari display has an invisible touch surface that restores input focus
  without allowing the browser to scroll the page or close the system keyboard.

- 2026-09-29: recorded an intermittent long-run graphics occurrence in the
  jsA8E presentation/demo loop: after roughly 10–20 minutes, a large upper
  portion of the image showed repeated/corrupted graphics while execution
  continued. Prince of Persia was also observed to corrupt graphically after
  prolonged scene-loop activity, although the jsA8E glitch did not reproduce
  during several subsequent loops. A real Atari separately stopped on a green
  screen; that was a different symptom and is not evidence that the emulator
  glitch is caused by the accepted AHRM-08 P1 serial-divider phase deviation.
  No fix was added. Keep PMG/GTIA/ANTIC raster state and long-run timing as
  the follow-up investigation if the visual glitch becomes reproducible.

- 2026-09-29: increased the jsA8E virtual joystick dead zone from 5px to
  10px on each axis, reducing accidental diagonal activation while keeping
  the existing independent-axis and multi-touch direction behavior.

- 2026-09-29: changed the jsA8E browser defaults from PAL/64K to NTSC and
  128K (130XE). Explicit boot options, URL parameters, and saved local
  preferences still take precedence; native defaults and explicit 64K
  selections are unchanged.

- 2026-09-29: replaced the jsA8E CRT toolbar button text with a Font Awesome
  retro-TV icon. When the filter is disabled, the existing toggle state now
  adds a red slash overlay; title and ARIA labels remain unchanged.

- 2026-09-29: `jsA8E/{index.html,style.css,js/app/ui.js}`: added an adaptive
  mobile presentation below `980px`. The mobile toolbar keeps lifecycle and
  disk actions compact, the fixed bottom action bar opens joystick, keyboard,
  Disk Library, and HostFS, and the `More` sheet exposes CRT, turbo,
  fullscreen, ROM, assembler, snapshot, and machine settings. Tool panels open
  one at a time in a scrollable overlay; desktop layout presets and panel
  ownership are unchanged. Chromium validation at 390x844 confirmed the
  full-width screen, initial closed state, and fixed action bar.

- 2026-09-29: `jsA8E/{index.html,style.css,js/app/ui.js}`: synchronized the
  mobile `More` tool buttons with the active state of their real toolbar
  controls, including `aria-pressed` feedback. Moved the real Option-on-Start
  toggle next to Open Disk so its on/off state is visible in the compact mobile
  toolbar and remains backed by the existing boot configuration.

- 2026-09-29: corrected the linked POKEY audio divider in both cores: high
  underflow now reloads the low counter as well as the high counter (AHRM
  5.3), without generating an extra low-channel pulse. The 2026-09-28 change
  had left the low counter free-running every 256 ticks after its first
  period. Prince of Persia's in-game music was observed using an audible
  poly-4 low channel in linked 1+2 mode, exposing a fixed-pitch voice that
  the loading demo did not reveal. JS and native regressions check repeated
  low/high waveform edges for both linked pairs at 1.79 MHz, 64 kHz, and
  15 kHz. The full JS automation suite and all 12 native CTest probes pass.
  Timer IRQ/SIO scheduling is unchanged; auditory confirmation of the
  in-game melody remains separate from the passing divider contract.

- 2026-09-29: added a persistent CRT toolbar toggle in jsA8E. Disabling it
  renders the indexed framebuffer and palette directly to the WebGL canvas
  with nearest-neighbor sampling, bypassing all CRT post-processing. Both
  worker and main-thread paths apply the change immediately, including while
  paused; Canvas 2D retains its existing clean output. The full JS automation
  suite passes. Chromium checks verified exact clean palette pixels and
  CRT on/off/on switching in WebGL 1/2, plus paused UI toggling and saved
  preferences after reload in both worker and main-thread modes.

- 2026-09-29: normalized one stray CRLF blank line in
  `jsA8E/js/core/io.js`, so the alignment merge passes whitespace validation
  without changing PIA or console I/O behavior.

- 2026-09-29: alignment audit corrected the documentation boundary: AHRM-07
  is certified for its synthetic and visual diagnostic scope, while broader
  title-level comparisons remain regression work; AHRM-08 remains open only
  for analog calibration and the explicitly accepted P1 CPU/POKEY phase
  follow-up. `implementation/A8E/POKEY.md` now records implemented POT
  residual charge and live `ALLPOT` reassertion instead of the obsolete
  missing-feature statement. Linked audio pulses are explicitly outside the
  shared AHRM-09 waveform scope. `Pokey_DebugFrame` now prints `u32` fields
  with the correct `unsigned long` format, removing compiler format warnings.
  The full jsA8E automation suite and all 11 native CTest probes pass.

- 2026-09-29: completed the current AHRM-09 digital differential-harness
  scope. Shared JSONL fixtures now cover PIA/PORTB, POKEY timer/SIO/paddle/
  keyboard IRQ behavior, ANTIC/NMI timing, and AHRM 4.13 PMG `DMACTL`
  gating. Native and JS probes consume the same fixture for each new family;
  analog audio calibration and title-level visual comparison remain external
  reference work rather than synthetic digital contracts.

- 2026-09-29: `implementation/traces/antic_nmi_contract.jsonl` extends
  AHRM-09 with the AHRM 4.8 DLI boundary: both cores latch `NMIST` at cycle 7
  and deliver NMI at cycle 8. The existing native and JS late-NMIEN probes
  remain the expansion path for delayed and suppressed delivery cases.

- 2026-09-29: `implementation/traces/pokey_keyboard_irq_contract.jsonl`
  extends AHRM-09 with the AHRM 5.7/5.8 keyboard IRQ gate. Native and JS
  probes use the same masked/enabled `IRQEN` and `IRQST` outcomes. CPU IRQ
  pending remains runner-specific because the probes observe it at different
  CPU instruction boundaries.

- 2026-09-28: `implementation/traces/pokey_pot_contract.jsonl` extends the
  AHRM-09 differential harness to the AHRM 5.9 truncated paddle scan. Native
  and JS POT probes consume the same restart-after-64-counts contract and
  fail on a different final `POT0` or `ALLPOT` value.

- 2026-09-28: `A8E/Pokey.c` and `jsA8E/js/core/pokey.js` now preserve the
  AHRM 5.3 linked-timer low-channel audio path. The low channel emits its
  initial AUDF-derived pulse and subsequent 256-tick pulses while linked, is
  mixed normally, and channel 3 can still clock channel 1's high-pass latch.
  Linked modes remain cycle-stepped in JS so these intermediate transitions
  cannot be skipped by the independent-channel fast path.

- 2026-09-28: `A8E/{AtariIo.h,Pokey.c}` and
  `jsA8E/js/core/{state,pokey}.js` now retain per-channel POT residual charge
  across an early `POTGO`, per AHRM 5.9. A restarted scan subtracts the
  accumulated prior count from its threshold; slow-mode idle time applies a
  deterministic exponential-style discharge, while fast scan retains charge
  because its dump transistors are disabled. Native and JS POT probes verify
  the documented restart-after-64-counts result. The discharge curve is an
  approximation, not a hardware-voltage calibration.

- 2026-09-28: `A8E/Pokey.c`, `jsA8E/js/core/pokey.js`, and their matching
  POT scan probes now implement AHRM 5.9 continuous input behavior. A POT
  channel that had crossed its threshold reasserts its active-low `ALLPOT`
  bit and returns to the live counter if its input drops below threshold
  during the same scan; it relatches at the new threshold. The native C probe
  and JS test both cover crossing, reassertion, and relatching. Capacitor
  discharge after an early `POTGO` restart remains separate analog work.

- 2026-09-28: added an opt-in `ioData.pmgDmaTrace` seam in
  `jsA8E/js/core/gtia.js`. It records P/M DMA line, slot, source address,
  source byte, and resulting graphics latch only when a diagnostic installs a
  callback; ordinary emulation does not enter a trace path. The AtariBlast
  NTSC/RAMBO-1088K snapshot recorded 706 P0/P1 loads with zero source-to-latch
  mismatches, including its detached-fragment rows. This rules out a fixed
  vertical source-address offset and a lost P0/P1 latch load; continue at the
  generic GTIA shift/output stage. `gtia_pmg_dma_regression`, AHRM-07 XEX,
  and the AHRM-07 ROM boot regression pass.

- 2026-09-28: added `AHRM08_CPU_BOUNDARY_TEST.{asm,XEX,md}` for the short,
  non-production investigation of jsA8E's accepted P1 phase deviation. It
  compares `DATA NEEDED` polling after 2-, 3-, and 4-cycle instruction paths
  from the same `STIMER` setup. It is observational and must not be used to
  add a padding-specific offset; compare it with native A8E, Altirra, and
  hardware before changing CPU or POKEY timing.

- 2026-09-28: the first CPU-boundary XEX comparison reported `DATA NEEDED=00`
  for its 2-, 3-, and 4-cycle instruction cases in jsA8E, native A8E,
  Altirra, and hardware. It rules out that isolated instruction-width model
  as the explanation for jsA8E P1. Completion polling was `37` in jsA8E,
  Altirra, and hardware, and `35` in native A8E; treat that as a separate
  guest-polling observation. No production timing changed. Any follow-up must
  preserve the matrix fixture's exact P1 path and vary only its event boundary.

- 2026-09-27: certified the AHRM-07 PMG/GTIA visual diagnostic. The supplied
  NTSC/128K phase pairs show `P0/P1 COLLISION: PASS` and matching player DMA
  forms, PMBASE/HPOS/PRIOR transitions, and player/playfield mixing in
  Chromium/jsA8E, native A8E, and Altirra. The hardware TV image was too poor
  to archive, but was visually equivalent to Altirra in both phases. This
  closes AHRM-07 for the diagnostic's stated scope; AtariBlast's detached
  player fragments remain a separate real-content issue. AHRM-08 remains in
  progress only for the documented jsA8E P1 CPU/POKEY boundary deviation and
  analog/paddle refinement.

- 2026-09-27: corrected AHRM 5.7/5.8 POKEY IRQ gating in `A8E/AtariIo.c`
  and `jsA8E/js/core/{antic,input}.js`. Keyboard, timer, and SIO events now
  update active-low `IRQST` and assert the CPU only while their `IRQEN` bit is
  enabled; masked events are discarded while `KBCODE` still captures a key.
  The level-sensitive XMTDONE exception remains unchanged. Previously,
  disabled timer edges stayed falsely pending and the OS IRQ dispatcher
  repeatedly serviced them before the keyboard, so BASIC and Self Test did
  not receive host keys in either core. Native and JS gate probes cover a
  masked timer and keyboard, and the ROM-backed JS BASIC test boots, presses
  `A`, and confirms its screen character. All 11 native probes and the full
  JS automation suite pass.

- 2026-09-27: corrected the AHRM 4.13 two-cycle `DMACTL` gate for P/M DMA
  in `A8E/AtariIo.c` and `jsA8E/js/core/playfield/renderer_base.js`. The
  PMG slots now consume the P/M enable bits from two ANTIC cycles earlier;
  a `$3E` to `$32` write at cycle 113 therefore still permits the following
  cycle-0 missile fetch, while player DMA is disabled by cycle 2. Enables
  follow the same delay; `DMACTL` addressing mode remains live. The JS timing
  state is serialised with snapshots.
  Native and JS probes cover the receiver value, both DMA boundaries, and
  the preserved CPU-steal contract. All native probes, JS automation, and
  the AHRM-07 ROM-backed boot test pass. A 20-frame AtariBlast beam trace
  contains 41 late cycle-113 disables, making this a directly exercised
  generic correction. A saved-snapshot replay has byte-identical output for
  its first 20 frames before and after the change. The subsequent live
  NTSC/RAMBO-1088K rerun still showed detached fragments in both A8E cores,
  so AHRM 4.13 is ruled out as a sufficient AtariBlast fix. A later register
  trace corrected an earlier label: `$D407` is PMBASE, not HSCROL. PMBASE
  alternates only in VBL (line 248, cycles 90-107), and the actual HSCROL
  (`$D404`) and VSCROL (`$D405`) writes also lie outside the visible region.
  These changes are not candidates for the detached fragments. The gameplay
  snapshot keeps `DMACTL=$3E`/`GRACTL=$03` from about line 31 through 207;
  it is not a short DMA pulse. Temporarily suppressing only player rendering
  removes the detached pieces while leaving missile output, and all observed
  HPOS/SIZE writes miss their comparator windows. The remaining candidate is
  the shared player DMA/latch/output model.

- 2026-09-27: added the missile part of the AHRM 6.5 phantom P/M-DMA rule
  to `A8E/AtariIo.c` and `jsA8E/js/core/{antic,gtia}.js`. When a visible
  line ends with display-list DMA enabled and both P/M-DMA bits disabled,
  the next line's cycle-1 display-list instruction fetch can be received as
  GRAFM data while GTIA missile reception remains enabled. Both cores now
  carry that one-line condition, load the actual display-list byte into the
  GRAFM latch at cycle 1, apply the per-missile VDELAY merge, and record the
  raster event. It reuses the display-list DMA cycle and therefore adds no
  CPU steal. The JS pending state is included in snapshots. Native and JS
  probes cover the cycle, byte source, latch event, and single CPU steal.
  A later beam-level AtariBlast trace refined the initial coarse timing:
  GRACTL is cleared at cycle 0 of the following line, before the cycle-1
  display-list fetch. The phantom-missile condition is therefore not active
  in that captured interval. This remains a generic correction, while the
  title still needs a visual comparison; its GRACTL write also occurs before
  the phantom-player slots, so no player bus-sampling model was added without
  a trace that requires it.

- 2026-09-27: corrected P/M DMA with VDELAY in `A8E/AtariIo.c` and
  `jsA8E/js/core/gtia.js`. AHRM 4.13 schedules player/missile DMA in its
  normal slots on every visible scanline, while AHRM 6.5 says VDELAY only
  masks GTIA's graphics-latch load on even lines. Both cores had suppressed
  the DMA steal itself. They now retain the prior GRAFP data and, for GRAFM,
  retain only the two bits belonging to each VDELAY-masked missile; unmasked
  missiles still receive their two fetched bits. A fully masked load adds no
  raster-history event, while a partial load records the merged latch. All
  cases still steal the missile/player cycle. Native and JS probes verify the
  retained bits, partial missile merge, absent event, and CPU-cycle steal; the
  native graphics probe, JS PMG regression, AHRM-07 guest boot, and headless
  automation pass. This generic timing correction is a plausible contributor
  to AtariBlast's scrolling PMG defect, but the captured affected line had
  `VDELAY=0`, so it is not yet a confirmed fix for that title.

- 2026-09-27: the user's paired NTSC/128K AHRM-07 captures showed matching
  jsA8E/native phases and collision PASS, but missing player/playfield color
  mixing compared with Altirra in the PRIOR=0 phase. Per AHRM 6.7/6.8, the
  interleaved player compositor in both cores now ORs P0/P1 with PF0/PF1
  and P2/P3 with PF2/PF3 in mode 0. It retains the original playfield colors
  before drawing players so a lower player cannot leak into the result when
  multicolor is disabled; high-resolution PF1 luminance remains intact.
  Native and JS probes cover overlapping P2/P3 with multicolor on/off and
  high-resolution luminance/collisions; JS also checks all four mixing groups,
  background, and nonzero priority. All ten native tests, JS automation, and
  the 65-DLI guest boot test pass. A headless capture now shows the expected
  color transition over the playfield. Updated Chromium/native visual runs
  and hardware confirmation remain pending; no POKEY or palette changes.

- 2026-09-27: resumed AHRM-07 startup investigation without changing production
  emulation or the existing VERBOSE_SIO instrumentation. Added the explicit
  ROM-backed `jsA8E/tests/ahrm07_pmg_boot.test.js`: the checked-in XEX boots
  through HostFS, reaches its main loop and DLI, balances the stack across
  65 DLI returns, changes phase every 32 frames, and displays collision PASS.
  A separate uninterrupted headless run exceeding five million cycles after
  the first DLI showed labels/players/PASS and retained the guest loop.
  The earlier Chromium return to the OS was not reproduced and remains
  unexplained. Cold entry in this run took 7,603,998 cycles, exceeding the
  automation entry guard's default; use normal frame execution and explicit
  breakpoints for this check. Four-way visual certification is still pending.

- 2026-09-27: session handoff. AHRM-08 P0/P2/P4 and ten-bit SIO completion
  remain stable and must not be reopened. The only accepted AHRM-08 matrix
  difference is jsA8E P1 serial-divider phase (`NORM P1=05`, `REV P1=05`
  versus Altirra/hardware `00`). Do not add padding-specific delays; any future
  P1 work requires a focused CPU bus-timing and STIMER arbitration probe.
  AHRM-07 is the next incomplete alignment block: its synthetic PMG/GTIA
  regressions pass, but four-way visual validation is still pending. The
  temporary Chromium run of `AHRM07_P.XEX` passed XEX preflight but produced a
  blue screenshot and later returned to the OS, so it is not a certification
  result. Next session should isolate that diagnostic's display-list/DLI/PMG
  startup path before changing production rendering code. The browser HostFS
  copy was temporary; no AHRM-07 production implementation change was made.

- 2026-09-27: reran the current matrix XEX from HostFS in jsA8E and the
  current `VERBOSE_SIO` native A8E build. The HostFS bytes and checked-in
  `implementation/AHRM08_POKEY_MATRIX_TEST.XEX` are identical (1861 bytes,
  SHA-256 `a526b3ac260437c60891e1e19bbde30fd5496d3fcfd4de65a8ea306d07cb2704`).
  jsA8E reports `00,05,05,04 / 04,05,05,00 / 3A,3A`. Native A8E keeps the
  serial divide-by-two phase low for P1, schedules `DATA_NEEDED` on the next
  timer edge, and keeps the phase high for P2/P4, matching the Altirra/hardware
  matrix pattern. The P1 difference is therefore a real serial-clock phase
  discrepancy before guest polling, not merely a display-loop count. The
  next investigation remains the CPU/timed-event boundary and the AHRM
  initialization/STIMER arbitration; no padding-specific delay was added.

- 2026-09-27: captured the jsA8E P1 serial trace from Chromium and aligned it
  with the native A8E `VERBOSE_SIO` trace. In the corresponding transaction,
  both cores use a 56-cycle serial timer period, assert `DATA_NEEDED` 110
  cycles after `SEROUT`, and complete the ten-bit transmission 1230 cycles
  after `SEROUT`. `STIMER` is applied four cycles after the write in both
  cores. The only observed difference is the preceding CPU-side boundary:
  jsA8E reaches `SEROUT` 35 cycles after `STIMER`, while native A8E reaches it
  after 36 cycles. This is not evidence of a POKEY divider or serial deadline
  error, and no P1/padding-specific timing adjustment should be added. The
  remaining matrix-screen P1 count is therefore treated as a one-cycle
  polling/instruction-boundary deviation pending a broader CPU bus-timing
  investigation. Chromium was restored to the worker configuration after the
  capture.

- 2026-09-27: source review identified the next diagnostic seam for the
  one-cycle P1 boundary: jsA8E's CPU runner clips an instruction when the next
  POKEY timed event falls inside that instruction, while native `_6502_Run`
  executes the instruction and checks timed events at the following boundary.
  This is only a hypothesis for the `STIMER`-to-`SEROUT` difference; add a
  focused CPU/bus trace probe before changing either runner or POKEY timing.

- 2026-09-27: extended the opt-in POKEY trace with the current 6502 `pc` and
  `opcode` on register writes and timed serial events in both cores. This is
  the focused CPU/bus probe for the P1 boundary: it reuses the existing
  AHRM-08 matrix XEX, adds no normal-mode work, and can show whether a timed
  POKEY event is observed during the instruction that precedes `SEROUT` or at
  the next CPU boundary.

- 2026-09-26: added a shared POKEY SIO clock contract covering all eight
  `SKCTL` modes, the selected serial clock timer, and the `AUDF`-derived
  period. Native A8E and jsA8E consume the same JSONL fixture, turning the
  current manual parity check into a regression test without changing runtime
  timing behavior.

- 2026-09-26: fixed a jsA8E-only audio degradation in linked POKEY timer modes.
  The browser mixer was fast-forwarding between divider events while native A8E
  advances the audio state every CPU cycle; holding one mixed level across that
  interval could make one Prince of Persia music voice sound muffled. jsA8E now
  keeps the fast path for independent channels but uses cycle-accurate audio
  stepping whenever AUDCTL links timers 1+2 or 3+4. POKEY timer/SIO behavior is
  unchanged; the focused timer and POT tests still pass. Prince of Persia was
  replayed in Chromium and the affected voice returned to normal.

- 2026-09-26: rechecked the remaining jsA8E P1 phase discrepancy using the
  AHRM timing rules, Altirra only as a conceptual reference, and Chromium
  traces. Two hypotheses were rejected: globally moving the `STIMER` reload
  to the apparent CPU bus-write cycle, and deferring all POKEY events to an
  instruction boundary. Both fix P1 in isolation but regress P0/P2/P4 or
  transmission completion. The restored stable matrix remains
  `00,05,05,04 / 04,00,05,00 / 3A,3A`; the next change must model the
  slow-clock-tick versus timer-reload arbitration, not introduce a global or
  padding-specific offset.

- 2026-09-26: found the jsA8e-only scheduler defect behind the remaining
  P1/P2 variability. The `STIMER` write created `pokeyTimerResetCycle` but
  did not republish `ioMasterTimedEventCycle`, so the reset could be applied
  several CPU cycles late. jsA8e now publishes that deadline immediately;
  this preserves the cycle-accurate reset boundary instead of tuning a
  padding-specific offset.

- 2026-09-26: added an opt-in `TIMER_RESET_APPLY` trace record to jsA8e so
  the scheduled and observed `STIMER` reset cycles can be compared directly
  while tuning the matrix boundary. This is diagnostic only and does not
  change emulation behavior.

- 2026-09-26: the Chrome/native trace showed jsA8e carrying a high serial
  divider phase into later matrix cases because active timer deadlines from
  the previous case survived the `SKCTL` initialization transition. Both
  cores now cancel timer deadlines and pending `STIMER` application when
  entering initialization, then re-arm inactive timers on exit. This keeps
  the change independent from the four-cycle `STIMER` delay and serial
  propagation timing.

- 2026-09-26: applied the first targeted P0/P2 correction in both cores without
  importing Altirra code. `STIMER` now schedules an internal four-cycle timer
  reset event; the event loop applies the timer reload and clears stale timer
  IRQ state at that boundary. Leaving POKEY initialization also seeds the slow
  clock six cycles before the observed transition so the next 64 kHz edge is
  aligned. This deliberately leaves serial `+2` propagation untouched until
  the matrix fixture shows whether these two independent phase causes are
  sufficient.

- 2026-09-26: extended the opt-in AHRM-08 POKEY trace in both cores with
  `CLOCK_CONFIG_WRITE`, `SKCTL_WRITE`, `STIMER_WRITE`, and `SEROUT_WRITE`
  events. The events record the write cycle, initialization transition,
  slow-clock origin, timer deadlines, selected serial clock, and serial
  divider level. Normal emulation is unchanged; the trace is enabled only by
  `?a8e_pokey_trace=1` in jsA8E or `VERBOSE_SIO` in native A8E. This is the
  next diagnostic step before changing the phase model exposed by the matrix
  fixture.

- 2026-09-26: limited jsA8E's default `?a8e_pokey_trace=1` output to the
  low-rate phase and serial events. Logging every `TIMER_CLOCK_EDGE` through
  the browser console can dominate the worker during boot and make the
  emulator appear hung. Full edge tracing remains available explicitly with
  `?a8e_pokey_trace=1&a8e_pokey_trace_edges=1`.

- 2026-09-26: `implementation/AHRM08_POKEY_MATRIX_TEST.{asm,XEX,md}` and
  `jsA8E/tests/ahrm08_pokey_matrix_xex.test.js`: added a matrix diagnostic for
  the remaining AHRM-08 phase investigation. It repeats the same
  `STIMER`/`SEROUT` measurement in normal and reverse padding order, resets
  POKEY before every case, and reports `DATA NEEDED` plus completion polling
  counts. The fixture is intended to distinguish order-dependent state from
  a stable IRQ/polling-boundary difference without changing production timing.

- 2026-09-26: three clean jsA8E matrix runs through the browser automation API
  produced, in fixture-memory order `P0,P1,P2,P4,P4r,P2r,P1r,P0r,TX,TXr`,
  `03,02,05,01,01,02,02,00,3B,3A` on the first launch and
  `00,02,05,01,01,02,02,00,3A,3B` on the next two launches. `P2` is stable
  across launches while `P0` and the completion pair change with the initial
  phase. Treat P0 and P2 as separate investigations; do not apply one shared
  padding formula or change production timing until the startup phase is
  measured directly.

- 2026-09-26: `implementation/AHRM08_POKEY_EDGE_TEST.{asm,XEX,md}` and
  `jsA8E/tests/ahrm08_pokey_edge_xex.test.js`: added a diagnostic that records
  independent timer-4 IRQ and `DATA NEEDED` polling counts from the same
  STIMER/SEROUT padding cases. The timer probe now uses `AUDF4=$05` to avoid
  the first-read `T4=00` resolution limit, while the data probe retains the
  original single-event polling loop; `TX COMPLETE` runs before the sweep.
  This isolates timer reload/slow-clock phase from the serial divide-by-two
  phase before the existing Stage 3 certification fixture is rerun.

- 2026-09-26: AHRM-08 Stage 3 comparison established the current open timing
  issue. With identical `AHRM08_POKEY_PHASE_TEST.XEX` runs, Altirra and the
  hardware agree at `03,00,05,04,3A`, while the restored jsA8e/A8E condition
  reports `00,00,02,04,3A` and `00,00,02,04,38`. `P0` and `P2` therefore expose
  the same phase-boundary discrepancy; they are not independent padding bugs,
  and `P1`/`P3` already agree. The final `3A`/`38` difference is tracked
  separately as a native A8E completion-timing discrepancy.

- 2026-09-26: technical decisions for the Stage 3 investigation: use Altirra
  as the practical digital reference because it is aligned with the hardware;
  do not add per-padding delays or tune P0/P2 independently; preserve the
  currently bootable emulator state until the cause is isolated; and measure
  the first timer-4 IRQ and `DATA NEEDED` event before changing production
  timing. AHRM 5.3 supplies the persistent 64 kHz clock phase and STIMER
  reload rules, AHRM 5.6 supplies the serial divide-by-two/rising-edge and
  holding-register rules, and AHRM 5.7 explains the IRQ/polling observation
  boundary. The new edge diagnostic precedes the existing phase XEX, which
  remains the final certification fixture.

- 2026-09-26: the independent edge diagnostic was run on jsA8e, A8E, and
  Altirra. Results were jsA8e `T4=06,06,05,04 DATA=00,00,05,04 TX=3B`,
  A8E `T4=06,06,05,05 DATA=00,00,05,04 TX=3B`, and Altirra
  `T4=06,06,05,04 DATA=00,02,05,04 TX=3A`. Timer-4 timing therefore matches
  the reference except for one polling boundary in A8E/P3, while the remaining
  serial-phase discrepancy is localized to P1. The matching `TX=3B` result in
  both emulators also means the earlier A8E-only `TX=38` result was likely
  affected by the original diagnostic's accumulated test order; it is not yet
  evidence of a separate native completion bug.

- 2026-09-25: `A8E/6502.{h,c}`, `A8E/tests/antic_timing_probe.c`,
  `jsA8E/js/core/cpu.js`, and
  `jsA8E/{js/core/atari_snapshot.js,tests/cpu_interrupt_step_regression.test.js}`:
  implemented the AHRM
  4.8 missed-NMI boundary. An IRQ acknowledged with the next ANTIC status
  event three cycles ahead loses the cycle-8 NMI edge while NMIST remains
  latched; the one-boundary condition expires without affecting later NMIs,
  and is preserved across jsA8E snapshots.

- 2026-09-25: `jsA8E/tests/playfield_dynamic_geometry.test.js` now uses the
  current `drawModeLine(mode, ctx)` renderer contract instead of the removed
  mode-stepper hook. Its HSCROL and DMA enable/disable assertions execute in
  the standard automation suite, establishing AHRM-06's first fixture without
  adding title-specific timing behavior.

- 2026-09-25: `A8E/{AtariIo.h,AtariIo.c,Antic.c}` and
  `jsA8E/js/core/{state,io,antic}.js`,
  `jsA8E/js/core/playfield/renderer_base.js`: completed the remaining
  AHRM-06 ANTIC timing gaps. Modes 2/3 now perform character-data DMA on
  visually blank extended rows and discard only the displayed byte; VSCROL
  deadline decisions sample the final 6502 write cycle in both cores. The
  native graphics probe adds wide mode-2 coverage, while JS/native timing
  probes cover the atomic VSCROL boundaries and existing chained JVB+DLI
  replay. Snapshot state includes the JS VSCROL timing latch.

- 2026-09-25: `implementation/AHRM06_ANTIC_TEST.{asm,md}` and
  `implementation/AHRM06_ANTIC_TEST.XEX`: added a guest-level visual
  diagnostic for AHRM-06. It chains normal mode 2, DLI-selected wide mode 2,
  and mode 3 with VSCROL, with visible color changes at the section boundaries.
  It complements, but does not replace, the cycle-accurate native and JS
  probes because ANTIC's internal DMA/deadline state is not CPU-readable.

- 2026-09-25: `implementation/AHRM06_ANTIC_TEST.asm`: made the visual
  diagnostic's DLI phase transition saturating so the 8-bit phase counter
  cannot wrap after roughly 85 frames and reapply the width/scroll changes.
  The mode-3 label now starts on a full-height row; the partial first row is
  retained as the intentional VSCROL observation point.

- 2026-09-25: `implementation/AHRM06_ANTIC_TEST.{asm,md}`: clarified that
  the diagnostic's mode 2 and mode 3 labels refer to ANTIC display-list modes,
  not Atari BASIC `GRAPHICS 2` and `GRAPHICS 3` modes.

- 2026-09-25: `implementation/AHRM06_ANTIC_TEST.{asm,md}`: added persistent
  `DLI1` and `DLI2` screen markers written by the DLI handler. This makes the
  guest-level DLI result observable even when the OS VBI restores GTIA color
  registers after the interrupt.

- 2026-09-25: AHRM-06 visual validation passed in jsA8E with
  `AHRM06_ANTIC_TEST.XEX`. The three ANTIC sections remained stable, both
  `DLI1`/`DLI2` markers appeared, and no blink, corruption, or displacement
  was observed. AHRM-06 is now certified PASS for the current alignment scope.

- 2026-09-25: AHRM-04 RAMBO 256K was validated with representative software
  in jsA8E and Altirra. Bank aliasing, independent expanded banks, and the
  diagnostic XEX behavior are now considered validated; the generated
  cross-core profile-table hardening remains a future follow-up.

- 2026-09-25: `implementation/{memory_stress_test.asm,MEMORY_STRESS_TEST.XEX,
  u1mb_memory_test.asm,U1MB_MEMORY_TEST.XEX}` and `implementation/memory_tests.md`:
  updated the standalone memory diagnostics for AHRM RAMBO 256K. Detection now
  distinguishes its motherboard aliases in banks 0-3 from independent banks
  4-15; full-bank and stress signatures share the alias pattern, window checks
  account for motherboard-backed bank 0, and ANTIC validation selects the
  detected highest bank instead of assuming bank 63. Both sources were
  reassembled with the project assembler.

- 2026-09-25: `A8E/{AtariIo.h,AtariIo.c,Pia.c,A8E.c}`,
  `A8E/tests/memory_expansion_probe.c`, `jsA8E/{index.html,js/core/{memory,
  atari,app_proxy}.js,js/app/ui.js,emulator_worker.js,tests/ahrm_machine_matrix.test.js}`,
  and the memory documentation: implemented the AHRM RAMBO 256K profile in
  both cores. It uses the 320K RAMBO selector bits and shared CPU/ANTIC window,
  while banks 0-3 alias the motherboard window and banks 4-15 retain
  independent expanded storage. Native and JS profile matrices now expose 16
  banks, and the native probe verifies alias versus independent-bank behavior.

- 2026-09-25: `implementation/traces/pia_portb_contract.jsonl`,
  `A8E/tests/differential_pia_trace_probe.c`,
  `jsA8E/tests/differential_pia_trace.test.js`, and the native/JS test
  manifests: added the first AHRM-09 cross-core contract fixture. Both cores
  now compare their CPU-visible PIA/PORTB state at the same deterministic
  register boundaries, including DDRB/ORB latches, effective PORTB value,
  control readback, and PIA IRQ state. The fixture is test-only and does not
  install tracing hooks or add work to normal emulation. More AHRM-sensitive
  peripherals can add fixtures to the same JSONL contract as their alignment
  work is completed.

- 2026-09-24: `A8E/{Pia.c,Pia.h,AtariIo.c,AtariIo.h,Pokey.c}`,
  `A8E/tests/pia_control_probe.c`, and
  `jsA8E/js/core/{cpu,io,state,atari,memory,pokey_sio,antic}.js`: completed
  AHRM-03's PIA control-line foundation. Both cores now track CA1/CA2/CB1/CB2
  levels, latch status independently of IRQ enable, combine PIA IRQ with POKEY
  IRQ, acknowledge both flags only on ORA/ORB reads, clear CA2/CB2 status in
  output modes, model CA2/CB2 handshake output modes and the documented CB2
  output-to-input spurious interrupt, and drive CB2 around SIO frames without
  changing response bytes. Native and JS control-line probes pass; 1030 modem
  behavior remains outside this item.

- 2026-09-24: `A8E/{A8E.c,AtariIo.c,AtariIo.h,Gtia.c}`,
  `A8E/tests/gtia_consol_probe.c`, and
  `jsA8E/{js/core/io.js,tests/consol_startup_option.test.js}`: completed
  AHRM-02. Removed the unconditional `CONSOL_HACK` global/compile path and
  made Option-on-Start an explicit per-machine compatibility option. Native
  A8E exposes it through `-o`/ `-O`/ `--option-on-start` with BASIC-enabled behavior as the
  default; `-b`/ `-B` remains a compatibility alias. Normal `$D01F`
  reads now depend only on emulated console state, and both cores validate
  the startup override at the OS sample address. The browser UI toggle is
  also off by default.

- 2026-09-24: `A8E/{AtariIo.c,AtariIo.h,Pia.c}` and
  `A8E/tests/memory_expansion_probe.c`: completed AHRM-01 native PIA
  DDRB/ORB alignment. A8E now retains independent PORTB direction/output
  latches, computes the effective XL/XE pull-up value, and reapplies ROM,
  bank, CPU-window, and ANTIC-window mapping after either latch changes.
  Reset starts with all DDRB bits as inputs and effective PORTB `$FF`.
  The native probe now validates the latch contract and all existing memory
  profiles; no diagnostic tracing was added to normal emulation.

- 2026-09-24: `implementation/alignment_23Sept26.md`: added the prioritized
  AHRM alignment study for A8E and jsA8E, including feasibility, difficulty,
  implementation steps, acceptance criteria, and recommended execution order.

- 2026-09-24: `implementation/alignment_23Sept26.md`: incorporated the
  confirmed project decisions: RAMBO 256K is in scope, U1MB is a separate
  project, AHRM is the primary reference, Linux/Chromium are the initial
  validation targets, and development tracing must not remain in normal-mode
  emulation without lasting value.

- 2026-09-24: `A8E/CMakeLists.txt`, `jsA8E/tests/{headless_automation,
  startup_standby,pia_ddrb_orb_contract,ahrm_machine_matrix}.test.js`, and
  `jsA8E/package.json`: completed the AHRM preflight infrastructure. CTest is
  now enabled for native probes, ROM lookup is robust in the headless test,
  the standby assertion matches the current guest program, and executable
  PAL/NTSC, memory-profile, and PIA DDRB/ORB contract fixtures are included.
  The alignment document records the Linux baseline and the one remaining
  stale playfield test adapter.

- 2026-09-24: `implementation/alignment_23Sept26.md`: added the stale
  `playfield_dynamic_geometry.test.js` renderer mock as the first action of
  AHRM-06. The test must use the current `drawModeLine` contract and reach its
  HSCROL/DMA assertions before ANTIC timing work proceeds.
- 2026-09-24: `ATR/10Sept26.md`, the Karate Champion and Animal Party notes,
  and the root README: reconcile the historical game summaries with current
  validation. Keep the Bosconian POKEY timer fix separate from Karate's NMI
  cause, and clarify that the existing SIO observer test does not cover the
  Animal Party READ response phases.

- 2026-09-24: `ATR/world_karate_championship_v1_ed.md` and
  `ATR/animal_party.md`: added title-level investigation records for the
  World Karate Championship (v1,ED) DLI/NMI case and Animal Party SIO
  response-phase case. Both titles are now documented with successful
  jsA8E validation.

- 2026-09-23: `jsA8E/style.css`: remove the generic flex layout from Disk
  Library cells. Use a nested grid for filenames and text alignment for the
  download action so its icon keeps its normal width in the shared final grid
  column.

- 2026-09-23: `jsA8E/assets/standby.{asm,xex}`, `jsA8E/js/app/ui.js`, and
  disk-library restore/UI code: supply an internal D1 startup XEX whenever no
  user ATR/XEX is mounted. Wait for saved library mounts before selecting the
  fallback; file-picker/drop loads still restart into user media. Library
  drive edits now update mounted devices without resetting or auto-starting, so
  users can swap disk sides; the library status only confirms the mount action,
  and Full Reset stays user-controlled for booting from D1. The standby program
  draws its instructions in a private screen buffer through a custom ANTIC
  display list, avoiding CIO E: output.

- 2026-09-23: `jsA8E/index.html`, `jsA8E/style.css`, and `jsA8E/js/app/ui.js`:
  use a compact icon-only Open Disk control and show disk status through the
  existing library/mount state instead of a redundant toolbar badge. Use double
  chevrons for SIO turbo to distinguish it from the disk picker; place Open
  Disk immediately after the ATARIBAS.ROM loader.

- 2026-09-22: `jsA8E/index.html`: move ROM loading, fullscreen, turbo,
  keyboard/joystick, and utility-panel controls into the primary toolbar row.
  Keep only the video-standard and memory-expansion selectors in the collapsible
  secondary row.

- 2026-09-22: `jsA8E/style.css`: place the top toolbar in a higher stacking
  layer so the brand help tooltip can paint above the page panels. The toolbar's
  backdrop filter creates a stacking context, so the tooltip's own z-index
  could not lift it over later content by itself.

- 2026-09-22: `jsA8E/js/core/memory.js` and `A8E/AtariIo.c`: preserve the XEX
  loader's zero-page sector cursor across `INITAD` calls, and select a sector
  buffer from available RAM at `$0880` or above, away from the shared
  `$0600-$067F` workspace. The JavaScript and native loader images and their
  relocated operands are kept in sync. This resolves the Amaurote Plus XEX
  startup failure; see [the investigation](../ATR/amaurote.md).

- 2026-09-18: `jsA8E/{index.html,style.css,js/app/ui.js}`: added the first
  extensible presentation-layout presets. `Emulation`, `Work`, and
  `Development` are selectable beside the lifecycle controls, persist through
  `localStorage`, and rearrange the existing screen, keyboard, joystick,
  HostFS, Disk Library, and assembler/debugger panels without resetting the
  emulator. The disk activity overlay remains anchored to the screen viewport.
- 2026-09-18: `jsA8E/js/app/ui.js`: in the desktop `Work` layout, the canvas no
  longer reserves vertical space for the joystick because that control is in
  the row below the screen. Mobile layouts keep the reservation while panels
  are stacked.
- 2026-09-18: `jsA8E/{index.html,style.css}`: layout selectors are now compact
  icon-only buttons positioned immediately before the secondary-tools expand
  button, with labels retained through tooltip and ARIA text.
- 2026-09-18: `jsA8E/{index.html,js/app/ui.js}`: `Work` is now the default
  layout when no saved presentation preference exists.
- 2026-09-18: added the initial `src-tauri/` desktop shell. It serves the
  existing `jsA8E` static frontend through Tauri in development via the same
  `python -m http.server` URL and packages that frontend for release without
  moving emulator logic into Rust. Rust/Cargo are not installed in the current
  environment, so native compilation remains pending.
- 2026-09-18: `jsA8E/js/core/app_proxy.js` now detects the Tauri WebView and
  selects the main-thread backend there. WebKitGTK may expose
  `OffscreenCanvas` without a usable worker 2D context, which caused the
  desktop shell to fail with `Missing 2D canvas context` in the worker.
- 2026-09-18: documented Tauri portability in `implementation/tauri.md` and
  `jsA8E/README.md`. Rust/Cargo/CLI/Python and Linux GTK/WebKitGTK development
  packages are build-time requirements; Windows uses WebView2, macOS uses
  system WebKit, and Linux packages retain WebKitGTK/GTK runtime dependencies.
  The remaining CDN assets are recorded as a prerequisite for a fully offline
  desktop release.
- 2026-09-18: added `scripts/build-tauri-linux.sh`, a reproducible Linux
  packaging helper that validates Cargo, the Tauri CLI, and WebKitGTK
  prerequisites before running `cargo tauri build` and listing generated
  distribution artifacts.
- 2026-09-18: the Linux packaging helper defaults to `deb,rpm`; AppImage can
  be requested with `A8E_TAURI_BUNDLES=deb,rpm,appimage`. This keeps the normal
  build independent of AppImage's external `linuxdeploy` download chain.
- 2026-09-18: added a Tauri drag-drop bridge across `src-tauri/src/lib.rs`,
  `jsA8E/js/app/ui.js`, HostFS, and Disk Library. Native dropped paths are read
  through a Rust command and forwarded as `File` objects to the existing panel
  handlers; browser HTML5 drag-and-drop remains unchanged.
- 2026-09-18: documented that Tauri development uses the manual Python server
  on port `8090` from `devUrl`, while packaged AppImage builds use embedded
  Tauri assets and do not bind a local TCP port.
- 2026-09-19: `jsA8E/js/{audio/runtime.js,core/app_proxy.js}`: resolve the
  AudioWorklet module against the active document or worker origin so browser
  workers and packaged Tauri assets both load it correctly. Worklet failures
  now report a console diagnostic before using the ScriptProcessor fallback.

- 2026-09-15: removed obsolete game-specific investigation scripts, the CDP
  diagnostic runner, and the unused SIO/NMI/POKEY diagnostic counters. The
  reusable automation debugger and regression tests remain available.

- 2026-09-15: `jsA8E/js/core/atari.js`: registered the worker-provided disk
  activity bridge with the app's disk observer fan-out. This restores disk
  activity notifications in the worker backend while keeping them outside the
  SIO response and timing path.

- 2026-09-14: `jsA8E/js/core/{memory,atari,app_proxy}.js`,
  `jsA8E/emulator_worker.js`, and `jsA8E/{index.html,js/app/ui.js}`: separated
  the web toolbar action into a full machine restart (power-cycle). It now
  stops the running machine, releases inputs, rebuilds volatile RAM and the
  selected expansion-bank state, reinitializes the machine, and starts it
  again while preserving loaded ROMs, disk images, and H: files. The virtual
  keyboard F5/reset path remains the ordinary XL/XE hardware reset and keeps
  its existing warm-reset semantics.

- 2026-09-14: `jsA8E/js/core/{pokey_sio,memory,atari,app_proxy}.js`,
  `jsA8E/emulator_worker.js`, `jsA8E/js/app/disk_activity_ui.js`,
  `jsA8E/index.html`, and `jsA8E/style.css`: refined the transient lower-right
  disk-activity OSD to match the Altirra-style blinking drive indicator and
  placed it in a dedicated high-z-index screen overlay above the canvas:
  yellow for reads and orange for writes/formats. Activity is forwarded
  through the worker without changing SIO response bytes or timing; the
  focused SIO regression verifies the write event context.

- 2026-09-14: `jsA8E/js/core/disk_library.js`, `jsA8E/js/core/{memory,pokey_sio,atari}.js`,
  `jsA8E/js/core/app_proxy.js`, `jsA8E/emulator_worker.js`, and
  `jsA8E/js/app/disk_library_ui.js`: added the initial worker-owned multi-drive
  disk library. ATR/XEX entries use IndexedDB, the browser panel supports
  upload/drop, exclusive D1:-D4: mounting, deletion, and download, and disk
  writes are observed with image identity and drive-slot context without
  changing SIO timing or responses. Serialized
  dirty flushing and download consistency barriers are covered by focused
  library and SIO observer tests; snapshot/media replacement edge cases remain
  covered by library identity metadata and mount reconciliation.

- 2026-09-14: `jsA8E/js/core/{hw,state,input,io}.js`, `jsA8E/headless.js`,
  `A8E/AtariIo.c`, and `jsA8E/tests/pia_xlxe_defaults.test.js`: corrected the
  XL/XE no-cartridge hardware state per AHRM 2.8. `TRIG3` now reports RD5 low
  when no external cartridge maps `$A000-$BFFF`; internal BASIC does not
  assert it. Also separated jsA8E's PORTB output latch from DDRB: reset now
  exposes effective `$FF` through MMU pull-ups, and DDRB writes immediately
  update ROM/extended-memory mapping. Headless automation now forwards its
  selected memory-expansion profile. AtariWriter reaches its user menu after
  one intended warm start without an 850 or title-specific behavior.

- 2026-09-14: `jsA8E/index.html`: removed the obsolete `Nonfunctional`
  label from the validated `1088K (RAMBO)` profile and marked the separate
  `Ultimate1MB (1MB)` profile as `(WIP)` to reflect its remaining
  Ultimate1MB-specific work.

- 2026-09-14: `implementation/memory_stress_test.asm` and
  `implementation/MEMORY_STRESS_TEST.XEX`: corrected the smaller-RAMBO
  `PORTB MAP` probe. For `320R` and `192K`, bit 7 now tests Self-Test ROM
  write isolation while the overlay is active, then verifies that the
  original expanded-RAM pattern returns after the overlay is disabled.

- 2026-09-14: `implementation/u1mb_memory_test.asm` and
  `implementation/U1MB_MEMORY_TEST.XEX`: corrected the Atari screen-code
  order for the Stage 4 label, so the visual result now displays `ANTIC GFX`
  instead of `ANTIC GXF`.

- 2026-09-13: `implementation/u1mb_memory_test.asm` and
  `implementation/U1MB_MEMORY_TEST.XEX`: gave the Stage 4 visual result its
  own `ANTIC GFX PASS/FAIL` label. Stage 3 now remains clearly identified as
  `ANTIC CFG PASS/FAIL`, so the two ANTIC checks are distinguishable on screen.

- 2026-09-13: `implementation/u1mb_memory_test.asm` and
  `implementation/U1MB_MEMORY_TEST.XEX`: fixed the Stage 2 motherboard-RAM
  sentinel check. The `$4000`/`$7FFF` sentinels are now read while the
  extended window is closed; the expanded-bank pattern is checked only after
  the window is reopened. This removes the false `SYS CHECKS FAIL` reported
  by functional expansions whose bank access was working correctly.

- 2026-09-13: `implementation/{u1mb_memory_test.asm,memory_stress_test.asm}`
  and their XEX outputs: strengthened the memory diagnostics for practical
  AHRM expansion compliance. The generic test now checks the exact 1088K
  RAMBO PORTB map, BASIC/Self-Test visibility, both motherboard-window
  endpoints, and visual ANTIC DMA in banks 0 and 63. The stress test now runs
  its PORTB control stage normally and validates bit 7 as a bank bit for
  1088K RAMBO. The ANTIC checks remain partly visual because ANTIC output is
  not readable by the CPU.

- 2026-09-13: `jsA8E/index.html`: removed the stale `Nonfunctional` labels
  from the 320K and 576K COMPY menu profiles after their memory-bank and
  ANTIC-window behavior was validated.

- 2026-09-13: `A8E/{Pia.c,AtariIo.c}`, `A8E/tests/memory_expansion_probe.c`,
  and `A8E/CMakeLists.txt`: ported the validated jsA8E expansion behavior to
  native A8E. The port now preserves the live CPU/ANTIC window view, restores
  motherboard RAM through the same shadow transitions, applies profile-specific
  BASIC/Self-Test bit reuse, reconfigures U1MB modes from a clean window, and
  reserves the full U1MB `$D380-$D3FF` range. Added a native regression probe
  covering all AHRM profiles, bank retention, CPU/ANTIC access, and U1MB mode
  changes. Removed the obsolete PORTB console diagnostic from jsA8E after the
  memory-transition investigation was resolved.

- 2026-09-13: `jsA8E/js/core/memory.js`, `jsA8E/js/core/cpu.js`,
  `jsA8E/js/core/io.js`, and `A8E/AtariIo.c`: corrected generic XEX RUNAD
  handling so valid low-memory entry points such as Mikie's `$008A` are
  launched, and stopped retaining a software-queued POKEY IRQ after `IRQEN`
  disables its source. These changes follow AHRM 5.7 level-sensitive IRQ
  behavior and were motivated by the AtariBlast/Mikie loader audit.
- 2026-09-13: `A8E/AtariIo.c`: applied the same 16-bit RUNAD handoff correction
  to the native XEX boot loader so low-memory entry points behave consistently
  in both emulator implementations.
- 2026-09-13: `jsA8E/js/core/memory.js` and `A8E/AtariIo.c`: completed the XEX
  loader relocation after expanding the RUNAD check. Internal `get_byte` and
  `read_sector` targets, plus all SIO buffer patch indices, now point to their
  relocated addresses. AtariBlast and Mikie were rerun successfully through
  their normal startup paths. The remaining compatibility items in
  `ATR/AtariBlast.md` are generic follow-up work, not blockers for these two
  titles.
- 2026-09-13: `A8E/6502.c`, `A8E/6502.h`, and `A8E/Pokey.c`: ported the
  level-sensitive POKEY IRQ behavior. Masked requests now collapse to one
  pending level, and writing `IRQEN` clears that request when no enabled
  active POKEY source remains, matching AHRM 5.7.
- 2026-09-20: `jsA8E/js/core/{cpu,io}.js`: reconciled the JavaScript POKEY IRQ
  level in both directions when writing `IRQEN/$D20E`. An already asserted and
  re-enabled source now reasserts the CPU IRQ, matching AHRM 5.7 and the native
  `_6502_ReconcileIrq()` path instead of only clearing stale pending state.
- 2026-09-13: `A8E/A8E.c`: made the native window title include the active
  memory profile and PAL/NTSC standard. The title is generated from the same
  parsed runtime state reported on the console.
- 2026-09-13: `A8E/{A8E.c,AtariIo.c,AtariIo.h,Pia.c}`: added the canonical
  RAMBO/COMPY profile names and console switches (`-192R`, `-320R`, `-320C`,
  `-576R`, `-576C`, `-1088R`, `-U1MB`) and generalized extended-memory storage,
  bank-bit decoding, and ANTIC window selection. U1MB register/shadow-PIA
  semantics remain a follow-up layer; `-U1MB` currently selects its 1088K
  bank geometry.
- 2026-09-13: `A8E/{AtariIo.c,AtariIo.h,Pia.c,Pia.h}`: added the native U1MB
  UCTL, UAUX, and COLDF register surface with unlocked-write and config-lock
  behavior, plus cold-reset initialization. Full U1MB flash, BIOS/PBI, and
  mode-dependent overlay routing remains pending; the register state is now
  available for the next AHRM-compliant mapping layer.

- 2026-09-13: `ATR/AtariBlast.md`: recorded the prioritized remaining work for
  AtariBlast. The first item is validation of independent 1088K/U1MB banks;
  the existing `U1MB_MEMORY_TEST.XEX` Stage 2 already covers generic bank
  isolation, so no duplicate test or title-specific workaround is planned.

- 2026-09-12: `jsA8E/js/core/{memory,io}.js`, `jsA8E/{emulator_worker.js,index.html}`, and configuration normalizers: added the initial Ultimate1MB memory model. It provides the AHRM 1MB bank storage, dynamic UCTL memory modes, UCTL/UAUX/COLDF register access, and a web UI selector. BIOS/flash/RTC/PBI behavior remains intentionally out of scope until separately specified and tested.
- 2026-09-12: `jsA8E/js/core/memory.js`: fixed expansion-profile transitions by restoring the motherboard RAM hidden under `$4000-$7FFF` before replacing the active memory profile. This prevents a bank from the previous expansion from becoming visible as base RAM after a selector change. PAL/NTSC changes still use a full page reload so video timing and palette state are rebuilt atomically.
- 2026-09-12: `implementation/u1mb_memory_test.asm` and `implementation/U1MB_MEMORY_TEST.XEX`: moved the generic U1MB tester's persistent state from OS-owned zero-page locations to a private high-RAM area at `$2FF2-$2FF8`. This prevents VBI/display services from corrupting the detected mode, bank counter, pattern, and progress state during the longer multi-map probe.
- 2026-09-12: `implementation/u1mb_memory_test.asm` and `implementation/U1MB_MEMORY_TEST.XEX`: improved test cleanup and status labels. The tester now restores `PORTB=$FF` after the bank test, leaving the motherboard RAM view active, and displays unambiguous `1088K`, `576K`, `320K`, or `128K` labels.
- 2026-09-12: `implementation/u1mb_memory_test.asm` and `implementation/U1MB_MEMORY_TEST.XEX`: expanded automatic detection to all seven AHRM-listed maps: 1088K, 576K RAMBO/COMPY, 320K RAMBO/COMPY, 192K RAMBO, and 130XE. Absolute jump tables avoid 6502 relative-branch range limits, and the result identifies RAMBO versus COMPY where applicable.
- 2026-09-12: `implementation/u1mb_memory_test.asm` and `implementation/U1MB_MEMORY_TEST.XEX`: fixed the jump-table dispatch used by the expanded detector. The 6502 `RTS` indirect-jump convention now uses target-minus-one entries; the previous entries landed one byte into each routine and could execute `$F2` (`KIL`).
- 2026-09-12: `implementation/u1mb_memory_test.asm` and `implementation/U1MB_MEMORY_TEST.XEX`: removed obsolete mode guards from the shared 576K/320K bank selectors. The 320K RAMBO candidate uses a different detector mode number and was incorrectly falling back to the 128K selector.
- 2026-09-12: `implementation/u1mb_memory_test.asm` and `implementation/U1MB_MEMORY_TEST.XEX`: fixed false memory-test failures caused by the Self-Test ROM remaining enabled in maps that do not reuse `PORTB` bit 7. Those selectors now set `PORTB` bit 7, and the detected-size label is kept away from the live bank-progress rows.
- 2026-09-12: `implementation/u1mb_memory_test.asm` and `implementation/U1MB_MEMORY_TEST.XEX`: corrected the 320K COMPY selector so bank bits 2 and 3 map to PORTB bits 6 and 7 as specified by AHRM. The 320K results now distinguish `320R` from `320C`; the previous COMPY selector was actually selecting the RAMBO bit layout and could pass detection before failing on the Self-Test ROM region.
- 2026-09-12: `implementation/u1mb_memory_test.asm` and `implementation/U1MB_MEMORY_TEST.XEX`: corrected the 192K display label from `1I2K` to `192K` (`$19` is the Atari screen code for digit 9; `$29` is letter I).
- 2026-09-12: `implementation/u1mb_memory_test.asm` and `implementation/U1MB_MEMORY_TEST.XEX`: added a visible Stage 2 that checks bank retention in reverse order and preservation of motherboard RAM across CPU-window disable/re-enable transitions. Stage 2 reports separately before the final overall result; ANTIC DMA/CPU-independent access remains a future stage.
- 2026-09-12: `implementation/u1mb_memory_test.asm` and `implementation/U1MB_MEMORY_TEST.XEX`: reorganized the test display into a fixed layout: title/memory on line 1, four progress lines, `RW BANKS PASS/FAIL`, and `SYS CHECKS PASS/FAIL`. Stage 1 progress is no longer overwritten by Stage 2 status text.
- 2026-09-12: `implementation/u1mb_memory_test.asm` and `implementation/U1MB_MEMORY_TEST.XEX`: added Stage 3 at the next screen row as `ANTIC CFG PASS/FAIL`. It checks the expected CPU/ANTIC window configuration for 130XE/COMPY versus shared-window RAMBO/1088K maps; it intentionally does not claim to validate ANTIC DMA data fetches.
- 2026-09-12: `implementation/u1mb_memory_test.asm` and `implementation/U1MB_MEMORY_TEST.XEX`: added Stage 4, a visual ANTIC DMA exercise. It displays an alternating pattern fetched from the expanded bank through a temporary display list, restores the original ANTIC/PORTB state, and reports `ANTIC DMA VIEW` on the next row; this result requires visual inspection rather than automatic PASS/FAIL.
- 2026-09-12: `implementation/u1mb_memory_test.asm` and `implementation/U1MB_MEMORY_TEST.XEX`: Stage 4 now displays `PRESS START TO CONTINUE` from the expanded bank and records `ANTIC DMA PASS` on START or `ANTIC DMA FAIL` on SELECT before restoring the machine state.
- 2026-09-12: `jsA8E/js/core/{antic,playfield/renderer_base}.js`: corrected ANTIC display-list and playfield DMA reads to use the expansion memory view. This is required for separate-window maps such as COMPY/130XE; shared-window RAMBO behavior remains unchanged.
- 2026-09-12: `implementation/memory_stress_test.asm` and `implementation/MEMORY_STRESS_TEST.XEX`: added a separate stress executable for Mikie-like workloads. It detects the supported AHRM map, repeatedly switches every bank in forward and reverse order, writes and reads both ends of `$4000-$7FFF`, and verifies that the motherboard RAM view survives each pass. The test reports the detected map and `STRESS PASS/FAIL`; ANTIC-specific checks remain outside this CPU-window stress test.
- 2026-09-12: `implementation/memory_stress_test.asm` and `implementation/MEMORY_STRESS_TEST.XEX`: added a RAMBO-specific Self-Test ROM overlay check. It toggles `PORTB` bit 7 over `$5000-$57FF`, verifies ROM isolation and RAM restoration across every bank, and reports `PORTB ROM PASS/FAIL`; COMPY, 130XE, and Ultimate1MB report this subtest as not applicable.
- 2026-09-12: `implementation/memory_stress_test.asm` and `implementation/MEMORY_STRESS_TEST.XEX`: made the RAMBO overlay stage explicitly restore `PORTB=$FF` before returning, so the stress executable cannot leave the Self-Test ROM or another temporary ROM view active.
- 2026-09-12: `implementation/memory_stress_test.asm` and `implementation/MEMORY_STRESS_TEST.XEX`: isolated the RAMBO Self-Test ROM overlay check by saving and disabling NMI/DMA during the temporary `$5000-$57FF` ROM view, then restoring both registers and `PORTB`; this prevents active VBI/DLI handlers from executing through the temporary overlay.
- 2026-09-12: `implementation/memory_stress_test.asm` and `implementation/MEMORY_STRESS_TEST.XEX`: removed the optional RAMBO Self-Test ROM overlay probe from the normal stress flow. The probe remains in the source for isolated experiments, but the general bank stress test now avoids changing the `$5000-$57FF` mapping and reports that control check as not applicable, preventing the test itself from entering firmware Self Test after the final pass.
- 2026-09-12: `implementation/memory_stress_test.asm` and `implementation/MEMORY_STRESS_TEST.XEX`: corrected the Atari screen-code encoding of the not-applicable control result from `NOO` to `N/A`.
- 2026-09-12: `implementation/u1mb_memory_test.asm`, `implementation/U1MB_MEMORY_TEST.XEX`, `implementation/memory_stress_test.asm`, and `implementation/MEMORY_STRESS_TEST.XEX`: preserved the initial BASIC-enable bit across bank selections for profiles whose AHRM banking map does not reuse PORTB bit 1. Profiles that use bit 1 as a bank bit retain their documented banking behavior.
- 2026-09-13: `implementation/u1mb_memory_test.asm`, `implementation/U1MB_MEMORY_TEST.XEX`, `implementation/memory_stress_test.asm`, and `implementation/MEMORY_STRESS_TEST.XEX`: corrected the fixed OS screen address from `$9C40` to `$BC40`, matching `SAVMSC` after XEX boot. The tests were running and writing results, but the display list was rendering the other screen buffer.
- 2026-09-13: `implementation/u1mb_memory_test.asm`, `implementation/U1MB_MEMORY_TEST.XEX`, `implementation/memory_stress_test.asm`, and `implementation/MEMORY_STRESS_TEST.XEX`: replaced the fixed screen address with startup relocation based on the OS `SAVMSC` vector, so diagnostics remain visible with BASIC enabled or disabled.
- 2026-09-13: `implementation/u1mb_memory_test.asm`, `implementation/U1MB_MEMORY_TEST.XEX`, `implementation/memory_stress_test.asm`, and `implementation/MEMORY_STRESS_TEST.XEX`: use `$9C40` only as the relocation's canonical assembly address; all runtime screen stores now move to the actual `SAVMSC`, including `$BC40` when BASIC is disabled.
- 2026-09-13: `jsA8E/js/core/io.js`: added temporary diagnostic logging for actual `PORTB` changes, including CPU PC, cycle, old/new value, selected bank, and CPU/ANTIC window state. This is instrumentation for the Mikie memory-transition investigation and does not alter emulation behavior.
- 2026-09-12: `implementation/u1mb_memory_test.asm` and `implementation/U1MB_MEMORY_TEST.XEX`: replaced letter progress markers with Atari display characters: `-` for completed banks, `#` for write pages, `+` for read pages, and `!` for an error marker.
- 2026-09-12: `implementation/u1mb_memory_test.asm` and `implementation/U1MB_MEMORY_TEST.XEX`: clarified the 576K COMPY result label from `576K` to `576C`; the bank-selection and verification logic are unchanged.
- 2026-09-12: `implementation/u1mb_memory_test.asm` and `implementation/U1MB_MEMORY_TEST.XEX`: corrected the remaining bank-progress marker that still used screen code `$21` (`A`); completed banks now consistently use `-` (`$0D`).
- 2026-09-13: `jsA8E/js/core/memory.js`: aligned U1MB 576K/1088K ROM-overlay behavior with AHRM. BASIC and Self-Test are no longer forcibly disabled when the CPU extended-memory window is enabled; their state changes only on PORTB writes while that window is disabled. This preserves the documented U1MB shadow-PIA behavior and is independent of AtariBlast.
- 2026-09-13: `jsA8E/js/core/io.js`: completed the U1MB overlay correction. PORTB writes with the CPU extended-memory window enabled now preserve the current BASIC/Self-Test visibility while changing banks; writes with the window disabled still apply the documented PORTB overlay bits. This keeps the I/O mapping consistent with the U1MB state model in `memory.js` and AHRM.
- 2026-09-13: `jsA8E/js/core/memory.js`: corrected ANTIC reads while the CPU extended-memory window is active. ANTIC now reads the live selected-bank view instead of stale bank storage, so shared CPU+ANTIC profiles such as RAMBO and U1MB see CPU writes immediately during DMA. Bank storage remains the persistence source after the CPU window changes or closes.
- 2026-09-12: `implementation/u1mb_memory_test.asm` and `implementation/U1MB_MEMORY_TEST.XEX`: fixed Stage 2 status rendering by clearing all reused status rows before writing its label and result, preventing Stage 1 `A`/`B` progress markers from appearing after the new text.
- 2026-09-12: `implementation/U1MB_MEMORY_TEST.XEX` and `implementation/u1mb_memory_test.asm`: added a standalone machine-code test that detects the AHRM 130XE, 320K RAMBO, 576K COMPY, or 1088K bank map, exercises its full banks, displays page-level write/read progress, and reports PASS or FAIL on the OS screen. It avoids BASIC because U1MB bank bits reuse the BASIC/Self-Test control bits; screen-code labels use Atari display encoding.

- 2026-09-10: `A8E/6502.c`: matched the validated jsA8E NMI dispatch fix. Native A8E now accepts one pending NMI edge while an earlier NMI handler is active, instead of dropping it behind the software active-handler guard. The single pending flag is retained to avoid queueing unbounded interrupts.
- 2026-09-11: `A8E/Pokey.c`: synchronized disk READ responses with jsA8E by delivering the command ACK separately from the Complete/data/checksum phase. The pending phase is queued when the ACK is consumed, matching AHRM SIO framing without changing write, status, format, or poll commands.

Reference: follow `AGENTS.md`.
Process rule: review this file before planning any improvement, and update it after each code improvement.

Maintenance rule: temporary diagnostics and single-purpose test routines must be removed after the related bug is confirmed, unless they are generalized into reusable regression tests. Avoid accumulating one-off test hooks in the emulator.

Keep reusable inspection points: the public `A8EAutomation` connection and general-purpose memory, CPU, state, trace, disassembly, breakpoint, and input controls may remain available for future investigations. Remove only game-specific wrappers, probes, counters, and cache-busters once their investigation is complete.
- 2026-09-24: `jsA8E/js/core/{state,memory,io,pokey_sio}.js`: the AHRM disk READ acknowledgment and Complete/data phase separation, first introduced as an Animal Party compatibility experiment, was validated by loading and playing Animal Party successfully in jsA8E. A focused automated title fixture remains optional.
- 2026-09-10: `A8E/Pokey.c`, `jsA8E/js/core/pokey_sio.js`: added generic AHRM handling for disk `$3F` high-speed index queries and silent routing for absent Type 1/3/4 peripherals. Disk IDs use the high-speed query; non-disk devices do not receive fabricated responses.

## Project Paths
- `A8E/` -> native C implementation.
- `jsA8E/` -> browser JavaScript implementation.
- `implementation/A8E/` -> native C implementation notes.
- `implementation/jsA8E/` -> browser JavaScript implementation notes.

## Update Rules
- Keep entries short and practical.
- Add/update notes when behavior or structure changes.
- Maintain a short `Files` list for fast navigation.

## Notes Template
- Files: key files to open first.
- Purpose: what this area is responsible for.
- Status: verified implementation state (`implemented`, `partial`, or `pending`).
- Notes: short implementation details (simplified).
- Issues: known issues, limitations, or missing implementation items.
- Todo: next improvements or checks.

## A8E (C) Implementation Notes
- [CPU (6502)](A8E/CPU.md)
- [ANTIC](A8E/ANTIC.md)
- [GTIA](A8E/GTIA.md)
- [POKEY](A8E/POKEY.md)
- [PIA](A8E/PIA.md)
- [Atari I/O and System Glue](A8E/SYSTEM.md)
- [Debug](A8E/DEBUG.md)

## jsA8E (JavaScript) Implementation Notes
- [Core Emulation](jsA8E/CORE.md)
- [Input and Host/Device Integration](jsA8E/INPUT_HOST.md)
- [Rendering / CRT](jsA8E/RENDER.md)
- [Audio](jsA8E/AUDIO.md)
- [Automation / Public Machine API](jsA8E/AUTOMATION.md)
- [UI / Interface](jsA8E/UI.md)
- [Worker Boundary](jsA8E/WORKER.md)
- [Debug](jsA8E/DEBUG.md)

## Recent Improvements

- 2026-09-10: `jsA8E/js/core/{state,cpu,antic,atari,app_proxy}.js`, `jsA8E/js/app/automation/utils.js`, `jsA8E/emulator_worker.js`: added non-invasive DLI/VBI/NMI timing diagnostics to `getDebugState()` and preserved them across the Worker boundary. The counters distinguish scheduled, latched, suppressed, requested, coalesced, and serviced NMIs, including the last event location, coalesced source classification, CPU pending/active state, and RTI/RTS return counts; emulation behavior is unchanged and the counters reset with the machine. A temporary Worker URL cache-buster is marked in `app_proxy.js` for live Chrome diagnostics.
- 2026-09-10: `jsA8E/js/core/cpu.js`, `jsA8E/tests/cpu_interrupt_step_regression.test.js`: removed the software `nmiActive` mask from pending-NMI dispatch. A new edge can now be serviced while an earlier NMI handler is active, while the single pending flag still prevents an unbounded queue; this follows the 6502 NMI behavior and targets the DLI coalescing observed with World Karate Championship (v1,ED).

- 2026-09-10: `jsA8E/js/core/{atari,state,antic,memory}.js`, `jsA8E/js/{core/app_proxy,app/automation/utils}.js`: extended `getDebugState()` with non-invasive POKEY timer-4 diagnostics (`IRQEN`, `IRQST`, timer configuration, deadline, IRQ count, and CPU IRQ state) to investigate Bosconian's digitized-voice wait loop. The field is now preserved across the worker/API boundary, the diagnostic counter is preserved in snapshots, and neither changes emulation behavior.
- 2026-09-10: `jsA8E/js/core/{pokey,io,atari}.js`: arm inactive POKEY timers when valid AUDF/AUDCTL or SKCTL configuration arrives after an earlier STIMER, without resetting already-running timer phase. This covers software that configures a timer after initialization and is based on AHRM POKEY initialization behavior.
- 2026-09-10: `A8E/Pokey.c`: ported the inactive POKEY timer arming behavior to the native core. AUDF/AUDCTL/SKCTL writes now schedule a valid timer that previously had no deadline without disturbing active timer phase; the implementation is independent of memory expansion.
- 2026-09-10: `A8E/{A8E.c,AtariIo.c,AtariIo.h,Pia.c}`, `A8E/README.md`: added the first native memory-expansion profile, 130XE 128K, selectable with `-128K`. PORTB selects the four 16K banks and separate CPU/ANTIC window enables; ANTIC playfield, virtual-bus, and PMG reads honor the extended window. Larger RAMBO/COMPY profiles remain unimplemented.
- 2026-09-10: `A8E/{AtariIo.h,AtariIo.c,Pia.c}`: preserved a shadow copy of the main `$4000-$7FFF` window while the 130XE CPU window is enabled, restoring it when the window is disabled. This is required by Bosconian's bank-isolation test and prevents extended-bank writes from corrupting the visible main-memory copy.
- 2026-09-10: `A8E/A8E.c`, `A8E/README.md`: added a startup log reporting the selected native memory profile, matching the existing audio startup diagnostics.
- 2026-09-10: validated native `-128K` with `Bosconian.atr`; Bosconian now detects the 130XE memory, loads successfully, and its digitized-voice audio works with the native POKEY timer fix. RAMBO and COMPY profiles remain pending.

- 2026-08-03: real-content spot verification of the timing changes below via the headless runtime with real XL OS/BASIC ROMs: cold boot reaches the BASIC READY prompt with byte-exact screen contents, the SELF TEST menu renders correctly, and `d1.atr` (DOS 2.x boot + Schränker 3 with its DLI color-ladder title screen) loads and renders cleanly. The full disk-content regression sweep from `legacy/COLOR_CLOCK_ACCURACY.md` remains open.

- 2026-08-03: `A8E/AtariIo.{c,h}`, `jsA8E/js/core/{antic,state,memory}.js`, `jsA8E/js/core/playfield/{renderer_base,mode_2_3,mode_4_5,mode_6_7}.js`, `A8E/tests/antic_timing_probe.c`, `jsA8E/tests/antic_vscrol_timing.test.js`: replaced the fetch-time VSCROL height clamps with a live 4-bit mode-line row counter per AHRM 4.7 in both cores. Region entries latch VSCROL at the mode-line fetch and wrap out-of-range values (GTIA 9++ extended lines now work); region-exit lines end when the counter matches the live VSCROL value latched at the top of the cycle-109 clock action (writes through cycle 108 count), so mid-mode-line VSCROL rewrites shorten, extend, or wrap the line. Exit-line DLIs are armed dynamically at cycle 6 of the scanline whose counter matches VSCROL as of cycle 5 (AHRM 4.8), letting the DLI and height decisions diverge as in the documented turbo double-write trick. Character renderers now derive glyph rows from the row counter with the AHRM tall-line mappings (modes 2/3 rows 10-15 repeat 2-7 and rows 8-9 blank/descend, modes 4/6 repeat rows 0-7, modes 5/7 halve the scanline counter); the old `verticalScrollOffset` plumbing was removed. JS snapshots persist the new row-counter state and tolerate older payloads. 

- 2026-08-03: `A8E/{Antic.c,AtariIo.c,AtariIo.h,6502.c,6502.h}`, `A8E/tests/antic_graphics_modes_probe.c`: ported the jsA8E delayed CHBASE latch to the C core per AHRM 4.4. `Antic_CHBASE` schedules the new value 2 color clocks after the bus write (offset by instruction length minus one via the new `cCurrentInstructionCycles` context field), and character modes 2-7 poll `AtariIo_CurrentChbaseRegister` every render cycle instead of snapshotting CHBASE before the loop, so mid-scanline DLI character-set switches land at the correct beam position in both cores.

- 2026-08-03: `A8E/{Antic.c,AtariIo.c,AtariIo.h}`, `jsA8E/js/core/{antic,state,memory}.js`, `A8E/tests/antic_timing_probe.c`, `jsA8E/tests/antic_display_list_nmi.test.js`: aligned VBI timing with AHRM 4.8 in both cores. The VBI now uses the same two-phase model as the DLI: NMIST VBI latches at cycle 7 of scan line 248 (clearing the DLI status bit), the NMI fires at cycle 8, and the NMIEN cycle-7/8 gating (one-cycle delay for a cycle-7 enable, cycle-8 disable suppression) applies. Previously the VBI fired unconditionally at the 247/248 line boundary. JS snapshots persist the armed `vbiCycle` deadline.

- 2026-06-01: `A8E/tests/antic_graphics_modes_probe.c`: restored the probe's SDL-compatible `main(int argc, char *argv[])` signature so the MinGW/SDL2main build no longer conflicts with SDL's `SDL_main` declaration.

- 2026-05-20: `jsA8E/js/core/playfield/mode_8_f.js`, `jsA8E/tests/playfield_mode_8_f_rendering.test.js`: corrected JS ANTIC mode A bitmap expansion to consume all four two-bit pairs in each byte. Mode 8 still repeats each pair across two output cycles, but mode A now advances per pair, fixing the broken Archon board-border bitmap line.

- 2026-05-20: `jsA8E/js/core/hw.js`, `A8E/AtariIo.c`, `jsA8E/tests/playfield_geometry_timing.test.js`: merged the viewport-centering change with the corrected AHRM GTIA origin. The normal 320-pixel playfield starts at full-line `x=96`, so the 336-pixel visible crop starts at `x=88` and keeps the playfield at screen `x=8..327`.

- 2026-05-12: `A8E/AtariIo.c`, `A8E/tests/antic_graphics_modes_probe.c`, `jsA8E/js/core/{gtia,playfield/{playfield,renderer_base}}.js`, `jsA8E/tests/{playfield_geometry_timing,playfield_hscroll_priority_preservation,gtia_pmg_dma_regression}.test.js`: corrected the GTIA/playfield horizontal origin. Normal-width playfield now starts at GTIA color clock `$30` (`x=96` in the 456-pixel line buffer) instead of the previous shifted `x=104`, which centers character modes in the 336-pixel viewport. PMG `HPOS=$30` now maps to the same `x=96` coordinate. Native probes now verify modes 2-7 start at the corrected origin.

- 2026-05-12: `A8E/AtariIo.c`, `A8E/tests/antic_graphics_modes_probe.c`, `A8E/tests/{antic_timing_probe,antic_dma_probe}.c`, `jsA8E/js/core/{atari,playfield/mode_2_3}.js`, `jsA8E/tests/playfield_mode_2_3_rendering.test.js`: tightened ANTIC character-mode rendering against AHRM 4.4/4.11/4.14. Modes 2/3 now treat CHACTL blank+invert as an inverted zero glyph in both cores; JS blanking no longer depends on the character-0 font contents. Native mode 5 now uses the required 1K CHBASE alignment, and native modes 5/7 fetch character data on every repeated scanline instead of silently skipping odd doubled rows. Added a native graphics-mode probe for these regressions and refreshed native DLI probe constants to the current NMIST-cycle representation.

- 2026-04-14: `jsA8E/js/core/{cpu,io}.js`, `jsA8E/js/core/playfield/renderer_base.js`: corrected CHBASE delayed-latch origin per AHRM 4.4. The 2-color-clock latch delay must be measured from the bus write cycle (last cycle of the instruction), not from the instruction start. Since `executeOne` runs instructions atomically, the IO handler now offsets by `(ctx.currentInstructionCycles − 1)` to place the write at the correct point. For STA absolute (4 cycles), the effective latch is now at `io.clock + 5` instead of `io.clock + 2`, fixing a 3-cycle-early CHBASE effect that caused DLI-driven character set switches (e.g. Archon 2 attract mode) to show fewer garbled characters than real hardware.

- 2026-04-13: `A8E/AtariIo.c`, `jsA8E/js/core/antic.js`, `jsA8E/tests/antic_display_list_nmi.test.js`: aligned DLI NMIST/NMI timing with AHRM 4.8 in both cores. `DLI_HORIZONTAL_OFFSET` changed from 8 to 7 (the NMIST cycle); the event handler now sets NMIST at cycle 7 unconditionally and fires the NMI at cycle 8. The `enabledOnCycle7Mask` delay path now reschedules to `beamCycle` (not `beamCycle+1`) so the delayed NMI fires one cycle later at cycle 9. Tests updated to exercise the two-phase cycle-7/cycle-8 behavior explicitly.

- 2026-04-09: `A8E/AtariIo.c`, `jsA8E/js/core/gtia.js`, `jsA8E/tests/gtia_pmg_dma_regression.test.js`: aligned PM horizontal origin with the then-current playfield coordinate map. This was superseded on 2026-05-12 by the corrected GTIA color-clock origin (`HPOS $30 -> x=96`). The interleaved PMG renderer in both cores continues to use the per-line shift-register/state-machine model.

- 2026-04-08: `A8E/AtariIo.c`, `A8E/AtariIo.h`, `jsA8E/js/core/{gtia,antic,memory,state}.js`, `jsA8E/tests/gtia_pmg_dma_regression.test.js`: replaced the interleaved PMG line latch with a bounded per-line trigger queue in both cores. Active PM objects keep their original horizontal start through mid-image `HPOS` writes, `HPOS=0` renders correctly, and repeated rightward same-line retriggers can now build overlapping duplicate images again (matching `dbug.atr` style logo assembly more closely). JS snapshots now preserve the PMG queue state.

- 2026-04-08: `A8E/AtariIo.c`, `jsA8E/js/core/playfield/{mode_4_5,mode_6_7}.js`, `jsA8E/js/core/playfield/renderer_base.js`: fixed character-mode CHACTL/CHBASE timing in both cores. In JS, CHACTL is now latched once at scanline start in modes 4/5/6/7 (matching existing mode 2/3 behavior), and the CHBASE delayed-latch window corrected from +1 to +2 cycles per AHRM 4.4. In C, CHBASE and CHACTL are now snapshotted before the render loop in all modes 2–7, eliminating mid-scanline DLI drift. C modes 2/3 now also correctly implement CHACTL bit 0 (blank), bit 1 (invert), and bit 2 (vertical reflection), which were previously unimplemented; bit 2 reflection is now applied in all C modes 4–7 as well.

- 2026-04-05: `jsA8E/js/core/playfield/renderer_base.js`, `jsA8E/tests/playfield_dma_contention_regression.test.js`: tightened the JS ANTIC virtual-bus path per AHRM 4.14. Late playfield fetches after cycle 105 now honor the active CPU bus address even when it is `$0000` (fixed JavaScript truthiness bug), while the deferred-refresh overlap case remains pinned to pulled-up `$FF`.

- 2026-04-03: `jsA8E/js/core/{antic,io,memory,state}.js`, `jsA8E/js/core/playfield/{renderer_base,mode_8_f}.js`: simplified JS emulation core state flow. `state.js` now owns the fixed `ioData` shape (including `nmiTiming`, `chbaseTiming`, per-line DMA buffers); ANTIC and the playfield renderer no longer rebuild these lazily in hot paths. Media helpers normalize a single shared `machine.media` object instead of patching nested fields in place.

- 2026-04-03: `A8E/{AtariIo.h,Pokey.c}`, `jsA8E/js/core/{atari,io,memory,pokey,state}.js`: aligned POKEY pot-scan model with AHRM. Slow scans advance once per scanline; fast scans advance per machine cycle and hold the `229` terminal count for one extra cycle before forcing `ALLPOT` low; scans run through terminal hold even when `ALLPOT` has already cleared; `SKCTL` mode changes resync from current cycle. JS snapshots preserve mid-scan counter state.

- 2026-04-03: `A8E/{Antic.c,AtariIo.c}`, `jsA8E/js/core/{antic,io,memory,state}.js`: aligned same-scanline DLI `NMIEN` timing with AHRM 4.8 in both cores. Writes by cycle 7 enable the current-line DLI (with one-beam-cycle delay); writes on cycle 8 can still suppress it; NMIST latches unconditionally. JS snapshot state extended to preserve the ANTIC timing latch.

- 2026-03-31: `A8E/AtariIo.{c,h}`, `jsA8E/js/core/{state,memory,antic}.js`, `jsA8E/js/core/playfield/{renderer_base,mode_2_3,mode_4_5,mode_6_7,mode_8_f}.js`: completed ANTIC heavy-contention DMA pass in both cores. Playfield DMA scheduled per line cycle (not bulk stall); first-row fetches fill a reusable 48-byte line buffer; character modes 2–7 place character-data fetch in the later `+3` cycle slot; late fetches after cycle 105 use the virtual CPU bus / refresh-drop path.

- 2026-03-31: `A8E/AtariIo.c`, `jsA8E/js/core/antic.js`: corrected ANTIC NMI timing in both cores. DLI asserts at cycle 8 of the triggering scanline per AHRM 4.8; VBI asserts at the start of scan line 248. VCOUNT flips to the next scanline on cycle 111 of the previous line per AHRM 4.10, including the one-cycle PAL end-of-frame anomaly. Active-line playfield geometry corrected to AHRM 4.14 width starts.

- 2026-03-26: `A8E/6502.c`, `jsA8E/js/core/cpu.js`: aligned undocumented opcodes with the fake6502/Lorenz reference suite in both cores. Covers `ANE`, `LXA`, `ARR`, `LAS`, `SHA`, `SHX`, `SHY`, `TAS`, `RRA`, `SBX`, including the `SHX`/`SHY` write-address glitch and `RRA`/`ISC` decimal-cycle cancellation.

- 2026-03-26: `jsA8E/mcp_server.js`, `jsA8E/tests/mcp_server.test.js`, `jsA8E/package.json`, `README.md`, `jsA8E/README.md`, `jsA8E/AUTOMATION.md`, `implementation/jsA8E/AUTOMATION.md`, `implementation/NOTES.md`: added a local stdio MCP bridge over the headless jsA8E automation runtime for Codex-style clients. The server now exposes `get_capabilities`, `get_system_state`, and `call_automation` with grouped `domain`/`action` routing, keeps binary payloads on base64 or file-path boundaries, and returns screenshot image content plus structured base64 data.

- 2026-03-20: `jsA8E/js/core/{atari.js,atari_snapshot.js}`, `jsA8E/index.html`, `jsA8E/headless.js`, `jsA8E/emulator_worker.js`, `jsA8E/tests/snapshot_save_timing.test.js`: split the snapshot encode/decode and restore cluster out of `atari.js` into a dedicated runtime module. `atari.js` now keeps thin config helpers plus public wrappers, while `A8EAtariSnapshot` owns snapshot building, save/load, screenshot capture, and artifact collection.

- 2026-03-20: `jsA8E/js/app/automation/{build,xex,automation_api}.js`, `jsA8E/index.html`, `jsA8E/headless.js`, `jsA8E/tests/automation_{memory_helpers,snapshot_api,system_state_resilience,url_media_loading,xex_boot_failure}.test.js`: split the build/source-context/disassembly helper cluster out of `automation_api.js` into a dedicated support module. Assembly now owns the last-build record and source lookup/disassembly helpers behind `A8EAutomationBuild`, while `automation_api.js` keeps only thin API wrappers and the boot/load harnesses load `build.js` before the facade.

- 2026-03-20: `jsA8E/js/app/automation/{xex,automation_api}.js`, `jsA8E/index.html`, `jsA8E/headless.js`, `jsA8E/tests/automation_{memory_helpers,snapshot_api,system_state_resilience,url_media_loading,xex_boot_failure}.test.js`: split the XEX boot/orchestration helper cluster out of `automation_api.js` into a dedicated support module. `runXex` now delegates to the new helper layer, and the boot/load harnesses load `xex.js` before `automation_api.js` so the public API can stay thin.

- 2026-03-20: `jsA8E/js/app/automation/{media,artifacts,automation_api}.js`, `jsA8E/index.html`, `jsA8E/headless.js`, `jsA8E/tests/automation_{memory_helpers,snapshot_api,system_state_resilience,url_media_loading,xex_boot_failure}.test.js`: split the media/resource-loading helper cluster out of `automation_api.js` into a dedicated support module. URL fetch, ROM/disk request normalization, HostFS include resolution, assembler option building, and URL-backed media loaders now live behind the new helper layer, while `automation_api.js` keeps only the thin public wrappers.

- 2026-03-20: `jsA8E/js/app/automation/{artifacts,automation_api}.js`, `jsA8E/index.html`, `jsA8E/headless.js`, `jsA8E/tests/automation_{memory_helpers,snapshot_api,system_state_resilience,url_media_loading,xex_boot_failure}.test.js`: split the artifact/failure snapshot cluster out of `automation_api.js` into a dedicated helper module. The public API still exposes the same methods, but wait failure snapshots, artifact bundles, and XEX boot failure capture now delegate through thin wrappers backed by the new support file, and every boot path/test harness loads that support file before `automation_api.js`.

- 2026-03-20: `jsA8E/js/core/{atari.js,atari_support.js}`, `jsA8E/index.html`, `jsA8E/emulator_worker.js`, `jsA8E/headless.js`: split the snapshot/video/artifact helper cluster out of `atari.js` into a shared support module. `atari.js` now keeps boot/runtime orchestration, while the new helper file owns reusable video cloning/restoration, frame-alignment, artifact range normalization, and screenshot capture logic.

- 2026-03-20: `jsA8E/js/core/playfield/mode_8_f.js`: reduced the repeated ANTIC 8/F scanline write blocks by introducing small pair/quad write helpers and a shared mode 8/A body. The helper cuts keep the hot-path structure explicit while removing the largest duplicated pixel-write fragments in the file.

- 2026-03-20: `jsA8E/js/core/playfield/mode_2_3.js`: reduced the duplicated ANTIC mode 2/3 text scanline bodies with a shared helper that takes the character-row fetch function and scroll base as parameters. The wrappers are now thin mode selectors, which keeps the mode-specific differences obvious while removing repeated pixel-write code.

- 2026-03-20: `jsA8E/js/core/playfield/mode_{4_5,6_7}.js`: reduced duplicated text-mode scanline bodies by introducing per-file common render helpers for the paired ANTIC modes. The wrappers now only select the fetch function and scroll/DMA variant, which makes the inner loops easier to follow without changing behavior.

- 2026-03-20: `jsA8E/js/app/automation/{utils,automation_api}.js`: split out shared automation helpers for XEX launch, failure normalization, timeout parsing, and state cloning. `automation_api.js` now keeps orchestration only, while `utils.js` owns the reusable helper layer, including the preflight range clone used by XEX snapshots.

- 2026-03-20: `jsA8E/js/core/gtia.js`, `jsA8E/js/core/playfield/mode_8_f.js`, `implementation/NOTES.md`: small runtime cleanup pass. Removed the unused `vdelayMask` parameter from the GTIA PMG DMA address helper and hoisted the mode-F M10 priority lookup table out of the inner scanline loop to reduce per-cycle allocation churn.

- 2026-03-19: `jsA8E/js/core/gtia.js`, `A8E/AtariIo.c`: fixed PMG DMA timing in both cores. `VDELAY` now masks per-sprite DMA fetches on even scan lines instead of shifting PMG memory rows; player DMA keeps the missile slot active as required by AHRM 4.13. Native C now uses a unified cycle-accurate `AtariIo_FetchPmgDmaCycle` scheduled in `AtariIo_DrawClockAction` at the documented DMA cycle slots.

- 2026-03-19: `jsA8E/js/core/playfield/playfield.js`, `jsA8E/js/core/playfield/renderer_base.js`, `A8E/AtariIo.c`: fixed HSCROL clip/background fill paths to preserve already-composited PMG pixels in both the clipped aperture fill and trailing border area.

- 2026-03-19: `jsA8E/js/core/{gtia,antic,atari}.js`, `jsA8E/js/core/playfield/`, `jsA8E/js/core/state.js`: code quality review pass. Fixed GTIA priority mask truncation (`& 0xffff`), wired `PRIO_PF3`/`PRIO_M10_PM0-3` through the full config chain, corrected VCOUNT update ordering in `clockAction()`, removed dead code throughout.

- 2026-08-16: `jsA8E/{index.html,style.css,js/app/ui.js,js/core/{hw,atari,app_proxy}.js,emulator_worker.js}`: wired a minimal PAL/NTSC selector into the browser UI and boot path. The selected standard now persists through `window.A8E_BOOT_OPTIONS` / `localStorage`, reaches both the main-thread and worker backends before hardware setup, and rebuilds the timing tables on reload. `hw.js` now selects PAL vs NTSC line count and CPU clock from the boot standard, and `$D014` reads back `01` for PAL / `0F` for NTSC per AHRM so `peek(53268)` can distinguish the machine type again.


- 2026-08-17: `jsA8E/{index.html,style.css,js/app/ui.js,js/core/{state,io,memory,atari,app_proxy}.js,emulator_worker.js}`: reworked the browser memory-expansion path on top of the clean PAL/NTSC base. The UI now exposes a profile selector, `PORTB` writes preserve the raw banking bits, and the runtime carries the active extended-RAM profile through main-thread and worker boot/reset flows while restoring the banked window on `PORTB` changes. Snapshot state now includes the memory profile so COMPY and larger RAMBO variants can keep CPU/ANTIC views separate.

- 2026-08-17: project checkpoint.
  - Confirmed: PAL/NTSC selector is wired through the browser boot path.
  - Confirmed: `peek(53268)` distinguishes PAL and NTSC again.
  - Confirmed: PAL and NTSC now use separate browser palette tables.
  - Confirmed: the BASIC color-bar test shows a visible PAL/NTSC difference.
  - Pending: memory-expansion compatibility still needs a clean verification pass.


- 2026-08-17: `jsA8E/{js/render/{palette,software}.js,js/core/atari.js}`: split the browser color palette by video standard so NTSC and PAL no longer share a single RGB table. The renderer now passes `videoStandard` into palette construction, giving NTSC its own chroma tuning path and leaving PAL with a separate mapping.
- 2026-08-17: `jsA8E/{js/render/{palette,software}.js,js/core/atari.js}`: restored the PAL palette to the original C hue table and switched NTSC to a separate, more evenly spaced hue progression. The browser renderer still selects the palette from `videoStandard`, so PAL keeps its prior look while NTSC can diverge more realistically.
- 2026-08-17: `jsA8E/js/render/palette.js`: documented the calibrated palette split for future reference. PAL keeps the legacy C hue table (`0, 163, 150, 109, 42, 17, -3, -14, -26, -53, -80, -107, -134, -161, -188, -197`), while NTSC uses the smoother progression (`0, 163, 139, 115, 91, 67, 43, 19, -5, -29, -53, -77, -101, -125, -149, -173`). This was verified visually with the BASIC color-bar test, which now shows a clear PAL/NTSC difference without collapsing the PAL palette.

- 2026-09-08: `A8E/{A8E.c,AtariIo.{c,h},Gtia.c,Pokey.c}`: ported the PAL/NTSC machine selection to the native C emulator. PAL remains the default; `-n` selects NTSC with 262 lines, 1.789773 MHz POKEY timing, `$D014 = $0F`, a separate NTSC palette, and an NTSC logical pixel aspect. The internal 456-pixel line and maximum 312-line allocation remain shared only as storage limits; active timing and register behavior use the selected machine state.

- 2026-09-09: `A8E/A8E.c`: replaced the fixed 18 ms no-audio fallback delay with the selected machine's rounded frame period. This prevents NTSC (about 16.68 ms per frame) from being throttled below its native cadence while preserving PAL's approximately 20 ms cadence.
- 2026-09-09: `A8E/Pokey.c`: added startup diagnostics for SDL audio initialization, device opening, and negotiated format. Audio failures previously fell back to silent operation without reporting the cause.
- 2026-09-09: `A8E/{A8E.c,Pokey.{c,h},AtariIo.c,AtariIo.h}`: added `-d` audio diagnostics. The native emulator writes per-frame CSV metrics for ring level, generated/consumed samples, underruns, overruns, selected standard, and SDL audio status.
- 2026-09-09: `A8E/A8E.c`: audio playback now uses the SDL ring buffer as the sole active timing source. The PAL/NTSC frame-delay fallback is used only when SDL audio is not playing, preventing the extra delay from causing audio underruns.
- 2026-09-09: `A8E/Pokey.c`: on Windows only, failed default SDL audio opening now retries with `SDL_AudioInit("directsound")`; Linux and macOS retain SDL's automatic backend selection. Startup logs now include the active SDL audio driver.
- 2026-09-09: `A8E/Pokey.c`: accepted SDL devices negotiating mono or stereo output. The native POKEY mixer remains mono and duplicates each frame into both channels for stereo devices, avoiding a false initialization failure when Windows defaults to two channels.
- 2026-09-09: `A8E/Pokey.c`: accepted SDL devices negotiating 32-bit signed or float output in addition to `AUDIO_S16SYS`. In particular, `0x8120` is `AUDIO_F32SYS`; the callback converts the 16-bit POKEY mixer output to float or signed 32-bit samples and preserves mono/stereo handling.
- 2026-09-09: `A8E/Pokey.c`: corrected the SDL callback branch selection so `AUDIO_F32SYS` uses the 32-bit conversion path instead of being written as 16-bit PCM. This fixes silent output when the Windows WASAPI device negotiates format `0x8120`.
- 2026-08-21: `Memory` branch: restored the PAL/NTSC palette selection lost during the merge from `main`. The memory-expansion changes remain untouched; the software renderer now receives the hardware video standard and selects the matching PAL or NTSC hue table.

- 2026-09-10: `jsA8E/js/core/pokey_sio.js`, `jsA8E/js/core/pokey.js`: made the absent-device path explicitly clear pending `SERIN` data, the pending read phase, and the SERIN-ready flag before allowing `$3F/$40` polls to time out. This preserves the no-response behavior while preventing stale bytes from a previous SIO command from being consumed as a poll result.
- 2026-09-10: `jsA8E/js/core/pokey_sio.js`: corrected the timeout cleanup to use the configured `CYCLE_NEVER` sentinel. The missing local constant caused the CPU execution error that appeared as the blue-screen hang after the first timeout patch.
- 2026-09-10: `jsA8E/js/core/atari.js`: completed the SIO timeout wiring by passing the active frame-cycle value into POKEY/SIO. Without this connection, absent-device timeouts were scheduled with `NaN` and `TIMFLG` could never be raised.
- 2026-09-10: `jsA8E/js/core/{pokey_sio,antic}.js`: corrected `TIMFLG` polarity using the OS definition: SIO waits start with `$0317=1`, and an absent-device timeout changes it to `$00`. The previous diagnostic implementation inverted this flag.
- 2026-09-10: `jsA8E/js/core/antic.js`: completed the generic absent-SIO-device timeout cleanup. When `TIMFLG` expires, pending serial timing events, frame phases, response bytes, and active-low serial IRQ sources are cleared without changing the OS DCB or inventing a peripheral response.
- 2026-09-10: `jsA8E/js/core/{atari,pokey,pokey_sio}.js`: aligned the synthetic absent-device `DTIMLO` timeout to the next OS VBI (scan line 248) instead of expiring at an arbitrary SIO command cycle. The selected PAL/NTSC frame geometry is passed into SIO so the timing remains standard-specific.
- 2026-09-10: `jsA8E/js/core/pokey_sio.js`: stopped rearming the absent-device `DTIMLO` timeout on every Type 1 poll retry. The first unanswered `$3F` command starts one timeout window; subsequent retries remain silent until that same window expires.
- 2026-09-11: `jsA8E/js/core/pokey_sio.js`: cleared all three active-low serial IRQST sources (`$08/$10/$20`) before an absent-device poll retry. Clearing only SERIN could leave stale SEROUT/ transmission-done state from the preceding disk command and alter the OS SIOV retry path.
- 2026-09-11: `jsA8E/js/core/pokey_sio.js`: made absent `$3F/$40` SIO devices fully silent by removing the artificial `IRQST`, `TIMFLG`, SERIN and SEROUT cleanup. The OS now exclusively owns the timeout/retry result, per AHRM 9.1.
- 2026-09-11: `jsA8E/{js/core/app_proxy.js,emulator_worker.js}`: versioned the worker and `pokey_sio.js` URLs as `sio-silent1` so the absent-device behavior change cannot be hidden by browser cache.
- 2026-09-11: removed AtariWriter-only reset/checksum/status probes, CDP wrappers, cache-busters, and placeholder 850/R: device classes after that investigation was paused. Generic SIO disk phases, absent-device routing, bounded SIO events, and reusable public inspection APIs remain.
- 2026-09-13: added `ATR/mikie.md` as the reference for the Mikie V1.12 investigation. It records the XEX/temporary-ATR distinction, banked segment layout, observed SIO and CPU failure state, current diagnosis, AHRM references, and the bounded PORTB-transition diagnostic proposed for the next comparison.
- 2026-09-13: added `ATR/AtariBlast.md` as the reference for Atari Blast. The initial entry records the mixed 128/256-byte ATR geometry, custom boot/SIO observations, the absence of runtime results so far, and the AHRM-compliant investigation order.
- 2026-09-13: updated `ATR/AtariBlast.md` with the first live jsA8E observation: valid 256-byte D1 reads reached at least sector 582 while Ultimate1MB bank switching remained active, followed by a suspected OS SIO/VBI load stall without CPU fault or reset. No workaround was added.
- 2026-09-13: updated `ATR/AtariBlast.md` with the later live result: after the long load, Atari Blast entered a repeating `$0000`/`$C02C` BRK/vector path with descending SP, without SIO timeout or illegal opcode. The issue is now classified as post-load control-flow corruption; no patch was added.
- 2026-09-13: updated `ATR/AtariBlast.md` after re-reading the image: Atari Blast's loader writes `$D301` and reads `$7FFE-$7FFF`, confirming that bank contents, not only expansion size, are required during loading. The next comparison must correlate PORTB writes with window reads before any fix is attempted.
- 2026-09-13: updated `ATR/AtariBlast.md` with the required capability for Atari Blast: profile-accurate PORTB bank mapping/persistence across the `$4000-$7FFF` CPU window, including `$7FFE/$7FFF` reads and final vector/stack handoff. Existing 256-byte SIO reads progress without timeout, so no SIO patch was selected.

### XEX loader target relocation after 16-bit RUNAD fix

The XEX loader's RUNAD check now reads both `$02E0` and `$02E1`. The three-byte expansion moves the `get_byte` and `read_sector` routines and the SIO buffer operands; all internal JSR targets and patch indices in both JavaScript and native loaders must be relocated together. This preserves low-memory RUNAD support without corrupting XEX segment reads.
- 2026-09-13: `A8E/Pia.c`: connected U1MB UCTL memory modes to the generic
  bank mapper: mode 00 disables expansion, mode 01 selects 320K RAMBO, mode
  10 selects 576K COMPY, and mode 11 selects 1088K RAMBO-style banking.
  UCTL writes immediately resynchronize the active PORTB window.
- 2026-09-13: `A8E/Pia.c`: applied the U1MB Shadow PIA overlay rule. While the
  CPU extended-memory window is enabled, PORTB bank writes no longer change
  BASIC/OS/Self-Test overlays; those controls update only when the CPU window
  is disabled, matching AHRM 12.3 sequence-dependent behavior.
- 2026-09-13: `A8E/{AtariIo.c,AtariIo.h,Pia.c}`: added the U1MB UPBI/UCAR
  configuration register and read-only PBI button status surface. These
  registers are isolated to the U1MB profile and honor the configuration lock.
- 2026-09-13: `A8E/README.md`: documented the native RAMBO/COMPY/U1MB command
  line profiles and clarified that U1MB BIOS/flash/PBI image emulation needs
  an external image; no synthetic firmware contents are provided.
- 2026-09-13: `A8E/AtariIo.c`: corrected U1MB register installation so
  `$D380-$D384` remain OS ROM on ordinary 64K/130XE/RAMBO/COMPY machines and
  are remapped to U1MB only when `-U1MB` is selected. This prevents the U1MB
  handlers from corrupting the normal XL/XE startup path.
- 2026-09-13: `A8E/Pia.c`: removed the eager ORB application during PBCTL
  direction changes. Applying an uninitialized zero ORB at that point could
  hide the OS ROM before startup software wrote the intended PORTB value.
  PORTB mapping remains driven by explicit PORTB writes until effective DDRB
  handling is completed with pull-up state.
- 2026-09-13: `A8E/Pia.c`: verified the native startup regression fix. Removing
  eager ORB application during PBCTL direction changes restores normal OS ROM
  startup; `A8E` now renders correctly again with default and expanded-memory
  arguments.
- 2026-09-13: `A8E/Pia.c`: corrected the expansion bus matrix. RAMBO profiles
  no longer expose their CPU window to ANTIC; COMPY profiles use the separate
  ANTIC window, and only U1MB mode 1088K uses a shared CPU/ANTIC window, per
  AHRM 2.7 and 12.3.
- 2026-09-13: Native memory-test validation: `-320R` and `-320C` complete
  successfully. `-576R`, `-576C`, and `-1088R` reach the START prompt but
  show graphics corruption during bank testing. `-U1MB` begins testing,
  flickers, and eventually loses the display before the START prompt. These
  results isolate the remaining work to high-map overlay/ANTIC interaction
  and U1MB firmware-independent mapping, rather than the basic 320K bank
  decoder.
- 2026-09-13: `A8E/Pia.c`: fixed high-capacity RAMBO/COMPY bank writes from
  being misinterpreted as BASIC/Self-Test overlay changes. The reused PORTB
  bits are now treated as bank selectors for 576K and 1088K physical profiles;
  U1MB retains its separate Shadow PIA sequencing rule.
- 2026-09-13: `A8E/AtariIo.c`: synchronized ANTIC reads with the live CPU
  window for U1MB's shared 1088K mode. Bank storage is now used only after a
  bank/window transition, matching jsA8E and preventing one-write-late display
  glitches during DMA.
- 2026-09-13: `A8E/{Pia.c,AtariIo.c}`: aligned native shared-window behavior
  with the validated jsA8E profiles. RAMBO 192K/320K/576K/1088K and U1MB
  1088K expose the live CPU window to ANTIC; 130XE and COMPY retain separate
  ANTIC-window rules. This supersedes the earlier native-only interpretation
  that treated RAMBO as CPU-only.
- 2026-09-13: `A8E/AtariIo.c`: matched jsA8E's live-window rule for ANTIC
  reads whenever the CPU extended window is active, including 130XE's
  separate ANTIC window. This keeps display DMA coherent with CPU writes
  during the memory test's visual stage.
- 2026-09-13: `A8E/{AtariIo.h,Pia.c}`: ported persistent expansion state from
  jsA8E. Native transitions now track initialization and BASIC/Self-Test
  visibility separately, calculate new overlay state before committing a
  bank, and preserve high-map forced-off behavior during active CPU windows.
- 2026-09-13: `A8E/Pia.c`: removed the legacy 130XE `PORTB` bit-6 forcing
  during expansion writes. jsA8E preserves the complete written byte and
  derives only the documented bank/window bits; native behavior now matches
  that rule and avoids altering the test's post-load display state.
- 2026-09-14: `jsA8E/js/core/memory.js` and
  `jsA8E/tests/memory_xex_preflight_bank_switch.test.js`: corrected separate
  130XE/COMPY ANTIC visibility. When only the CPU extended-RAM window is
  enabled, ANTIC now reads the preserved motherboard `$4000-$7FFF` view rather
  than the CPU's live bank; enabling the independent ANTIC window still exposes
  that selected bank. This follows AHRM 2.7 and is covered by a regression.
- 2026-09-20: `jsA8E/js/app/hostfs_ui.js`: added a row-level Run action for
  `.XEX` files in HostFS. The action reads the file from H:, loads it into D1:
  through the existing emulator loader, and resets/starts the machine. This is
  a direct UI loader path, not an Atari-side CIO command executed through H:.
- 2026-09-20: `implementation/jsA8E/COMPILER_DEBUGGER.md`: recorded the
  compiler/debugger review. The current XEX workflow is functional, while
  worker Run synchronization, preprocessor source mapping, worker step
  acknowledgements, `stepOverAsync()` validation, object linking, `.SET`
  redefinition, and case-insensitive automation symbol lookup remain follow-up
  items.
- 2026-09-20: `jsA8E/js/app/ui.js`: identified a pending UI improvement for the
  top-bar run/pause control. While a worker lifecycle request is in flight, the
  UI currently disables the control; a future change should coalesce repeated
  clicks and apply the last requested start/pause state after the worker ACK.
  This is now implemented as a GUI-only promise queue; the worker and emulator
  lifecycle behavior remain unchanged. While pending, the run/pause button
  shows a spinner and an explicit busy style so the disabled state is visible.
  If Start is still pending, the first Pause click is accepted as one queued
  intent and subsequent clicks are blocked until that intent is confirmed.
- 2026-09-20: jsA8E: added a separate application fullscreen control. The
  existing fullscreen button and F11 continue to maximize only the Atari
  display; the new workspace button maximizes the complete browser app, keeping
  the toolbar, screen, Disk Library, HostFS, and other panels visible.
- 2026-09-20: jsA8E/js/core/pokey.js: replaced the exponential browser mixer
  volume curve with an AHRM-informed, approximately binary-weighted 4-bit DAC
  table. The approximation preserves the documented wider transitions at
  volume changes 3->4, 7->8, and 11->12; hardware-level calibration remains
  pending real-device or reference-emulator captures.
- 2026-09-20: A8E/Pokey.c: ported the AHRM-informed 4-bit POKEY DAC volume
  table from jsA8E so native and browser mixers now use the same channel
  weighting and transition points.
- 2026-09-25: `A8E/{AtariIo.c,AtariIo.h,Gtia.c}`, `jsA8E/js/core/{antic,atari,gtia,io,memory,state}.js`, and `jsA8E/tests/gtia_pmg_dma_regression.test.js`: started AHRM-07 by recording bounded per-scanline PMG register writes and DMA latch events in both cores. The hidden PMG prefix now replays the line-start register snapshot plus events, so mid-line HPOS/SIZE/GRAFP/GRAFM changes no longer retroactively use the final state. Native writes use the final 6502 instruction cycle, JS snapshots preserve the event log, and overflow intentionally falls back to the prior renderer behavior. PRIOR/PMBASE raster fixtures and collision-focused validation remain pending.
- 2026-09-25: `A8E/tests/antic_graphics_modes_probe.c` and `jsA8E/tests/gtia_pmg_dma_regression.test.js`: added native and JS AHRM-07 regressions for hidden-prefix HPOS replay and live PMBASE changes between player DMA slots, preserving the documented mixed-base line behavior. PRIOR fixtures and collision-latch validation remain pending.
- 2026-09-25: `A8E/tests/antic_graphics_modes_probe.c` and `jsA8E/tests/gtia_pmg_dma_regression.test.js`: added native and JS regressions for mid-line PRIOR changes and player collision latches. Earlier pixels remain unchanged after a PRIOR write, later spans use the new priority, and overlapping players set both AHRM collision bits. AHRM-07 synthetic probe coverage is complete; real-content validation remains pending.
- 2026-09-25: `A8E/Pokey.c`, `jsA8E/js/core/pokey.js`, and the new timer-period probes: began AHRM-08 by treating `AUDF=0` as the valid minimum timer divisor in native and JS, including linked fast-clock periods. Previously those values were incorrectly treated as disabled, which could suppress timer IRQ and serial timing at the fastest settings.
- 2026-09-25: `A8E/Pokey.c`, `jsA8E/js/core/{pokey,io}.js`, and the paddle probes: added the AHRM 5.9 deterministic live-counter read behavior. Active `POT0-7` reads now return the adjacent-counter AND on the increment cycle without corrupting the latched register value; the native and JS fast-scan sequence tests cover the documented values and terminal hold.
- 2026-09-25: `jsA8E/js/core/io.js` and `jsA8E/tests/pokey_sio_disk_observer.test.js`: removed the browser-only clearing of `IRQST` bit 5 when reading `SERIN`. AHRM 5.6 makes SERIN reads side-effect free; the input-ready status is now consistent with native A8E and the documented IRQ acknowledge path.
- 2026-09-25: `implementation/traces/pokey_timer_contract.jsonl`,
  `A8E/tests/pokey_timer_period_probe.c`, and
  `jsA8E/tests/pokey_timer_period.test.js`: promoted the AHRM-08 AUDF=0,
  fast-clock, and linked-timer checks to one shared native/JS JSONL contract.
  The fixture intentionally covers timer periods only; cycle-perfect STIMER
  reload sequencing remains a separate pending item.
- 2026-09-25: `A8E/CMakeLists.txt`: native CTest probes now run from the
  repository root, where `ATARIBAS.ROM` and `ATARIXL.ROM` are provided. This
  fixes the test-runner path failure without changing emulator behavior. SDL
  audio/video dummy drivers are also set for those probes so CTest does not
  depend on a host audio device or display server.
- 2026-09-25: `implementation/alignment_23Sept26.md`: documented the AHRM-08
  completion boundary. Exact STIMER/SIO phase alignment needs a cycle trace,
  while audio calibration needs a fixed PAL/NTSC reference capture; neither is
  inferred from host playback or changed through a register-level workaround.
- 2026-09-25: `implementation/AHRM08_POKEY_TEST.{asm,XEX,md}` and
  `jsA8E/tests/ahrm08_pokey_xex.test.js`: added a portable guest-level POKEY
  diagnostic. It records timer IRQ polling counts for normal, fast, AUDF=5,
  and linked timers, SEROUT event counts, and POT/ALLPOT results for comparison
  across jsA8E, native A8E, Altirra, and hardware. It deliberately reports
  observations instead of manufacturing PASS/FAIL values.
- 2026-09-25: `implementation/AHRM08_POKEY_TEST.asm`: corrected the diagnostic
  result renderer to use Atari screen-code hexadecimal digits. The first
  generated artifact displayed raw ASCII bytes as glyphs, so its numeric
  results were not interpretable even though the tests themselves ran.
- 2026-09-25: `implementation/AHRM08_POKEY_TEST.asm`: reset POKEY into and out
  of initialization mode before every measured scenario, clearing IRQEN first.
  This prevents indeterminate power-up timer/serial state from producing
  immediate `00` results or contaminating cross-target comparisons.
- 2026-09-25: `implementation/AHRM08_POKEY_TEST.asm`: hardened the external
  diagnostic's baseline by clearing pending IRQ sources through an
  enable-then-disable sequence, enabling timer IRQs after STIMER, and selecting
  AHRM's `SKCTL=$23` serial output clock before the SEROUT cases.
- 2026-09-25: `implementation/AHRM08_POKEY_TEST.asm`: made timer polling clear
  IRQEN once more after STIMER and configured the serial case with the AHRM
  linked timer 3+4 19.2 kbaud setup (`AUDCTL=$28`, divisor `$0028`,
  `SKCTL=$23`).
- 2026-09-25: `implementation/AHRM08_POKEY_TEST.md` and
  `implementation/alignment_23Sept26.md`: recorded the first external
  AHRM-08 comparison. Altirra/hardware agree on POT completion and closely
  agree on SEROUT timing, while jsA8e diverges in both areas; AUDF=5 matches,
  and AUDF=0 remains inconclusive at the current guest polling boundary.
- 2026-09-25: `A8E/Pokey.c` and `jsA8E/js/core/pokey_sio.js`: standard SIO
  output deadlines now derive from the configured timer-4 period in AHRM
  serial modes 2/3 instead of always using the virtual 900/1500-cycle delays.
  External-clock or unconfigured modes retain the fixed-delay fallback.
- 2026-09-25: `jsA8E/tests/pokey_pot_io_path.test.js`: added an integration
  regression that drives `SKCTL`, `POTGO`, `ALLPOT`, and `POT0` through the
  actual JS I/O dispatcher. It passes the completed slow-scan contract, so
  the remaining external POT discrepancy is isolated to the full worker/guest
  execution path rather than the POKEY or I/O unit path.
- 2026-09-25: `jsA8E/js/core/atari.js`: extended the existing debugger POKEY
  state with the current POT scan flags, counter, terminal cycle, ALLPOT, and
  POT0 values. This is debugger observability only; it adds no per-cycle trace
  or normal-mode work and is intended to identify where the full guest path
  diverges from the passing POKEY/I/O integration probe.
- 2026-09-25: `jsA8E/js/core/atari.js` and
  `jsA8E/tests/pokey_pot_cpu_dispatch.test.js`: verified the POT scan through
  real 6502 instructions and exposed the three POKEY mapping checks in the
  debugger state. This separates a lost full-machine I/O mapping from a
  register-model failure without adding runtime tracing.
- 2026-09-25: `jsA8E/emulator_worker.js`: extended the opt-in memory-access
  diagnostic filter to include the POKEY register range `$D200-$D20F`. The
  worker can now report the guest's actual `ALLPOT` reads without tracing the
  full address space or adding work while the diagnostic is disabled.
- 2026-09-25: `jsA8E/emulator_worker.js`: included the CPU access mode in the
  opt-in POKEY memory events. This distinguishes an I/O handler dispatch from
  an accidental RAM/ROM fast path while investigating the full guest POT scan.
- 2026-09-25: `jsA8E/js/core/{pokey,atari}.js`: exposed the effective POT
  scan step in debugger state. This is a single state query, not a per-cycle
  trace, and distinguishes a disabled scan clock from a failed counter update.
- 2026-09-25: `jsA8E/js/core/atari.js`: passed `CYCLES_PER_LINE` into the
  full POKEY API configuration. Without it, the standalone POT probes used
  the correct 114-cycle slow-scan step while the worker's full-machine path
  used an undefined step and left `POT0/ALLPOT` frozen after `POTGO`.
- 2026-09-25: Chrome validation with `AHRM08_POKEY_TEST.XEX` confirmed the
  full-worker fix: `potStepCycles=114`, `potCounter=228`, `ALLPOT=00`, and
  `POT0=228` (`$E4`). The jsA8e guest-visible POT result now matches Altirra
  and hardware.
- 2026-09-25: `A8E/Pokey.c`, `jsA8E/js/core/{pokey,pokey_sio,io}.js`, and
  `jsA8E/tests/{pokey_timer_period,pokey_sio_disk_observer}.test.js`: aligned
  AHRM 5.6 serial-output clock selection across cores. Modes 010/100 use timer
  4, modes 110/111 use timer 2, and external-clock/asynchronous-input modes
  000/001/011/101 do not receive synthetic output deadlines. `XMTDONE` now
  remains inactive while no output clock exists, including the idle state after
  `IRQEN` writes. Added regressions for timer routing, unclocked output, and
  the resulting status bit.
- 2026-09-25: `A8E/Pokey.c` and `jsA8E/js/core/{io,atari}.js`: aligned the
  observable `STIMER` contract with AHRM 5.3/5.7. Timer reload no longer
  preserves stale timer IRQST flags from an earlier setup; the three timer
  status bits are idle immediately after the strobe while the serial complete
  bit retains its independent idle-shifter state. This removes the common
  `IRQST=F0` result from the Stage 2 diagnostic and leaves the remaining timer
  phase/IRQ latency measurable rather than contaminated by old flags.
- 2026-09-25: `implementation/AHRM08_POKEY_STAGE2_TEST.{asm,XEX,md}` and
  `jsA8E/tests/ahrm08_pokey_stage2_xex.test.js`: added a portable guest-level
  diagnostic for all eight SKCTL serial clock modes, immediate post-STIMER
  IRQST state, and the first timer IRQ polling result. It records observations
  without converting external-clock timeouts into application-specific PASS or
  FAIL values.
- 2026-09-25: `A8E/{Pokey,AtariIo}.c` and
  `jsA8E/js/core/{pokey_sio,io,antic}.js`: modeled the AHRM serial output
  holding-register delay. `SEROUT` no longer makes `DATA NEEDED` appear at the
  write itself; the queued byte is loaded on the next output-clock edge,
  `XMTDONE` is inactive during the ten-bit frame, and completion is scheduled
  after that frame. Updated the direct SIO regression and rebuilt the native
  test suite.
- 2026-09-25: the Stage 2 diagnostic was changed to disable ANTIC playfield
  DMA during POKEY/SIO measurements and restore `DMACTL=$22` before rendering
  the final results. The earlier DMA-enabled captures still validate the
  expected mode grouping and `STIMER=F7`, but their N/D counts combine serial
  timing with ANTIC CPU contention and are not sufficient for exact timing
  certification.
- 2026-09-25: the DMA-isolated Stage 2 executable was run on jsA8E, native
  A8E, Altirra, and hardware. All targets reported `IRQST=F7` after `STIMER`,
  timer-1 polling `03`, `FF/00` for external/asynchronous-input modes, and
  completion groups near `D:32/33` for timer 4 and `D:4E/4F` for timer 2.
  The remaining N-field variation is a polling-boundary observation. The
  Stage 2 guest-level digital test is therefore certified; DAC/audio
  calibration remains a separate AHRM-08 completion item.
- 2026-09-25: `implementation/AHRM07_PMG_TEST.{asm,XEX,md}` and `jsA8E/tests/ahrm07_pmg_xex.test.js`: added a standalone AHRM-07 executable. It exercises visible PMG DMA, PMBASE changes, DLI-driven HPOS/PRIOR changes, and real P0/P1 collision latches; each raster phase is held for 32 frames to make visual transitions deterministic, and the screen now explains the bars, phase timing, and real collision result. The assembler regression verifies that the checked-in XEX is reproducible from its source.
- 2026-09-25: `jsA8E/tests/snapshot_save_timing.test.js`: updated the POKEY
  test double with the current `potStepCycles` API so snapshot timing coverage
  remains independent of the full POKEY implementation.
- 2026-09-25: `implementation/AHRM08_POKEY_PHASE_TEST.asm`: corrected the
  Stage 3 fixture to enable serial IRQ sources before `STIMER`. AHRM 5.7's
  enable lead-time rule means enabling immediately before `SEROUT` would mix
  IRQ latch latency into the intended STIMER/SEROUT phase measurement.
- 2026-09-25: `implementation/AHRM08_POKEY_PHASE_TEST.{asm,XEX,md}` and
  `jsA8E/tests/ahrm08_pokey_phase_xex.test.js`: added the AHRM-08 Stage 3
  guest diagnostic. It sweeps four deterministic delays between `STIMER` and
  `SEROUT`, records `DATA NEEDED` polling counts plus a `TX COMPLETE` observation,
  and keeps ANTIC DMA disabled during measurement. This isolates serial phase
  evidence from the broader Stage 2 clock-routing test without changing normal
  emulation behavior.
- 2026-09-25: `implementation/AHRM08_POKEY_PHASE_TEST.{asm,XEX,md}`: corrected
  the Stage 3 completion measurement to wait for `DATA NEEDED` before polling
  `XMTDONE`. AHRM 5.6 states that the holding register must first load the
  shift register; checking completion immediately after `SEROUT` measures the
  idle-shifter state instead of the ten-bit transmission interval.
- 2026-09-25: `A8E/{AtariIo.h,AtariIo.c,Pokey.c}` and
  `jsA8E/js/core/{state,memory,io,pokey,pokey_sio,antic,atari}.js`: aligned
  serial output phase with AHRM 5.6. The divide-by-two output-clock level is
  reset by SKCTL external-clock mode, toggled on each selected timer expiry,
  and used to schedule `DATA NEEDED` on the next rising edge instead of one
  synthetic period after SEROUT. Added snapshot persistence and a direct phase
  regression; the native build and full JS automation suite pass.
- 2026-09-25: `A8E/Pokey.c` and `jsA8E/js/core/pokey.js`: preserved the global
  28/114-cycle slow-clock phase across `STIMER` reloads, following AHRM 5.3.
  The first timer underflow now aligns to the next absolute slow-clock tick;
  linked and 1.79 MHz timers retain their existing explicit reload path. Native
  probes and the full JS automation suite still pass.
- 2026-09-26: `A8E/{AtariIo.h,AtariIo.c,Pokey.c}` and
  `jsA8E/js/core/{state,io,memory,pokey}.js`: made the shared 28/114-cycle
  clock phase originate when POKEY exits initialization mode, rather than
  assuming cycle zero or resetting it on every `SKCTL=$00` write. This follows
  AHRM 5.3, which says `STIMER` preserves the slow-clock phase while the end of
  initialization establishes its offset. The phase is persisted in JS
  snapshots, while the serial divide-by-two reset remains controlled by
  `SKCTL[6:4]=000` per AHRM 5.6.
- 2026-09-26: after the `AHRM-08 Stage 3` safety commit, added an opt-in
  serial-phase trace to both implementations. Launch jsA8E with
  `?a8e_pokey_trace=1` to log `SEROUT_SCHEDULE`, selected timer clock edges,
  `DATA_NEEDED`, and `TRANSMISSION_DONE` in the browser worker console. Native
  A8E emits the same event names when built with `-DVERBOSE_SIO`. Each record
  includes the guest pad index at `$89`, `AUDCTL`, `AUDF4`, `SKCTL`, cycle,
  selected timer and period, timer deadlines, divide-by-two level, serial
  deadlines, and `IRQST` where available. The trace is observational only and is disabled by default; its
  purpose is to decide whether the remaining P1 mismatch is a real internal
  edge difference or merely a guest polling boundary before changing timing.

## 2026-10-22 SIO disk burst scheduling

- 2026-10-23: Added a 640-cycle virtual disk-controller turn-around before
  POKEY's existing 1530-cycle first-input-byte visibility delay in both cores.
  AHRM 9.1 permits this response interval, and it models controller work as a
  device delay rather than altering POKEY. It breaks the artificial fixed
  phase relationship between virtual-disk responses and the XL/XE OS VBI,
  which was still provoking occasional AHRM 5.10 command-checksum retries
  after the data-frame race was fixed. `pokey_sio_burst.test.js` now asserts
  that the device turn-around and serial visibility delays are combined. Full
  analysis, observed traces, normal DOS close activity, validation, and the
  regression diagnostic procedure are recorded in
  `implementation/SIO_write_timing_investigation.md`.

- 2026-10-23: Fixed the JS and native SEROUT write timestamp.  The CPU core
  evaluates a store before advancing its instruction counter, but the 6502
  presents that store on its final bus cycle.  POKEY now schedules the first
  SEROUT-to-shifter load from that final cycle and only from a subsequent
  rising serial-clock edge, as required by AHRM 5.6.  This prevents a
  phase-dependent `DATA NEEDED` IRQ from pre-empting the XL OS between
  `STA $D20D` and its checksum update, which had created invalid SIO data
  checksums, NAKs, and the DOS retry pause.  POKEY exposes the selected load
  two cycles after its serial clock edge, and the JS CPU now dispatches I/O
  deadlines only at a completed instruction boundary; an I/O deadline can
  latch during an instruction but cannot vector the CPU halfway through it.
  The CPU and SIO regressions cover both contracts.

- Added `jsA8E/tests/pokey_sio_burst.test.js` and registered it in the
  automation suite. It verifies final-bus-cycle `SEROUT` scheduling,
  POKEY-clocked sector delivery, checksum closure, and response turn-around.
  The focused SIO regressions pass; the native build remains to be checked in
  the Windows build tree.

- 2026-10-23: Removed the investigation-only SIO event buffer expansion,
  per-byte trace records, `DBG_*` markers, and unused data-phase deadline
  state after the timing contract was covered by regressions. The supported
  AHRM POKEY phase trace remains available independently through its existing
  opt-in mechanism.

## Legal / License TODO

Pending legal and licensing review recorded on 2026-09-30. These items are
not resolved by the current GPL notice and must be checked before publishing
the repository or desktop installers.

- **P1 — AHRM redistribution scope:** `AHRM/` is described as a local Markdown
  mirror of the Altirra Hardware Reference Manual, but its front matter and
  index record substantial PDF-extraction repairs, reconstructions, and edits.
  The original AHRM permission is stated as verbatim, free-of-charge,
  non-commercial redistribution. Obtain written permission for the modified
  mirror, replace it with a link to the upstream manual, or replace it with
  independently authored factual notes. Keep AHRM material outside the
  repository-wide GPL claim.

- **P1 — Atari ROM packaging:** `ATARIXL.ROM` and `ATARIBAS.ROM` are ignored
  by Git and intentionally absent from public CI, but local copies currently
  exist in the workspace. Tauri uses `../jsA8E` as `frontendDist`, and the
  packaging helper does not explicitly exclude ROM files. Build from a clean
  staging directory or add an explicit ROM exclusion, then inspect every DEB,
  RPM, AppImage, and web artifact before publication. Never publish ROM dumps
  without documented distribution rights.

- **P1 — Copyright ownership and GPL identifier:** the README attributes the
  original source and project documentation to Sascha Springer for 2004–2026,
  while later source, JavaScript, documentation, and packaging contributions
  come from additional authors. The source files generally retain only the
  2004 Sascha Springer header and do not carry a GPL/SPDX notice or a changed
  date. Confirm copyright ownership or assignments, credit contributors, add
  file-level notices where appropriate, and choose one unambiguous identifier:
  `GPL-2.0-only` or `GPL-2.0-or-later`.

- **P2 — CRT shader provenance:** the UI credits Timothy Lottes, but the
  optimized/inlined GLSL files do not retain an origin, license, or modification
  notice. Verify the exact source and preserve the upstream public-domain
  attribution/permission text together with a note describing the port and
  optimizations.

- **P2 — Third-party frontend inventory:** `jsA8E/index.html` loads Font
  Awesome 6.5.1 and `fflate` 0.8.2 from jsDelivr; `style.css` loads Google
  Fonts. Add a `THIRD_PARTY_NOTICES` document covering runtime and build-time
  dependencies, including Font Awesome's component-specific MIT/OFL/CC-BY
  terms and fflate's MIT notice. For offline Tauri releases, vendor or
  otherwise pin the assets and retain the required notices.

- **P2 — Logo, icon, and Atari trademark provenance:** `jsA8E/a8e.webp` and
  `src-tauri/icons/icon.png` depict an Atari 800 XL and use Atari branding, but
  their source, author, and license are undocumented. Record the asset
  provenance and permission, verify trademark and image rights, and add a
  clear non-affiliation statement before commercial or public distribution.

- **P3 — Package metadata and binary notices:** `jsA8E/package.json` and
  `src-tauri/Cargo.toml` do not declare project license metadata, and release
  artifacts have no visible third-party dependency notice. Add consistent
  metadata and generate a reproducible notices bundle for Cargo/Tauri and
  frontend dependencies, including the corresponding source/license access
  required for GPL binaries.

- **P1 — Local ROM persistence is not a license grant:** the browser now keeps
  user-selected ROM bytes in origin-scoped IndexedDB and does not add them to
  the repository or upload them to the project server. This lowers the risk of
  accidental redistribution, but it does not authorize the user to possess or
  share a ROM dump. Add a concise user-facing notice and confirm that the
  distribution and support terms are appropriate for the jurisdictions served.
