# Compiler and Debugger Review

Review status: 2026-10-17.

The browser assembler and source debugger are functional for the current
single-source 6502/XEX workflow. The existing automated test suite passes, but
the following findings should remain visible for future work.

## Overall assessment

The tool is suitable for developing small Atari 8-bit programs, demos, and
utilities in a single source file. It is not yet a complete assembler IDE or a
multi-module assembler/linker toolchain.

Current capability levels:

- The official NMOS 6502 instruction set and the main addressing modes are
  implemented in the CPU and assembler tables.
- The assembler supports XEX generation, labels, expressions, macros,
  includes, repetition, conditional preprocessing, source mapping, and the
  common data/origin directives.
- The debugger supports source/PC breakpoints, single-step, step-over,
  continue/pause, bounded `runUntilPc`, CPU state, memory access, trace
  inspection, disassembly, symbols, snapshots, and failure artifacts.
- The UI remains intentionally small: memory, stack, call-stack, watch,
  conditional-breakpoint, and integrated disassembly/trace views are not yet
  provided as first-class debugger panels.

For the exact runtime API surface, see the `debug.*` section in
[`jsA8E/README.md`](../../jsA8E/README.md).

## 6502 instruction coverage

The shared opcode table contains 256 opcode entries:

- 151 official NMOS 6502 opcodes.
- 92 undocumented or non-standard opcode encodings implemented by the CPU.
- 13 unsupported encodings: `$02`, `$12`, `$22`, `$32`, `$42`, `$52`, `$62`,
  `$72`, `$92`, `$B2`, `$D2`, `$EB`, and `$F2`.

The unsupported entries are primarily JAM/KIL-style instructions, plus the
undocumented `$EB` SBC-immediate alias. In the normal Atari runtime, the
debugger's illegal-opcode hook reports these as deterministic faults instead
of silently treating them as valid instructions.

The CPU also implements decimal ADC/SBC, interrupt entry and return, branch
page-crossing timing, the NMOS `JMP ($xxxx)` page-wrap behavior, and a broad
set of undocumented operations such as `LAX`, `SLO`, `DCP`, `ISC`, `RRA`,
`RLA`, `SRE`, `LAS`, `SHA`, `SHX`, `SHY`, and `TAS`. Unstable undocumented
semantics should not be treated as portable 6502 programming contracts.

The assembler exposes 71 mnemonic names from the shared opcode map, but does
not expose every undocumented CPU operation as a mnemonic. `LAS`, `SHA`,
`SHX`, `SHY`, and `TAS` currently require explicit `.BYTE` encoding. Some
unstable variants also use alternate names (`ATX`/`LXA` and `XAA`/`ANE`).
The official 151-opcode set is the supported programming target; exact
selection of duplicate undocumented encodings may require `.BYTE`.

The table is defined in
[`jsA8E/js/core/cpu_tables.js`](../../jsA8E/js/core/cpu_tables.js), the assembler
mapping is built in
[`jsA8E/js/core/assembler/shared.js`](../../jsA8E/js/core/assembler/shared.js), and
execution is dispatched by
[`jsA8E/js/core/cpu.js`](../../jsA8E/js/core/cpu.js).

The current tests cover representative official, interrupt, decimal, and
undocumented-opcode behavior, but they are not yet an exhaustive matrix of
all 151 official opcodes across every addressing mode, flag combination, and
cycle edge case.

## Assembler completeness

Implemented source features include:

- `.ORG`, `.RUN`, `.DS`, `.RES`, `.BYTE`/`.DB`, `.WORD`/`.DW`/`.ADDR`.
- `.TEXT`, `.LOBYTES`, `.HIBYTES`, `.ASSERT`, `.ERROR`, and `.END`.
- `.EQU`, `.SET`, labels, local labels, expressions, and branch validation.
- `.include`, `.define`, `.undef`, `.macro`, `.rept`, `.local`, and
  conditional assembly.
- HostFS source editing and XEX output.

