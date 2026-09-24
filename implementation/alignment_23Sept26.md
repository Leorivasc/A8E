# AHRM alignment study and work plan

Date: 2026-09-24

## Purpose

This document records the current AHRM alignment status of the native `A8E`
and browser `jsA8E` implementations and defines the work required to close the
known gaps without introducing title-specific workarounds.

The AHRM is the authority for hardware behavior. A game working in the
emulator is useful validation, but it does not by itself prove that the
implementation is hardware-compliant.

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

### AHRM-02: Remove the unconditional native CONSOL hack

Priority: **P0**

Difficulty: **low**

Viability: **high**. The normal GTIA register behavior already exists. The
remaining work is to make the startup convenience behavior explicit instead of
silently changing hardware reads based on the program counter.

Problem:

- `A8E/Gtia.c` returns `m_cConsolHack` for a read of `$D01F` at PC `$C49D`.
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

Acceptance criteria:

- A normal CONSOL read depends only on console input and GTIA state.
- No emulator behavior depends on a hard-coded PC address unless an explicit
  compatibility option is selected.

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

Acceptance criteria:

- PACTL/PBCTL status and IRQ behavior matches the AHRM register examples.
- Existing disk SIO behavior remains unchanged when PIA interrupt sources are
  disabled, as on the normal XL/XE OS path.

### AHRM-04: Make the supported memory-expansion matrix explicit

Priority: **P1**

Difficulty: **medium**

Viability: **high** for the existing profiles; **medium** for adding new
profiles. The current bank decoder is table-driven and already has native and
JS probes.

Problem:

- The AHRM lists a 256K RAMBO configuration, but the UI, JS profile table, and
  native enum do not expose it.
- The project currently advertises a subset of AHRM configurations without a
  clear distinction between implemented, intentionally omitted, and planned
  profiles.

Steps:

1. Decide whether 256K RAMBO is a supported target for this project.
2. If supported, add its storage, bank-bit mapping, main-memory alias rules,
   UI label, native switch, and JS normalization entry.
3. Add the profile to both memory probes, including alias behavior for banks
   that map to motherboard RAM where required by AHRM.
4. If not supported, mark it explicitly as omitted in the UI and memory
   documentation rather than implying full AHRM matrix coverage.
5. Add a generated profile table shared by native and JS tests to prevent
   future mapping drift.

Acceptance criteria:

- Every AHRM profile in the supported scope has the same bank bits, capacity,
  CPU window, ANTIC window, and ROM-overlay rules in both cores.
- Unsupported profiles are clearly marked as unsupported.

### AHRM-05: Define the U1MB support boundary and implement the minimum model

Priority: **P1**

Difficulty: **high** for full support; **low** for documenting a strict partial
boundary.

Viability: **medium**. The memory-bank and initial UCTL/UAUX/COLDF behavior is
already present, but full U1MB requires ROM/flash mapping and firmware-driven
behavior that is substantially larger than a normal memory expansion.

Current gap:

- UCTL, UAUX, COLDF, and the 1MB extended-memory geometry are modeled.
- U1MB BIOS, selectable OS/BASIC/Game ROMs, flash command state, RTC, PBI,
  cartridge control, and configuration-dependent I/O RAM are not modeled.

Steps if full U1MB is required:

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

- The UI does not present the partial model as a complete U1MB computer.
- A software reset and a cold reset produce the documented COLDF and BIOS
  behavior.
- The native and JS models agree on every implemented U1MB register and map.

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

Steps:

1. Add minimal synthetic 6502 fixtures that place the relevant register write,
   IRQ acknowledge, or DMA request at each boundary cycle.
2. Capture `NMIST`, `NMIEN`, CPU PC, beam cycle, DMA schedule, and bus value in
   both cores.
3. Compare each result with the corresponding AHRM timing example and, where
   possible, an Altirra trace.
4. Implement one timing rule at a time in JS and native code.
5. Add regression tests before moving to the next corner case.
6. Run real raster content such as Atomix Plus! and GTIA 9++ examples only
   after the synthetic tests pass.

Acceptance criteria:

- JS and native produce the same NMI, DMA-steal, bus-value, and visible-line
  results for every new boundary fixture.
- No title-specific timing branch is introduced.

### AHRM-07: Improve GTIA/PMG raster replay fidelity

Priority: **P2**

Difficulty: **high**

Viability: **medium**. The current shift-register model handles the common PMG
path, but exact mid-line replay requires preserving more register-write and
fetch history than the current first-visible-span reconstruction.

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

Acceptance criteria:

- A change to one core cannot silently alter the other core's documented
  behavior.
- Every resolved alignment item has a reproducible regression trace.

## Recommended execution order

1. AHRM-01: native DDRB/ORB correction.
2. AHRM-02: remove or gate `CONSOL_HACK`.
3. AHRM-09: add the smallest cross-core trace fixtures needed by the first two
   items.
4. AHRM-03: PIA control-line and IRQ model.
5. AHRM-04: decide and close the supported memory-profile matrix.
6. AHRM-05: explicitly bound or extend U1MB support.
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

