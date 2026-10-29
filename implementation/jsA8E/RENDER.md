# Rendering / CRT

> Hardware emulation reference: Before implementing any Atari 800 XL PAL/NTSC hardware emulation, use the [AHRM](/AHRM/index.md) as reference.

- Files: `jsA8E/js/render/gl.js`, `jsA8E/js/render/software.js`, `jsA8E/js/render/palette.js`, `jsA8E/js/render/shaders/webgl2.vert.glsl`, `jsA8E/js/render/shaders/webgl2.decode.frag.glsl`, `jsA8E/js/render/shaders/webgl2.crt.frag.glsl`, `jsA8E/js/render/shaders/webgl1.vert.glsl`, `jsA8E/js/render/shaders/webgl1.decode.frag.glsl`, `jsA8E/js/render/shaders/webgl1.crt.frag.glsl`
- Purpose: convert emulator frame data into display output.
- Status: updated on 2026-10-29 (`implemented`, including the initial VBXE
  RGB-overlay presentation path).
- Notes: WebGL uses a two-pass path (decode pass, then CRT post-process pass). CRT shader applies filtering and scanline shaping; software rendering is fallback if WebGL/shaders fail. Frame presentation now copies the completed emulation buffer into a dedicated present buffer before `paint()`, so the renderer only samples a fully finished frame, and WebGL contexts avoid low-latency/desynchronized mode to reduce visible tearing during frame delivery. The completed frame carries a separate 32-bit VBXE RGB overlay plane plus a 672-pixel scene-width plane for VBXE hires/text. The decode shader displays the latter after the Atari/normal-VBXE composite, preserving the 640-pixel normal-width signal instead of reducing it to the Atari aperture. VBXE does not mutate the Atari palette.
- CRT control: the toolbar CRT button defaults on and persists its preference in `localStorage`. When off, the decode pass draws directly to the canvas with nearest-neighbor sampling and skips the CRT pass. The worker and main-thread paths repaint immediately, including while paused. Canvas 2D always uses clean output.
- Issues: full shader/render path requires HTTP serving; `file://` cannot fully initialize fetch-based assets.
- Todo: keep CRT visual tuning and software fallback parity documented. The
worker presentation path does not yet carry the VBXE RGB plane, so the UI
chooses the main-thread runtime whenever VBXE is enabled.