The following are deliberately incomplete or limited:

- `.SEGMENT`, `.IMPORT`, and `.GLOBAL` are metadata in the current XEX path;
  there is no relocation pass or linker for combining object modules.
- `.SET` cannot redefine an existing symbol with traditional mutable-SET
  semantics.
- Macro, `.rept`, and `.include` expansion can weaken original source-line to
  CPU-address mapping.
- Worker-mode Run can race disk loading, and the UI's fire-and-forget stepping
  methods can report before Worker execution is acknowledged.

## Findings

### Run synchronization in worker mode

The assembler panel's Run action calls `loadDiskToDeviceSlot()` and then calls
`reset()` and `start()` immediately. In the worker/Tauri backend, the disk load
is sent as a fire-and-forget command, so startup can race the media load. The
HostFS row-level XEX Run action already uses the detailed awaitable loader and
should be used as the model for correcting the assembler Run path.

References:

- `jsA8E/js/app/assembler_ui.js`: `assembleRunExecutable()`
- `jsA8E/js/core/app_proxy.js`: `loadDiskToDeviceSlot()` and
  `loadDiskToDeviceSlotDetailed()`

### Source mapping after preprocessing

Assembler line and address maps are generated after preprocessing. Macro,
`.rept`, and `.include` expansion currently reuses or changes source line
numbers, so a breakpoint in the original editor can point to the wrong line or
be unavailable after expansion.

Future improvement: preserve source file and original line metadata through
preprocessor output and use it when generating `lineAddressMap` and
`addressLineMap`.

### Worker debugger acknowledgements

The worker proxy exposes both fire-and-forget and awaitable step methods. The
assembler UI currently calls the fire-and-forget `stepInstruction()` and
`stepOver()` methods, which return before the worker confirms the operation.
The UI can therefore report success before the instruction has executed.

Future improvement: use `stepInstructionAsync()` and `stepOverAsync()` in the
UI and update status only after the returned result is available.

### `stepOverAsync()` state validation

`stepInstructionAsync()` validates readiness and paused state, but
`stepOverAsync()` reads the current CPU opcode before performing equivalent
checks. Automation calls made before initialization or while running should be
normalized to a structured failure instead of relying on the caller's timing.

### Object format and linking

`.SEGMENT`, `.IMPORT`, and `.GLOBAL` are accepted and recorded as object
metadata, but XEX generation treats them as no-ops. `A8OBJ` currently provides
serialization and parsing only; there is no linker or relocation pass for
combining object modules.

This is intentionally out of scope for the current XEX editor workflow.

### `.SET` semantics

`.SET` is recognized by the parser but uses the same duplicate-symbol rule as
immutable constants. It cannot redefine an existing symbol. If traditional
assembler-compatible mutable `SET` behavior is required, it needs a separate
symbol-update path and dedicated tests.

### Automation symbol lookup

Assembler symbols are normalized to uppercase, while the automation `sym()`
helper currently performs a case-sensitive lookup. Calls such as `sym("START")`
work reliably; lowercase or mixed-case calls may return `null`.

## Implemented scope

The current implementation includes:

- 6502 XEX assembly with official and supported undocumented opcodes.
- Main 6502 addressing modes, labels, local labels, expressions, and branch
  range validation.
- `.ORG`, `.RUN`, `.DS`, `.RES`, `.BYTE`, `.WORD`, `.TEXT`, `.LOBYTES`,
  `.HIBYTES`, `.ASSERT`, `.ERROR`, and `.END`.
- `.include`, `.define`, `.undef`, `.macro`, `.rept`, conditional assembly,
  and `.local` preprocessing.
- HostFS source editing, assembly output, breakpoints, single-step, step-over,
  continue/pause, CPU state, trace inspection, and `runUntilPc` automation.
- Illegal-opcode and execution-error reporting plus debugger snapshot state.

The list above describes implemented behavior, not a promise that the tool is
a full relocatable assembler/linker or a full-featured IDE debugger.
