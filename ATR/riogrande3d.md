# Rio Grande 3D: XEX Rejection Diagnosis

Study date: 2026-10-07

## Executive summary

`Rio Grande 3D.xex` is not malformed, and the rejection does not represent a
real incompatibility between the program and the XL/XE memory map. The failure
is in the `jsA8E` XEX preflight: its static `INITAD` analysis identifies a
constant that loads the `NMIEN` register as if it were the value written to
`PORTB` (`$D301`). It therefore predicts `PORTB=$00` before the large segment
and marks it as overlapping Self-test ROM and BASIC ROM.

The program instead executes an effective sequence equivalent to:

```asm
LDA $D301
AND #$FE
STA $D301
```

Starting from the normal `PORTB` value `$FF`, the result is `$FE`: OS ROM,
BASIC ROM, and Self-test ROM are removed from the memory bus, so `$5000-$57FF`
and `$A000-$BFFF` are RAM while segment `$3500-$BFE9` is loaded.

Successful execution in Altirra is consistent with this hardware behavior. It
is also consistent with A8E's native loader, which does not apply the dynamic
ROM preflight: it converts the XEX and lets the loader execute `INITAD` between
segments.

## Implementation completed

The generic fix was applied in `jsA8E/js/core/memory.js`:

- Self-test is considered mapped only when PB7 is clear and OS is enabled by
  PB0, as required by the AHRM.
- `INITAD` analysis no longer searches for a nearby `LDA #imm` before
  `STA $D301`. It now conservatively tracks the accumulator, including
  `PORTB` reads and immediate `AND`/`ORA`/`EOR` operations; it abandons the
  analysis when it encounters control flow or unsupported instructions.
- No filename-specific exception was introduced, and protection for the
  loader range `$0700-$087F` was not relaxed.

The native PIA model in `A8E/Pia.c` now applies the same AHRM rule to both its
initial state and subsequent `PORTB` transitions. Native Self-test therefore
requires PB7 clear and PB0 set. The native `memory_expansion_probe` covers the
transition from Self-test enabled with OS active to Self-test disabled when OS
is turned off.

The specific regression is in
`jsA8E/tests/memory_xex_preflight_bank_switch.test.js`. Preflighting the
original XEX now ends with `xex_preflight_passed`, with no overlaps, an initial
`PORTB=$FF`, and the Self-test/BASIC regions outside the active map after
`INITAD` analysis. The `npm.cmd run test:automation` suite also completes
without failures, and the native CTest suite passes all 12 tests.

The boot test through `RUNAD` was not used as an acceptance criterion in this
run because the headless runtime did not return within the timeout. This does
not affect the rejection diagnosis, which occurs exclusively during preflight
and is covered by the validation above.

## Evidence obtained from Chrome/CDP

The issue was reproduced in a Chrome instance controlled through the DevTools
Protocol, with `jsA8E` served from `http://127.0.0.1:8080/jsA8E/`.

Runtime state during capture:

- OS and BASIC ROMs loaded.
- Worker backend active, WebGL2 renderer.
- Memory profile: `130xe-128k`.
- The machine was running with an effective `PORTB` of `$FD` when the state
  was captured, but preflight received the normal initial value `$FF`.

The automation `runXex` call returned a structured artifact containing:

- file: `Rio Grande 3D.xex`;
- size: `47976` bytes;
- normalized size: `47992` bytes;
- nine segments;
- `INITAD=$0609`;
- `RUNAD=$5F70`;
- affected segment: `$3500-$BFE9`;
- reported overlap with Self-test ROM: `$5000-$57FF`;
- reported overlap with BASIC ROM: `$A000-$BFE9`;
- code: `xex_protected_memory_overlap`;
- phase: `xex_preflight_failed`.

The same XEX was written to HostFS and launched through `dev.runXex({
hostFile: ... })`; it produced the same artifact and diagnosis. The Library
and direct loader converge on `loadDiskToDeviceSlotDetailed`, so both routes
share the same preflight. The Library interface may normalize the final error
to `Failed to mount disk image`, but the internal cause is the same.

## Relevant XEX structure

Analysis of the bytes in
`C:\\Users\\lrivas\\Downloads\\Rio Grande 3D.xex` produced these segments:

| Index | Range | Length |
|---:|---:|---:|
| 0 | `$0600-$063C` | 61 |
| 1 | `$02E2-$02E3` | 2 |
| 2 | `$4000-$67F8` | 10137 |
| 3 | `$02E2-$02E3` | 2 |
| 4 | `$1500-$17F9` | 762 |
| 5 | `$2800-$29A8` | 425 |
| 6 | `$3100-$34D8` | 985 |
| 7 | `$3500-$BFE9` | 35562 |
| 8 | `$02E0-$02E1` | 2 |

The vectors written by the XEX are:

- primer `INITAD`: `$0600`;
- segundo `INITAD`: `$0609`;
- `RUNAD`: `$5F70`.

The initialization code contains several operations involving `$D301`. The
significant sequence reads the current `PORTB`, clears bit 0, and writes it
back. It is incorrect to use the nearby `#$00` immediate as the `PORTB` value:
that immediate is used to write `NMIEN` at `$D40E`, not to form the `PORTB`
value.

## Exact cause in the code

The relevant path is in `jsA8E/js/core/memory.js`:

- `tracePortBFromInitCode()` searched for `STA $D301` and scanned backward up
  to 16 bytes for any `LDA #imm`.
- It did not require that `LDA #imm` be the immediate source of `STA`.
- It did not model the sequence `LDA $D301`, `AND #$FE`, `STA $D301`.
- In this XEX it found `LDA #$00` associated with disabling `NMIEN` and returned
  `$00` as the presumed new `PORTB` value.

