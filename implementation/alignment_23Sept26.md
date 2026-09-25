# AHRM alignment study and work plan

Date: 2026-09-24

## Purpose

This document records the current AHRM alignment status of the native `A8E`
and browser `jsA8E` implementations and defines the work required to close the
known gaps without introducing title-specific workarounds.

The AHRM is the authority for hardware behavior. A game working in the
emulator is useful validation, but it does not by itself prove that the
implementation is hardware-compliant.

## Confirmed project decisions

- RAMBO 256K is part of the supported memory-expansion work and is added as a
  concrete profile in AHRM-04.
- U1MB is treated as a separate project. This alignment effort will document
  the current boundary and will not block ordinary RAM expansion work on a
  complete U1MB firmware model.
- AHRM is the primary technical authority. Altirra and real hardware are
  secondary validation references when a behavior needs confirmation.
- Initial validation targets Linux native A8E and Chromium/jsA8E. Other hosts
  remain regression targets after the core behavior is stable.
- Test and trace instrumentation must be optional during development and
  removed when it has no lasting emulation, diagnostics, or regression value.
  It must not impose a normal-mode performance cost.

## Current baseline

The following areas are substantially aligned and already have focused tests
or real-content validation:

- 6502 documented and selected undocumented instructions.
- PAL/NTSC machine timing and palette selection.
- ANTIC DLI/VBI timing, VCOUNT, WSYNC, CHBASE, display-list timing, and most
  playfield DMA behavior.
- GTIA playfield priority, collisions, and the main player/missile DMA path.
- 130XE, RAMBO, and COMPY bank geometry, CPU/ANTIC windows, and motherboard
  RAM shadowing.
- XEX `INITAD`/`RUNAD` handling and the relocatable temporary sector buffer.
- SIO ACK/Complete/data phase handling for the implemented virtual disk path.

The baseline is not complete. The most important open issues are native PIA
direction/latch behavior, the unconditional native `CONSOL` workaround, PIA
control-line interrupts, incomplete U1MB firmware behavior, and documented
raster timing approximations.

## Priority model

- **P0**: correctness issue that can make A8E and jsA8E disagree or can affect
  ordinary XL/XE software. Complete before declaring the two cores aligned.
- **P1**: important AHRM hardware area with visible compatibility impact, or a
  required capability for supported expansion profiles.
- **P2**: advanced timing, peripheral, or analog fidelity work. Valuable, but
  should follow the core state-model corrections.
- **P3**: optional coverage, calibration, and broader regression infrastructure.

Difficulty uses `low`, `medium`, or `high` for the expected implementation
effort and validation risk.

## Prioritized work-items

### AHRM-01: Correct native PIA DDRB/ORB semantics

Priority: **P0**

Difficulty: **medium**

Viability: **high**. The JavaScript implementation already contains the
required state split and effective-value calculation, so it can be used as a
behavioral reference. The change is localized to PIA state and mapping tests.

Benefits:

- Makes native XL/XE memory mapping follow the AHRM electrical model instead
  of depending on the last raw register write.
- Keeps A8E and jsA8E consistent when software changes DDRB and ORB at
  runtime, including during bank-switching sequences.
- Improves compatibility with operating systems, memory tests, and software
  that uses partial PORTB direction masks.
- Establishes a reliable foundation for every later RAM expansion and U1MB
  correction.

Problem:

- `A8E/Pia.c` uses one `cValuePortB` field for DDRB access and does not retain
  an independent ORB latch.
- A DDRB write does not immediately recompute the effective PORTB value.
- Memory-window and ROM mapping can therefore use the raw write instead of
  `(ORB & DDRB) | ~DDRB`.
- The native core can diverge from jsA8E when software changes PBCTL mode,
  DDRB, or ORB after startup.

Steps:

1. Add explicit native `cOutputPortB` and `cDirectionPortB` state, matching
   jsA8E `outputPortB` and `valuePortB`.
2. Add one native helper that computes the effective XL/XE PORTB value and
   applies ROM, CPU-window, ANTIC-window, and bank transitions.
3. Preserve ORB when the register address is temporarily selecting DDRB.
4. Reapply the effective value immediately after every DDRB and ORB write.
5. Make PORTB reads distinguish DDRB reads from ORB reads and preserve the
   AHRM input/output behavior.
6. Update reset initialization to represent all PIA bits as inputs while
   retaining the correct XL/XE pull-up behavior.
