# Prince of Persia intro graphics regression

## Status

Open investigation. No code fix has been applied and no title-specific workaround
is acceptable. The same visual failure has now been reproduced in Windows and
Linux.

## Reproduction history

Prince of Persia has been used as a recurring regression title because its
intro combines rasterized graphics, animation, music, and timing-sensitive
POKEY activity.

Earlier observations recorded in the project were mixed:

- The linked POKEY timer correction restored the previously muffled voice in
  the jsA8E loading/demo path.
- A later in-game check exposed a linked-timer low-counter reload defect; both
  cores were updated and the focused linked-audio regressions passed.
- A separate long-run jsA8E presentation/demo test had previously shown
  intermittent repeated or corrupted graphics after approximately 10--20
  minutes. Prince of Persia was also observed to corrupt graphically during
  prolonged scene-loop activity, but that occurrence was not initially
  reproducible.
- On 2026-10-13, the Prince of Persia intro presentation with music was
  observed as graphically distorted again after rebuilding from the `main`
  branch. The same distortion was then reproduced in an A8E build compiled on
  openSUSE 16. The Linux result is the important new cross-platform evidence.

The exact frame, video standard, memory profile, and whether the audio itself
was abnormal in the Linux run were not captured yet. Those values must be
recorded in the next session.

## Windows build investigation

The initial suspicion was that a different external library had been used.
The effective Windows configuration was inspected:

- Generator: Visual Studio 18 2026, x64.
- Compiler: MSVC 19.51.36257.0.
- Runtime: static MSVC runtime (`/MT` for Release).
- SDL2: statically linked from
  `C:\dev\external\vcpkg\installed\x64-windows-static`.
- SDL2 package metadata: `2.32.10#1`.
- The executable has no `SDL2.dll` dependency; SDL2 is linked into the
  executable.

The test procedure was:

1. Stash uncommitted changes on `FullLibrary`.
2. Switch to `main`.
3. Compile A8E and run Prince of Persia.
4. Observe the same distorted intro presentation.
5. Return to `FullLibrary` and restore the stash.

The shared `build\\msvc` directory was reused. Its generated Visual Studio
project, produced during the `main` build, did not list the `Library*.c`
sources. Older `Library*.obj` files remained in the directory, but they were
not referenced by that generated project and therefore were not evidence that
the Full Library code was linked into the `main` executable.

This makes an external-library mismatch unlikely, but the build was still
incremental and did not contain an embedded Git revision. A separate clean
build directory is still required for a definitive binary provenance check.

## Linux result

A8E was compiled on openSUSE 16 using the documented CMake/SDL2 build path.
The Prince of Persia intro showed the same graphical distortion as the Windows
run. This substantially weakens explanations involving:

- MSVC code generation;
- Windows static SDL2;
- DirectSound or another Windows-only audio backend;
- the Windows desktop compositor or SDL texture presentation path.

The Linux compiler version, SDL2 version, exact CMake command, video standard,
memory profile, and executable hash still need to be recorded.

## Current conclusion

The failure is now classified as a common-core graphics/timing regression,
not as a Windows-only library or packaging problem. The leading investigation
areas are:

- ANTIC display-list fetch and DMA timing;
- GTIA playfield/PMG composition and priority state;
- CHBASE/character data timing and raster changes;
- CPU timed-event boundaries affecting raster code;
- PAL/NTSC or memory-profile selection differences;
- only secondarily, POKEY timing if the audio is also demonstrably affected.

The AHRM-07 synthetic PMG/GTIA diagnostics passing does not certify every
real-world title raster sequence. The project documentation explicitly keeps
title-level visual comparisons separate from the synthetic diagnostic scope.
No AHRM-compliant conclusion can be drawn about the exact faulty subsystem
until a reproducible frame or trace is captured.

## Required next-session evidence

1. Build `main` in a new directory, without reusing `build\\msvc`:
   `build/linux-main` on Linux or an equivalent isolated Windows directory.
2. Record `git rev-parse HEAD`, compiler version, SDL2 version, CMake command,
   executable hash, PAL/NTSC selection, and memory profile.
3. Capture the same intro frame from Altirra, jsA8E, native Windows A8E, and
   native Linux A8E if possible.
4. Determine whether the corruption is present immediately or appears after
   a fixed number of frames/scene loops.
5. Record whether music, animation, and keyboard/joystick input remain
   functional while the image is distorted.
6. If the clean `main` build reproduces the issue, bisect from the last known
   good revision before changing production code.
7. Use an opt-in ANTIC/GTIA raster trace or framebuffer dump to locate the
   first divergent display-list, character-base, DMA, or priority state. Any
   fix must be generic and justified against AHRM behavior in both jsA8E and
   native A8E.

