# AHRM-11 POKEY Audio Capture Test

`AHRM11_POKEY_AUDIO_TEST.XEX` plays a deterministic six-phase sequence. Each
phase lasts 64 frames and the current phase number is written at screen offset
96, allowing the audio recording to be aligned with the video recording.

The phases are:

1. Channel 1 square wave.
2. Channel 1 poly-4 noise.
3. Channel 1 poly-9 noise.
4. Linked fast-clock timers 1+2.
5. Volume-only output.
6. Channel 1 with the channel-3 high-pass source.

All active channels use conservative volume levels. The program does not claim
`PASS` because POKEY audio correctness requires an external capture.

## Capture procedure

Run the same XEX on jsA8E, native A8E, Altirra, and one real Atari. Capture
the audio and video from a common start point, then compare each 64-frame
phase. For a useful first comparison record:

- phase duration and ordering;
- fundamental frequency of the square and linked-timer phases;
- noise spectrum and repeat pattern;
- DC level and amplitude of volume-only output;
- high-pass phase spectrum and transient behaviour;
- PAL versus NTSC frequency differences.

Use a fixed sample rate and avoid automatic normalisation or noise reduction.
The AHRM sections 5.3--5.5 describe the timer clocks, distortion modes,
volume-only path, high-pass path, and shared noise generators exercised here.