7. Add a native probe matching `jsA8E/tests/pia_xlxe_defaults.test.js`.
8. Add cross-core cases for partial DDRB output, ORB-before-DDRB, and changing
   DDRB while an expansion window is active.
9. Run all memory-expansion probes and compare native/jsA8E bank and ROM state
   after each write.

Acceptance criteria:

- Native and JS return the same effective PORTB value for the same DDRB/ORB
  sequence.
- ROM visibility and expansion-window state change immediately after DDRB
  writes as required by AHRM 2.5-2.7.
- Existing 130XE/RAMBO/COMPY probes still pass.

Status: **implemented and validated on 2026-09-24**.

- Native A8E now stores independent ORB and DDRB latches, computes
  `(ORB & DDRB) | ~DDRB`, and applies that effective value immediately to
  ROM and expansion mapping.
- Native reset state now starts with all DDRB bits as inputs and effective
  PORTB pull-ups high, matching the jsA8E contract.
- `A8E/tests/memory_expansion_probe.c` covers latch separation, partial
  directions, ORB-before-DDRB writes, read behavior, and effective-value
  recomputation. All existing native memory profiles remain covered by the
  same probe.
- The next validation step is cross-core trace comparison for more complex
  bank-switching sequences; this is not required to close the basic AHRM-01
  contract.

### AHRM-02: Remove the unconditional native CONSOL hack

Priority: **P0**

Difficulty: **low**

Viability: **high**. The normal GTIA register behavior already exists. The
remaining work is to make the startup convenience behavior explicit instead of
silently changing hardware reads based on the program counter.

Problem:

- `A8E/Gtia.c` currently contains a PC-dependent `m_cConsolHack` path for
  a read of `$D01F` at PC `$C49D`.
- `A8E/AtariIo.h` enables this behavior unconditionally at compile time.
- This is not a GTIA/AHRM rule and can affect any software that happens to
  perform the same read at that address.

Steps:

1. Remove the PC-dependent path from the normal GTIA read handler.
2. If the startup convenience is still required, expose it as an explicit
   command-line or runtime option, disabled by default.
3. Make native and jsA8E use the same option semantics.
4. Add a test that reads CONSOL with and without the explicit option and
   confirms that the default path returns only emulated console state.
5. Revalidate BASIC, Self-Test, and the validated title startup paths without
   the default hack.

Benefits:

- Restores normal GTIA CONSOL behavior for all software, not only programs
  that happen to use the hard-coded address.
- Prevents false keyboard, console-key, and self-test results caused by a
  program-counter-specific override.
- Makes compatibility behavior explicit and reproducible when a legacy title
  genuinely needs an opt-in workaround.
- Removes a hidden difference between the native and browser cores.

Acceptance criteria:

- A normal CONSOL read depends only on console input and GTIA state.
- No emulator behavior depends on a hard-coded PC address unless an explicit
  compatibility option is selected.

Status: **implemented and validated on 2026-09-24**.

- Removed the global `CONSOL_HACK` macro and `m_cConsolHack` state.
- Native A8E now stores `Option-on-Start` in the machine's `IoData_t`.
  The new `-o`/ `-O`/ `--option-on-start` option is opt-in; `-b`/ `-B` remains a
  compatibility alias for the normal BASIC-enabled state.
- jsA8E keeps the same explicit `optionOnStart` contract and no longer
  describes it as a C-side hack; its UI toggle is now off by default.
- Native `gtia_consol_probe` and JS
  `consol_startup_option.test.js` cover default reads, the explicit startup
  override, and reads at nearby PC values.

### AHRM-03: Implement PIA control-line state and IRQ behavior

Priority: **P1**

Difficulty: **high**

Viability: **medium-high**. The AHRM behavior is specified, but the current
serial implementation bypasses much of the physical CA1/CA2/CB1/CB2 path.
This work needs a small state machine and explicit line transitions in both
cores.

Problem:

- PACTL/PBCTL currently retain writable bits and synthesized read values, but
  do not model control-line edge detection or interrupt status fully.
- Reads of ORA/ORB do not clear both PIA interrupt status bits.
- CA1/CB1/CA2/CB2 IRQ enable/status behavior is missing or incomplete.
- This affects devices such as the 1030 modem and any software that uses PIA
  interrupts instead of POKEY IRQs.

Steps:

1. Define explicit native and JS state for CA1, CA2, CB1, CB2 levels and
   pending status bits.
2. Decode PACTL/PBCTL edge and output-mode configuration according to AHRM
   2.5.