`collectBlockedXexWrites()` then used this false value while examining segment
7. With `PORTB=$00`, preflight believed BASIC and Self-test were active and
stopped the conversion before creating the temporary ATR.

There was also a separate AHRM discrepancy: the Self-test condition in
`getBlockedXexWriteRegion()` checked only whether bit 7 of `PORTB` was clear.
The AHRM states that Self-test ROM is active with bit 7 clear **only when OS
ROM is also active**; if OS is disabled, Self-test is disabled regardless of
bit 7.

## Comparison with the AHRM and Altirra

The [AHRM 2.6 Bank switching](../AHRM/2.%20System%20Architecture/6.%20Bank%20switching.md)
section defines:

- bit 0: OS ROM at `$C000-$CFFF` and `$D800-$FFFF`;
- bit 1: BASIC ROM at `$A000-$BFFF`, active when the bit is clear;
- bit 7: Self-test ROM at `$5000-$57FF`, active when the bit is clear only if
  OS ROM is also active;
- when OS is disabled, Self-test is also disabled;
- writes targeting an active ROM are ignored and do not write the underlying
  RAM.

The game's `INITAD` transforms `$FF` into `$FE` with `AND #$FE`. According to
the AHRM, `$FE` means:

| Region | State with `PORTB=$FE` |
|---|---|
| OS ROM | disabled because bit 0 = 0 |
| BASIC ROM | disabled because bit 1 = 1 |
| Self-test ROM | disabled because bit 7 = 1; OS is also disabled |
| `$5000-$57FF` and `$A000-$BFFF` | visible RAM |

Therefore, segment `$3500-$BFE9` can be loaded without losing bytes once
`INITAD` has executed. The result observed in Altirra confirms this
interpretation, but the main conclusion does not depend on the title running:
it follows from the AHRM memory map and the documented loader flow, which
executes `INITAD` after loading each segment.

## Recommended solution strategy

### 1. Correct the Self-test model

Self-test detection must require both conditions:

```text
(PORTB bit 7 == 0) && (PORTB bit 0 == 1) && selfTestRomLoaded
```

Apply the same rule to:

- initial preflight protected regions;
- byte-by-byte blocked-write checks;
- the memory state exposed by diagnostics;
- native and JS memory models.

This corrects a general AHRM discrepancy, although by itself it does not fix
Rio Grande 3D because the false `PORTB=$00` still leaves BASIC active.

### 2. Replace the `INITAD` heuristic

Do not expand the search window or accept more immediate-value patterns. That
would preserve the problem of confusing data from different instructions with
the value written to the MMU.

The minimum safe solution is a limited data-flow analysis that:

- recognizes `LDA $D301` as reading the current `PORTB`;
- applies `AND`, `ORA`, `EOR`, `LDA #imm`, `TAX/TXA`, and simple stores;
- requires the tracked value to reach `STA $D301`;
- stops tracking when branches, subroutines, or unsupported instructions may
  change the accumulator;
- tracks each `INITAD` in the order in which the loader executes it.

For this case, the analysis must produce `$FE`, not `$00`.

### 3. Higher-fidelity solution: execute `INITAD` in a sandbox

The preferred long-term solution is for preflight to simulate the XEX loader in
a temporary machine or isolated state instance:

1. load the segment into the current map;
2. apply the AHRM rules for ROM visibility and memory windows;
3. execute `INITAD` until it returns;
4. capture the effective `PORTB` and MMU state;
5. validate the next segment against that state.

This avoids inventing a second partial 6502 interpreter and ensures that
preflight and actual execution share the same PIA/MMU rules. The sandbox must
be limited to the loading phase, with instruction limits and no external
effects on audio, UI, HostFS, or persistent devices.

### 4. Keep a hard protection boundary

Any segment occupying the XEX loader's reserved range
(`$0700-$087F`, as defined by the current documented contract) must remain a
fatal error. This protection must not be relaxed to solve the case of
switchable ROMs.

ROM overlaps must not be rejected using only the reset map. They must be
evaluated against the `PORTB` state in effect when each segment is copied,
after the preceding `INITAD` routines.

## Required regressions

Add a fixed XEX test based on `Rio Grande 3D.xex`, or an equivalent binary
fixture, that verifies:

1. `INITAD=$0600` executes before segment `$4000-$67F8`.
2. `INITAD=$0609` executes before segment `$3500-$BFE9`.
3. Analysis obtains `PORTB=$FE` after `AND #$FE`.
4. Self-test is not considered active when OS is disabled.
5. Preflight ends with `xex_preflight_passed`.
6. Library and HostFS mount the XEX through the same route without duplicating
   the rules.
7. A fixture that actually writes to `$5000` or `$A000` while the corresponding
   ROM remains active is still rejected.
8. A segment occupying `$0700-$087F` is always rejected.

After the fix, validate in this order:

- complete `jsA8E` suite;
- headless boot with ROMs and capture of the first `RUNAD`;
- execution from Library;
- execution from HostFS;
- native A8E;
- Altirra as a secondary comparison;
- real hardware, if available.

Do not add a filename-specific exception for `Rio Grande 3D`, disable
preflight globally, or force `PORTB` from the UI. Any of those alternatives
would hide the analysis error and break the AHRM contract for other XEX files
that depend on a ROM remaining visible.

## Conclusion

The error was a false positive in the `jsA8E` preflight, located in static
`PORTB` tracking during `INITAD` and compounded by an incomplete AHRM
Self-test condition. Altirra's behavior is the expected external reference
and does not require a game-specific workaround.

The generic implementation now reproduces the relevant MMU state that the XEX
loader will have between segments without relaxing real protections. Full
isolated `INITAD` execution remains a possible fidelity improvement, but it is
not required to correct this false positive or accept the XEX in an AHRM-
compliant way.
