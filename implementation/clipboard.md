# Clipboard Integration Subproject

Status: design proposal  
Date: 2026-10-08

## Purpose

Provide copy-and-paste integration between the host system and the Atari
emulator in both native A8E and browser-based `jsA8E`.

The primary use case is copying text into Atari applications such as BASIC or
AtariWriter. A secondary use case is copying the emulated screen as an image or
extracting text from screen modes whose character data can be identified
deterministically.

Every implementation must preserve cross-application parity. Native and
browser-specific clipboard adapters are allowed, but the input mapping,
supported text behavior, shortcuts, and test expectations must remain aligned.

## Capability levels

| Capability | jsA8E | Native A8E | Initial priority |
|---|---:|---:|---:|
| Paste host text into Atari | High | High | MVP |
| Copy recognized Atari text to host | Medium | Medium | Phase 2 |
| Copy emulator screen as image | High | Medium | Phase 2 |
| Paste image into Atari graphics | Low | Low | Future |

The screen is fundamentally a pixel surface, not a text document. Universal
text extraction from arbitrary Atari graphics is therefore outside the first
implementation.

## Paste text into the emulator

Pasting text into the Atari is the most reliable feature. The host text must
pass through the existing keyboard/input path rather than writing directly to
Atari memory.

```text
Host clipboard
    -> clipboard adapter
    -> Unicode/host text normalization
    -> ATASCII/Atari keyboard mapping
    -> paced key events
    -> Atari keyboard input
```

The implementation should reuse the existing `jsA8E` text-input path and the
native `AtariIoKeyboardEvent()` mapping instead of creating a separate text
injection mechanism.

Supported transformations should include:

- upper- and lower-case text according to the selected keyboard mapping;
- Enter and line breaks;
- Backspace;
- Tab where the target application supports it;
- common punctuation and symbols;
- replacement or omission of Unicode characters with no ATASCII equivalent.

Text should be injected at a configurable rate. Sending a complete clipboard
string in one CPU step can overflow the Atari keyboard buffer or lose
characters.

## Browser clipboard adapter

`jsA8E` may use the browser Clipboard API:

```text
navigator.clipboard.readText()
```

Clipboard reads must be initiated by an explicit user gesture and may require
HTTPS or `localhost`. The UI should provide a fallback hidden text input for
browsers that deny direct clipboard access.

The browser adapter must not request clipboard contents silently during startup
or while the emulator is running without a user action.

## Native clipboard adapter

Native A8E can use the SDL clipboard API:

```c
SDL_GetClipboardText()
SDL_SetClipboardText()
```

The adapter should convert the retrieved host text into the same logical input
events used by physical keyboard input. The emulator core should not depend on
SDL clipboard calls directly; the UI/input layer should provide the adapter.

## Copy recognized Atari text

Copying text from the Atari screen is more difficult because the renderer only
has pixels at the final stage.

### Deterministic character-mode extraction

For standard character modes, text can be reconstructed from emulator state:

- ANTIC display-list mode;
- screen-memory address;
- CHBASE value;
- character dimensions;
- character bytes;
- ATASCII mapping.

This approach should work well for BASIC, text editors, and applications that
use normal Atari character modes. It should be implemented in a shared logical
screen-extraction layer with platform-specific clipboard output.

### Region selection

The UI may provide a rectangular selection overlay:

```text
Ctrl+C
    -> select a screen region
    -> extract characters when the mode is supported
    -> convert ATASCII to Unicode
    -> copy text to the host clipboard
```

If the selected region cannot be decoded deterministically, the UI should
explain that the content is graphical rather than silently returning incorrect
text.

### OCR

OCR could support custom fonts and graphical text, but it should not be part of
the MVP. It would add a dependency, reduce determinism, and complicate parity
between native A8E and `jsA8E`.

## Copy the screen as an image

Copying the rendered screen as an image is independent of text extraction.

### jsA8E

The canvas can be converted to an image blob and written through the browser
Clipboard API. PNG is the preferred format for lossless Atari pixels.

### Native A8E

The SDL framebuffer can be converted to the platform clipboard bitmap format.
The implementation must account for pixel format, row pitch, and platform
clipboard ownership. A file export fallback may be provided if direct bitmap
clipboard integration is unavailable.

Recommended shortcuts:

```text
Ctrl+V       -> paste host text into Atari
Ctrl+C       -> copy recognized Atari text when available
Ctrl+Shift+C  -> copy the emulator screen as an image
```

The exact shortcuts remain subject to the existing emulator keyboard policy.

## Shared API model

The platform adapters should expose a small common contract:

```text
clipboard.pasteText()
clipboard.copyText(text)
clipboard.copyScreenImage()
screen.extractText(region)
```

`screen.extractText(region)` should return either recognized text with a
confidence/source indication or an explicit unsupported result. It must not
pretend that arbitrary pixels are reliable text.

## Security and safety

- Clipboard reads require explicit user action.
- Clipboard contents must not be logged by default.
- Pasted text must be size-limited and paced.
- Unsupported control characters must be filtered or mapped explicitly.
- Copy operations must not expose emulator state beyond the requested text or
  image.
- Browser permissions and denied clipboard access must produce a recoverable UI
  message.

## Implementation phases

### Phase 1: host text paste

- Add browser and native clipboard adapters.
- Reuse the existing keyboard mapping and text injection paths.
- Add pacing, line-break handling, and unsupported-character policy.
- Add `Ctrl+V` or an explicit Paste action in both applications.

### Phase 2: image copy and character-mode extraction

- Add screen image copy for `jsA8E` and native A8E.
- Implement deterministic extraction for standard character modes.
- Add region selection and `Ctrl+C` behavior.
- Add tests for screen memory, CHBASE, ATASCII conversion, and selection.

### Phase 3: advanced text compatibility

- Support custom character sets where their memory can be identified.
- Improve handling of inverse characters and Atari control codes.
- Add optional OCR only if there is a clear cross-application strategy.

## Testing requirements

Tests should cover both applications and include:

- ASCII text paste;
- line breaks, Backspace, Tab, and punctuation;
- Unicode characters with no ATASCII equivalent;
- long text pacing and keyboard-buffer behavior;
- browser clipboard permission denial;
- native clipboard unavailable/error paths;
- standard text-mode extraction;
- inverse characters and custom CHBASE handling;
- unsupported graphical-region extraction;
- screenshot copy pixel integrity;
- parity of logical text input between `jsA8E` and native A8E.

## Decisions

- Host-to-Atari text paste is the first priority.
- Clipboard operations must use the normal logical keyboard/input path.
- Text injection must be paced according to emulated input behavior.
- WAV/image-style screen copying is separate from text extraction.
- Deterministic character-mode extraction is preferred over OCR.
- OCR is deferred because it introduces dependency and parity risks.
- Browser and native adapters may differ internally, but the user-facing
  behavior and logical input mapping must remain synchronized.