3. Implement input-line transitions and control-line output transitions as
   events owned by the corresponding peripheral path.
4. Recompute the CPU IRQ level when a PIA status bit is latched, masked, or
   acknowledged.
5. Clear the correct status bits when ORA/ORB is read; keep DDR reads from
   clearing them.
6. Model the documented CB2 SIO command-line transition and CA2 motor-line
   transition without changing SIO response bytes.
7. Add unit tests for positive/negative edge detection, masked pending status,
   read acknowledgement, output-mode clearing, and spurious CB2 interrupts.
8. Add a small peripheral test fixture before attempting modem emulation.

Benefits:

- Allows PIA-driven peripherals and software to use the documented interrupt
  path instead of relying on POKEY-only behavior.
- Improves compatibility with modems, serial accessories, and programs that
  poll or acknowledge PIA status registers directly.
- Makes SIO command and motor-line transitions observable and testable without
  changing the existing response protocol.
- Reduces the risk that an incomplete interrupt model masks or invents device
  activity.

Acceptance criteria:

- PACTL/PBCTL status and IRQ behavior matches the AHRM register examples.
- Existing disk SIO behavior remains unchanged when PIA interrupt sources are
  disabled, as on the normal XL/XE OS path.

Status: **implemented and validated on 2026-09-24**.

- Native A8E and jsA8E now track the four PIA control-line levels and their
  independent edge-latched status bits. Status remains pending while its IRQ
  is masked, and CPU IRQ reconciliation combines PIA and POKEY sources.
- ORA/ORB reads clear both status bits for the corresponding port; DDRA/DDRB
  reads do not. CA2/CB2 output modes clear their status and implement the
  documented read-handshake and pulse behavior.
- CB2 follows the active-low SIO command-line transition around command/data
  frames in both cores without changing the existing response-byte protocol.
- `A8E/tests/pia_control_probe.c` and
  `jsA8E/tests/pia_control_lines.test.js` cover edge polarity, masked status,
  acknowledge behavior, output-mode clearing, and the documented spurious CB2
  interrupt. Dedicated 1030 modem emulation remains outside AHRM-03.

### AHRM-04: Make the supported memory-expansion matrix explicit

Priority: **P1**

Difficulty: **medium**

Viability: **high** for the existing profiles; **medium** for adding new
profiles. The current bank decoder is table-driven and already has native and
JS probes.

Problem:

- The AHRM lists a 256K RAMBO configuration, but the UI, JS profile table, and
  native enum do not expose it.
- The 256K RAMBO profile shares the 320K RAMBO banking bits, but its `$8x`
  banks alias motherboard RAM. It cannot be implemented safely by copying the
  320K profile and changing only the label or capacity.
- The project currently advertises a subset of AHRM configurations without a
  clear distinction between implemented, intentionally omitted, and planned
  profiles.

Benefits:

- Gives users an accurate view of which Atari memory configurations are
  actually supported.
- Prevents silent differences between the native and browser memory
  selectors, bank decoders, and documentation.
- Makes future RAM upgrades safer by turning each profile into a testable,
  explicit contract.
- Avoids spending debugging effort on a profile that is only partially
  implemented or intentionally outside the project scope.

Steps:

1. Add the `rambo-256k` profile to native and JS with banking bits 2, 3, 5,
   and 6, a shared CPU/ANTIC window, and the AHRM main-memory alias for banks
   0-3 (`$8x`).
2. Implement the alias in both window directions so reads and writes through
   the aliased extended banks remain equivalent to motherboard RAM.
3. Add the profile to both memory probes, including tests that distinguish
   aliased banks 0-3 from independent banks 4-15.
4. Update the UI label, native switch, JS normalization entries, and memory
   documentation.
5. If another AHRM profile is not supported, mark it explicitly as omitted in
   the UI and memory documentation rather than implying full AHRM matrix
   coverage.
6. Add a generated profile table shared by native and JS tests to prevent
   future mapping drift.

Acceptance criteria:

- Every AHRM profile in the supported scope has the same bank bits, capacity,
  CPU window, ANTIC window, and ROM-overlay rules in both cores.
- RAMBO 256K reports 16 bank selectors, aliases banks 0-3 to motherboard RAM,
  and keeps banks 4-15 independent.
- Unsupported profiles are clearly marked as unsupported.

### AHRM-05: Define the U1MB support boundary as a separate project

Priority: **P3** for boundary documentation; full implementation is outside
the current alignment scope.

