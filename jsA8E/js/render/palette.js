(function () {
  "use strict";

  const CLAMP = x => {
    if (x < 0) return 0;
    if (x > 255) return 255;
    return x | 0;
  };

  function normalizeVideoStandard(value) {
    if (value === undefined || value === null) return "pal";
    const text = String(value).trim().toLowerCase();
    return text === "ntsc" ? "ntsc" : "pal";
  }

  function buildPalette(hueAngle, contrast, brightness) {
    const palette = new Uint8Array(256 * 3);

    for (let lum = 0; lum < 16; lum++) {
      for (let hue = 0; hue < 16; hue++) {
        let dS, dY;
        if (hue === 0) {
          dS = 0.0;
          dY = (lum / 15.0) * contrast;
        } else {
          dS = 0.5;
          dY = ((lum + brightness) / (15.0 + brightness)) * contrast;
        }

        const angle = (hueAngle[hue] / 180.0) * Math.PI;
        const dR = dY + dS * Math.sin(angle);
        const dG =
          dY -
          (27.0 / 53.0) * dS * Math.sin(angle) -
          (10.0 / 53.0) * dS * Math.cos(angle);
        const dB = dY + dS * Math.cos(angle);

        const r = CLAMP(dR * 256.0);
        const g = CLAMP(dG * 256.0);
        const b = CLAMP(dB * 256.0);

        const idx = (lum + hue * 16) * 3;
        palette[idx + 0] = r;
        palette[idx + 1] = g;
        palette[idx + 2] = b;
      }
    }

    return palette;
  }

  const PAL_HUE_ANGLES = [
    0.0,
    163.0,
    150.0,
    109.0,
    42.0,
    17.0,
    -3.0,
    -14.0,
    -26.0,
    -53.0,
    -80.0,
    -107.0,
    -134.0,
    -161.0,
    -188.0,
    -197.0,
  ];

  const NTSC_HUE_ANGLES = [
    0.0,
    163.0,
    139.0,
    115.0,
    91.0,
    67.0,
    43.0,
    19.0,
    -5.0,
    -29.0,
    -53.0,
    -77.0,
    -101.0,
    -125.0,
    -149.0,
    -173.0,
  ];

  // Keep NTSC and PAL palettes separate so the renderer mirrors the
  // standard-specific chroma math.
  function createAtariPaletteRgb(videoStandard) {
    const standard = normalizeVideoStandard(videoStandard);
    if (standard === "ntsc") {
      return buildPalette(NTSC_HUE_ANGLES, 1.0, 0.9);
    }
    return buildPalette(PAL_HUE_ANGLES, 1.0, 0.9);
  }

  window.A8EPalette = {
    createAtariPaletteRgb: createAtariPaletteRgb,
  };
})();
