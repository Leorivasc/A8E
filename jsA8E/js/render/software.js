(function () {
  "use strict";

  const IS_LITTLE_ENDIAN =
    new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 0x04;

  function buildPaletteRgba32(paletteRgb) {
    const out = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      const pi = i * 3;
      const r = paletteRgb[pi + 0] & 0xff;
      const g = paletteRgb[pi + 1] & 0xff;
      const b = paletteRgb[pi + 2] & 0xff;
      out[i] = IS_LITTLE_ENDIAN
        ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
        : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
    }
    return out;
  }

  function createApi(cfg) {
    const Palette = cfg.Palette;
    const PIXELS_PER_LINE = cfg.PIXELS_PER_LINE;
    const LINES_PER_SCREEN_PAL = cfg.LINES_PER_SCREEN_PAL;
    const VIEW_W = cfg.VIEW_W;
    const VIEW_H = cfg.VIEW_H;
    const VIEW_X = cfg.VIEW_X;
    const VIEW_Y = cfg.VIEW_Y;
    const VIDEO_STANDARD = cfg.VIDEO_STANDARD;
    const PLAYFIELD_SCRATCH_WIDTH = PIXELS_PER_LINE + 184;
    const VBXE_HIRES_WIDTH = VIEW_W * 2;

    function makeVideo() {
      const palette = Palette.createAtariPaletteRgb(VIDEO_STANDARD);
      return {
        pixels: new Uint8Array(PIXELS_PER_LINE * LINES_PER_SCREEN_PAL),
        priority: new Uint16Array(PIXELS_PER_LINE * LINES_PER_SCREEN_PAL),
        // Tracks only GTIA layers contributing to the final pixel where P/M
        // graphics were evaluated. VBXE uses it for PRIOR-sensitive overlay
        // collisions; zero means the normal active-layer priority applies.
        vbxeCollisionPriority: new Uint16Array(PIXELS_PER_LINE * LINES_PER_SCREEN_PAL),
        presentPixels: new Uint8Array(PIXELS_PER_LINE * LINES_PER_SCREEN_PAL),
        presentPriority: new Uint16Array(PIXELS_PER_LINE * LINES_PER_SCREEN_PAL),
        vbxeRgb: new Uint32Array(PIXELS_PER_LINE * LINES_PER_SCREEN_PAL),
        presentVbxeRgb: new Uint32Array(PIXELS_PER_LINE * LINES_PER_SCREEN_PAL),
        // Hires graphics and text need their 640-pixel normal-width signal
        // preserved until presentation; the Atari line buffer is too narrow.
        vbxeHiresRgb: new Uint32Array(VBXE_HIRES_WIDTH * VIEW_H),
        presentVbxeHiresRgb: new Uint32Array(VBXE_HIRES_WIDTH * VIEW_H),
        vbxeHiresWidth: VBXE_HIRES_WIDTH,
        playfieldScratchPixels: new Uint8Array(
          PLAYFIELD_SCRATCH_WIDTH * LINES_PER_SCREEN_PAL,
        ),
        playfieldScratchPriority: new Uint16Array(
          PLAYFIELD_SCRATCH_WIDTH * LINES_PER_SCREEN_PAL,
        ),
        playfieldScratchVbxeCollisionPriority: new Uint16Array(
          PLAYFIELD_SCRATCH_WIDTH * LINES_PER_SCREEN_PAL,
        ),
        playfieldScratchWidth: PLAYFIELD_SCRATCH_WIDTH,
        paletteRgb: palette,
        paletteRgba32: buildPaletteRgba32(palette),
        crtEnabled: true,
      };
    }

    function blitViewportToImageData(video, imageData) {
      const dst32 = new Uint32Array(
        imageData.data.buffer,
        imageData.data.byteOffset,
        VIEW_W * VIEW_H,
      );
      const pal32 = video.paletteRgba32;
      const srcPixels = video.presentPixels || video.pixels;
      const vbxeRgb = video.presentVbxeRgb || video.vbxeRgb;
      const vbxeHiresRgb = video.presentVbxeHiresRgb || video.vbxeHiresRgb;
      const vbxeHiresWidth = video.vbxeHiresWidth | 0;

      let dstIdx = 0;
      for (let y = 0; y < VIEW_H; y++) {
        let src = (VIEW_Y + y) * PIXELS_PER_LINE + VIEW_X;
        const srcEnd = src + VIEW_W;
        let viewX = 0;
        while (src < srcEnd) {
          const hiresPixel = vbxeHiresRgb && vbxeHiresWidth > 0
            ? vbxeHiresRgb[y * vbxeHiresWidth + viewX * 2]
            : 0;
          let pixel = hiresPixel || (vbxeRgb && vbxeRgb[src]) || pal32[srcPixels[src] & 0xff];
          if (video.crtEnabled && (y & 1) && IS_LITTLE_ENDIAN) {
            pixel = ((pixel & 0xff000000) | (((pixel & 0xff) * 0.78) & 0xff) |
              (((((pixel >>> 8) & 0xff) * 0.78) & 0xff) << 8) |
              (((((pixel >>> 16) & 0xff) * 0.78) & 0xff) << 16)) >>> 0;
          }
          dst32[dstIdx++] = pixel;
          src++;
          viewX++;
        }
      }
    }

    function fillLine(video, y, x, w, color, priority) {
      const base = y * PIXELS_PER_LINE + x;
      const pixels = video.pixels;
      const c = color & 0xff;
      if (priority === null || priority === undefined) {
        for (let i = 0; i < w; i++) pixels[base + i] = c;
        return;
      }
      const pr = video.priority;
      const p = priority & 0xffff;
      for (let j = 0; j < w; j++) {
        pixels[base + j] = c;
        pr[base + j] = p;
      }
    }

    return {
      makeVideo: makeVideo,
      blitViewportToImageData: blitViewportToImageData,
      fillLine: fillLine,
    };
  }

  window.A8ESoftware = {
    createApi: createApi,
  };
})();