Difficulty: **low** for documenting the boundary; **high** for the separate
full-support project.

Viability: **medium**. The memory-bank and initial UCTL/UAUX/COLDF behavior is
already present, but full U1MB requires ROM/flash mapping and firmware-driven
behavior that is substantially larger than a normal memory expansion.

Current gap:

- UCTL, UAUX, COLDF, and the 1MB extended-memory geometry are modeled.
- U1MB BIOS, selectable OS/BASIC/Game ROMs, flash command state, RTC, PBI,
  cartridge control, and configuration-dependent I/O RAM are not modeled.

Benefits:

- Prevents users from mistaking the current memory-only model for a complete
  U1MB implementation.
- If the full model is implemented, enables software that depends on U1MB
  boot selection, flash, RTC, PBI, and cartridge configuration behavior.
- A clearly named partial mode preserves useful extended-memory testing while
  keeping unsupported firmware behavior honest.
- Provides a controlled path for adding U1MB features without coupling them to
  ordinary 130XE/RAMBO/COMPY behavior.

Steps for the current alignment branch:

1. Keep the current U1MB behavior explicitly marked as partial in the UI and
   documentation.
2. Ensure RAM expansion tests do not claim to certify U1MB firmware, BIOS,
   flash, RTC, PBI, or cartridge behavior.
3. Record the separate U1MB project boundary and preserve the existing
   memory-only compatibility mode.

Steps for the separate full U1MB project:

1. Add a separate flash-memory model with read, program, erase, autoselect,
   write-protect, and reset states.
2. Map the BIOS, OS, BASIC, Game, cartridge, and PBI ROM windows from the AHRM
   flash layout.
3. Implement UCTL config-lock transitions and reset re-entry through the BIOS.
4. Implement UAUX-controlled device decoding, including PBI and RTC register
   paths.
5. Implement the `$D380-$D3FF` ownership and undriven-bus reads for every
   configuration state.
6. Add firmware/software fixtures for cold boot, warm reset, OS selection,
   flash queries, and PBI enable/disable.
7. Keep the simple memory-only U1MB profile available as a deliberately named
   compatibility mode if full firmware emulation is not yet ready.

Acceptance criteria:

- The UI and documentation do not present the partial model as a complete
  U1MB computer.
- RAM expansion tests explicitly exclude U1MB firmware, BIOS, flash, RTC, PBI,
  and cartridge certification.
- The separate full-support project will require software and cold-reset
  behavior to produce the documented COLDF and BIOS results.

### AHRM-06: Close ANTIC timing gaps

Priority: **P2**

Difficulty: **medium** for individual cases; **high** for complete raster
verification.

Viability: **medium-high**. Both cores already use cycle-oriented scanline
logic and have focused probes, but the remaining cases require carefully
controlled instruction/bus timing tests.

Open cases:

- AHRM 4.8 missed-NMI condition when an IRQ is acknowledged at the critical
  cycle.
- Character-data DMA fetches on blank extended rows in modes 2/3.
- Native VSCROL deadline sampling relative to an atomic 6502 instruction.
- Broader chained-DLI and wide-playfield validation.
- The `playfield_dynamic_geometry.test.js` fixture uses a stale renderer mock
  without `drawModeLine`, so its assertions are currently not reached.

Benefits:

- Improves compatibility with raster effects, display-list tricks, and demos
  that depend on exact cycle boundaries.
- Prevents false positives where a title appears to work but has incorrect
  NMI timing, character fetches, or bus contention.
- Gives both cores a shared timing reference for future PAL/NTSC and display
  mode work.

Steps:

1. Update `playfield_dynamic_geometry.test.js` to provide the current renderer
   contract, then verify that its HSCROL and DMA enable/disable assertions are
   actually executed and pass.
2. Add minimal synthetic 6502 fixtures that place the relevant register write,
   IRQ acknowledge, or DMA request at each boundary cycle.
3. Capture `NMIST`, `NMIEN`, CPU PC, beam cycle, DMA schedule, and bus value in
   both cores.
4. Compare each result with the corresponding AHRM timing example and, where
   possible, an Altirra trace.
5. Implement one timing rule at a time in JS and native code.
6. Add regression tests before moving to the next corner case.
7. Run real raster content such as Atomix Plus! and GTIA 9++ examples only
   after the synthetic tests pass.

Acceptance criteria:

- The dynamic-geometry test reaches and passes its assertions with the current
  renderer API.
