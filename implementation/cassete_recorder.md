# Virtual Cassette Recorder Subproject

Status: design proposal  
Date: 2026-10-08

## Purpose

Implement a virtual Atari 410/1010 cassette recorder backed by audio files.
The feature should support standard cassette data in both the native A8E
application and the browser-based `jsA8E` application.

The first goal is reliable program loading and saving through the Atari SIO
protocol. Full acoustic simulation of a physical cassette recorder, including
noise, wow, flutter, and non-standard turbo formats, is a later phase.

## Cross-application parity policy

This subproject must be implemented in both native A8E and `jsA8E`. The native
and browser versions may use different audio decoders, UI layers, and storage
backends, but they must preserve the same cassette protocol contract,
observable transport behavior, supported standard format, and regression
fixtures.

The project is not complete if cassette support works in only one application.
Any temporary platform gap must be recorded as an explicit follow-up task.

## Current state

The current A8E and `jsA8E` implementations do not expose a dedicated cassette
device. Their SIO implementation is primarily disk-oriented. Existing POKEY
serial timing and PIA/SIO signaling provide useful foundations, but a cassette
transport, FSK decoder, FSK encoder, and cassette-specific SIO device still
need to be added.

## Dependency and implementation order

The native cassette recorder must be implemented after the
`A8E_multi_drives.md` subproject has prepared the pluggable SIO foundation. It
must not add cassette-specific command parsing directly to the current
`Pokey_SEROUT_SERIN()` disk path.

The required order is:

```text
A8E_multi_drives.md
    -> SioBus and transaction timing
    -> SioDevice registration
    -> DiskDevice and D1:-D8: routing
    -> common SIO protocol tests
        |
        v
cassete_recorder.md
    -> CassetteDevice
    -> cassette transport
    -> FSK decoder and encoder
    -> WAV/MP3 integration
```

Before native cassette work begins, the multi-drive project should provide at
least:

- a bus-owned command and response state machine;
- emulated-time response scheduling;
- a pluggable `SioDevice` interface;
- Device ID routing independent of D1:;
- asynchronous data-phase support;
- common checksum, ACK/NAK, Complete/Error, and reset tests.

`jsA8E` may develop its audio source and FSK processing independently, but its
cassette integration should follow the same device and transaction contract
where the browser SIO implementation supports it.

## AHRM behavior

The Atari 410/1010 recorder is connected through SIO:

- the computer controls the recorder motor;
- playback uses frequency-shift keying (FSK);
- the approximately 4 kHz tone represents a zero;
- the approximately 5 kHz tone represents a one;
- recorded bytes are sent least-significant bit first;
- each byte uses a start bit, eight data bits, and a stop bit;
- standard recording uses tones near 3995 Hz and 5327 Hz.

The implementation must use the [AHRM 410/1010 Program Recorder](../AHRM/9.%20Serial%20I-O%20%28SIO%29%20Bus/17.%20410-1010%20Program%20Recorder.md)
as the hardware reference.

## Proposed architecture

```text
WAV/MP3
   |
   v
Audio decoder
   |
   v
Cassette transport
   +-- motor
   +-- play/record
   +-- tape position
   +-- tape timing
   |
   +-- FSK decoder
   +-- FSK encoder
   +-- SIO cassette device
           |
           v
        SERIN/SEROUT
```

### Audio source

`CassetteAudioSource` should provide decoded sample data independently of the
emulator UI. It should expose sample rate, channel count, duration, and a
deterministic sample stream.

### Tape transport

`CassetteTransport` should model:

- motor stopped/running state;
- play and record modes;
- current tape position;
- end-of-tape behavior;
- start/stop delays where required;
- dirty state for recordings;
- seeking or rewinding for the UI.

### FSK decoder

`CassetteFskDecoder` should convert audio into serial bits. The decoder should
be tolerant of amplitude changes and should not depend on a fixed volume
threshold. Suitable techniques include band-pass filters, zero-crossing
measurement, Goertzel frequency detection, or a combination of these.

The decoder should preserve timing information so that bytes are delivered to
the Atari according to emulated time rather than host wall-clock time.

### FSK encoder

`CassetteFskEncoder` should convert serial bytes into the standard cassette
tones. It should generate PCM audio for WAV output and use the same timing
rules as the decoder.

### SIO cassette device

The cassette device should be a separate SIO backend, not an ATR drive. It
should connect cassette data and motor control to the existing POKEY/PIA timing
model while keeping cassette state independent from `SioDrive` disk state.

## File-format policy

### WAV

WAV PCM is the preferred preservation and recording format because it:

- is lossless;
- preserves FSK frequencies and timing;
- is deterministic;
- is easy to parse natively;
- is suitable for generated recordings.

The native A8E implementation can support basic RIFF/WAV PCM parsing and WAV
writing without introducing a third-party codec dependency.

### MP3