- JS and native produce the same NMI, DMA-steal, bus-value, and visible-line
  results for every new boundary fixture.
- No title-specific timing branch is introduced.

### AHRM-07: Improve GTIA/PMG raster replay fidelity

Priority: **P2**

Difficulty: **high**

Viability: **medium**. The current shift-register model handles the common PMG
path, but exact mid-line replay requires preserving more register-write and
fetch history than the current first-visible-span reconstruction.

Benefits:

- Corrects player/missile graphics and collision results for raster effects
  that change registers during a scanline.
- Improves compatibility with demos and games that use PMG animation,
  multiplexing, VDELAY, or mid-line priority changes.
- Makes visible pixels depend on the actual event history rather than on the
  final state of the scanline, which is closer to the AHRM hardware model.
- Reduces unexplained differences between native rendering, browser rendering,
  and hardware captures.

Steps:

1. Identify all GTIA/PMG writes that can affect already elapsed pixels or
   collision state on the current line.
2. Record timestamped register writes and DMA latch events per scanline, with
   bounded storage.
3. Replay the hidden portion of the line from the event history instead of
   reconstructing it from final register state.
4. Apply the same event stream to native and JS rendering paths.
5. Add fixtures for mid-line HPOS, SIZE, GRAFP, VDELAY, PMBASE, priority, and
   collision changes.

Acceptance criteria:

- Raster writes before the first visible span no longer depend on the final
  register values of the line.
- PMG pixels and collision registers match the AHRM/Altirra reference cases.

### AHRM-08: Align POKEY serial, timer, paddle, and audio fidelity

Priority: **P2**

Difficulty: **medium** for digital timing; **high** for analog audio fidelity.

Viability: **high** for timers/SIO and **medium** for audio/paddles.

Current gap:

- Timer and SIO behavior is substantially aligned, but the models still need
  broader cross-core differential coverage.
- The audio mixer, DAC curve, DC blocker, clipping, and paddle model are
  approximations rather than a complete analog POKEY model.

Benefits:

- Preserves exact digital timer and SIO behavior while clearly separating it
  from host-dependent audio output.
- Improves compatibility with software that depends on paddle timing,
  ALLPOT reads, timer IRQs, or high-speed serial behavior.
- Produces more consistent music and sound effects across native and browser
  builds by documenting and calibrating the same mixer assumptions.
- Makes remaining audio differences diagnosable instead of conflating DAC,
  buffering, clipping, and emulator-core errors.

Steps:

1. Build shared timer/SIO fixtures for STIMER, AUDCTL-linked timers, IRQEN,
   SERIN/SEROUT, high-speed index, and response-phase timing.
2. Run each fixture in native and JS and compare register/event traces.
3. Add the remaining AHRM paddle behaviors: live-counter read instability,
   capacitor discharge bias, threshold changes, and reasserted ALLPOT bits.
4. Keep the digital mixer path deterministic and document the chosen sample
   rate, DAC approximation, AC coupling, and clipping model.
5. Calibrate native and browser output against the same reference capture or
   reference emulator, without changing hardware register semantics to solve a
   host-audio problem.

Acceptance criteria:

- Digital timer and SIO traces match between A8E and jsA8E.
- Audio differences are characterized as intentional analog approximations,
  not unexplained core divergence.

### AHRM-09: Build a cross-core AHRM differential harness

Priority: **P3**, but useful before completing P1/P2 work.

Difficulty: **medium**

Viability: **high**. The public jsA8E automation and native probes already
provide most of the required inspection points.

Benefits:

- Detects native/browser divergence before it appears as a title-specific
  compatibility bug.
- Turns AHRM requirements into repeatable evidence instead of manual testing
  alone.
- Makes boundary-cycle regressions easier to locate by showing the first
  differing register or event.
- Lowers the cost and risk of future refactors in memory, PIA, ANTIC, GTIA,
  POKEY, and SIO code.

Steps:

1. Define a compact trace schema for CPU cycle, PC, beam position, register
   writes, IRQ/NMI state, PORTB effective value, bank/window state, DMA steals,
   and SIO events.
2. Add deterministic synthetic machine programs for one hardware feature per
   fixture.
3. Export equivalent traces from A8E and jsA8E.
4. Compare traces at register and event boundaries, allowing only explicitly
   documented host-rendering differences.
5. Run the harness in CI for every AHRM-sensitive change.
6. Keep tracing behind a development/test switch and remove probes that do not
   provide lasting emulation or regression value before merging production
   code.

Acceptance criteria:

- A change to one core cannot silently alter the other core's documented
  behavior.
- Every resolved alignment item has a reproducible regression trace.
- Normal emulation has no measurable trace overhead when diagnostics are off.

## Recommended execution order

1. AHRM-01: native DDRB/ORB correction.
2. AHRM-02: remove or gate `CONSOL_HACK` (completed).
3. AHRM-09: add the smallest cross-core trace fixtures needed by the first two
   items.
4. AHRM-03: PIA control-line and IRQ model.
5. AHRM-04: add RAMBO 256K and close the supported memory-profile matrix.
6. AHRM-05: document the U1MB boundary only; track full U1MB separately.
7. AHRM-06: ANTIC timing corner cases.
8. AHRM-07: PMG raster replay.
9. AHRM-08: POKEY paddle and analog audio refinement.

## Definition of aligned

The project can be described as AHRM-aligned for a feature only when:

- The behavior is implemented in both A8E and jsA8E, or the unsupported scope
  is explicitly documented.
- Native and JS use the same register/state semantics.
- A focused regression test covers reset, normal operation, and boundary cases.
- No PC-specific title workaround is required.
- Real-content validation is used as confirmation, not as the only evidence.

## Preflight baseline

Date: 2026-09-24

The preflight was executed on Linux from branch `alignment23Sept26`, with
diagnostic tracing disabled.

### JavaScript baseline

- 33 JavaScript test files were discovered and executed individually.
- 32 passed, including the new `pia_ddrb_orb_contract.test.js` and
  `ahrm_machine_matrix.test.js` fixtures.
- One pre-existing test remains red: `playfield_dynamic_geometry.test.js`.
  Its mock renderer does not provide the newer `rendererApi.drawModeLine`
  method and fails before exercising the geometry assertions. It is tracked
  separately from the AHRM-01 work.
- The two previously stale baseline tests were repaired as test-infrastructure
  fixes: the headless test now finds ROMs in `A8E/build`, and the standby test
  no longer requires text removed from the current standby program.

### Native baseline

- CMake now enables CTest and runs probes from the build directory, where the
  external ROM files are expected.
- Five native probes passed: ANTIC timing, ANTIC DMA, graphics modes, POKEY
  paddle scan, and memory expansion.
- The native build emits existing format warnings in `A8E/Pokey.c` because
  `%u` is used with the repository `u32` typedef. This is recorded but is not
  part of the AHRM-01 change.
- The probes require `SDL_AUDIODRIVER=dummy` in headless Linux environments;
  this changes only the host audio backend, not emulated hardware behavior.

### Executable machine matrix

- `ahrm_machine_matrix.test.js` verifies PAL and NTSC timing constants and the
  `$D014` PAL/NTSC detection value.
- The same fixture verifies the currently supported memory profiles and bank
  counts: 64K, 130XE 128K, RAMBO 192K/320K/576K/1088K, COMPY 320K/576K, and
  the current partial U1MB memory map.
- RAMBO 256K is intentionally not included as a passing profile yet; it is
  the next AHRM-04 implementation target and will be added with explicit
  alias checks for banks 0-3.

### AHRM-01 fixture and performance baseline

- `pia_ddrb_orb_contract.test.js` is the first executable contract fixture.
  It covers pull-ups on input bits, independent DDRB/ORB latches, partial
  direction masks, ORB-before-DDRB writes, and immediate MMU updates.
- The native `memory_expansion_probe` now implements the corresponding
  contract, so AHRM-01 is no longer a known native divergence.
- Five no-trace jsA8E headless runs requested 250,000 cycles and completed at
  841.51-936.51 simulated cycles/ms, with a median of 915.47 cycles/ms. This
  is a machine-specific baseline, not a universal performance promise.
- Native CTest completed all five probes in 2.69 seconds with diagnostics
  disabled. Future trace instrumentation must be compared against this mode
  and must not remain active in normal emulation.

### AHRM-02 validation

- Native CTest now includes `gtia_consol_probe`, for six passing probes in
  total with `SDL_AUDIODRIVER=dummy`.
- The JS automation suite includes
  `consol_startup_option.test.js`; it verifies that the default
  `$D01F` read is `$07`, while the explicit option returns `$03` only
  at the documented OS startup sample.

### Tooling note

`npm run lint` could not run because the environment exposes ESLint 6.4.0,
while the project declares ESLint 9 configuration packages. This is a tooling
environment issue, not an emulation result, and remains outside the AHRM-01
scope.