MP3 may be supported as an optional playback input, especially in `jsA8E`, but
should not be the primary recording format. Lossy encoding may introduce:

- attenuation of relevant frequencies;
- encoder delay and padding;
- variable-bitrate timing differences;
- resampling artifacts;
- distortion around tone transitions.

MP3 output is not recommended for cassette recordings.

## Platform strategy

### Native A8E

Recommended initial scope:

- read standard WAV PCM;
- decode standard FSK;
- generate and save WAV recordings;
- use the existing POKEY serial timing and PIA signaling;
- keep MP3 support optional until a cross-platform decoding strategy is chosen.

The current native project uses SDL audio but does not currently include a
cross-platform MP3 decoder. Adding native MP3 support would require a codec
dependency or platform-specific decoder backends, which must be evaluated
against the project's no-unnecessary-dependencies policy.

### jsA8E

The browser can use `AudioContext.decodeAudioData()` for WAV and browser-
supported MP3 input. Decoding should occur in a Worker or preprocessing task
to avoid blocking the emulator.

Decoded cassette content may be stored in IndexedDB alongside the jsA8E
Library. Generated recordings should be exported as WAV PCM rather than relying
on `MediaRecorder`, whose usual output is WebM/Opus.

## Deterministic timing

Cassette decoding must not depend on the physical playback clock of the host.
This is especially important for turbo mode, headless execution, automated
tests, and fast-forward operation.

The preferred data path is:

```text
audio samples
    -> frequency detection
    -> timed bit events
    -> serial bytes
    -> SIO
```

The emulator clock should determine when decoded bits become visible to the
Atari. Optional audible playback may run separately through the host audio
system.

## Recommended implementation phases

### Phase 1: standard WAV playback after pluggable SIO

- Add `CassetteDevice` through the pluggable SIO registration API.
- Add WAV PCM loading.
- Add cassette transport and motor state.
- Implement standard FSK detection for playback.
- Deliver decoded serial bytes through the shared SIO transaction model.
- Test with Atari BASIC `CLOAD` and known standard cassette programs.

### Phase 2: WAV recording

- Capture serial output bytes from the cassette SIO device.
- Generate standard FSK tones.
- Write deterministic mono WAV PCM files.
- Mark recordings dirty until successfully saved.

### Phase 3: jsA8E MP3 playback

- Decode browser-supported MP3 files.
- Normalize channel layout and sample-rate handling.
- Preserve original metadata while storing decoded playback data or the source
  file in IndexedDB.
- Add recovery behavior for unsupported browser codecs.

### Phase 4: native MP3 playback

- Select a cross-platform codec strategy.
- Keep the decoder behind an audio-source interface.
- Add codec-specific tests and licensing review.

### Phase 5: compatibility improvements

- Add amplitude-independent decoding.
- Handle inverted phase and moderate noise.
- Add resampling and drift tolerance.
- Support turbo cassette formats explicitly.
- Add rewind, seek, and tape-position controls.

## Testing strategy

Tests should cover:

- WAV parsing and malformed-file rejection;
- mono/stereo conversion;
- sample-rate conversion;
- detection of 4 kHz and 5 kHz tones;
- LSB-first byte reconstruction;
- start and stop bits;
- motor start/stop behavior;
- end-of-tape behavior;
- deterministic timing under turbo/headless execution;
- WAV round-trip encoding and decoding;
- standard BASIC `CLOAD`/`CSAVE` flows;
- noisy or amplitude-scaled recordings;
- MP3 playback where the platform codec is available.

The first regression fixture should be a known-good standard WAV recording,
with expected decoded bytes and timing boundaries. Turbo and intentionally
damaged tapes should be separate fixtures.

## Decisions

- WAV PCM is the canonical preservation and recording format.
- MP3 is an optional playback input, not the canonical output format.
- The cassette is modeled as an SIO device, not as an ATR disk.
- The first implementation targets standard cassette FSK.
- Turbo cassette formats are deferred until standard compatibility is stable.
- Native A8E should not gain an MP3 dependency without an explicit decision.
- `jsA8E` may use browser-native audio decoding.
- Decoded tape timing must be driven by emulated time, not host wall-clock
  playback.
- Audio playback and data decoding should be separable.

## Open questions

- Which SIO device ID and cassette command subset should be exposed first?
- Should the cassette source be stored as original compressed audio, decoded
  PCM, or both in jsA8E IndexedDB?
- Should the native implementation share a portable cassette metadata format
  with jsA8E?
- How should motor control be represented in the existing PIA/SIO abstraction?
- Should recordings include silence, leader tones, and trailing audio exactly
  as generated by the encoder?
- Which turbo cassette formats are important for the target software set?

## Non-goals for the initial implementation

- Perfect physical tape-mechanism simulation.
- Universal support for arbitrary turbo cassette formats.
- MP3 as the preferred recording format.
- Host-clock-dependent decoding.
- Automatic repair of severely damaged or incomplete recordings.
