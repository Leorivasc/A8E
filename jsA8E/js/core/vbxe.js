(function () {
  "use strict";

  const VRAM_SIZE = 512 * 1024;
  const PALETTE_COUNT = 4;
  const PALETTE_ENTRIES = 256;
  const PALETTE_COMPONENTS = 3;
  const REGISTER_COUNT = 0x20;
  const DEFAULT_PAGE = 0xd640;
  const VBXE_CONTRIBUTOR_VALID = 0x8000;
  // These match the shared GTIA layer bits in hw.js. VBXE deliberately reads
  // per-pixel layer metadata rather than the final RGB value: different GTIA
  // layers can have the same visible color but have distinct collision
  // meanings in COLDETECT.
  const PRIO_PF0 = 0x0001;
  const PRIO_PF1 = 0x0002;
  const PRIO_PF2 = 0x0004;
  const PRIO_PF3 = 0x0008;
  const PRIO_PM0 = 0x0010;
  const PRIO_PM1 = 0x0020;
  const PRIO_PM2 = 0x0040;
  const PRIO_PM3 = 0x0080;
  const PRIO_M10_PM0 = 0x0100;
  const PRIO_M10_PM1 = 0x0200;
  const PRIO_M10_PM2 = 0x0400;
  const PRIO_M10_PM3 = 0x0800;

  function createXdlState() {
    return { address: 0, overlayAddress: 0, overlayStride: 0, mode: "off",
      enabled: false, repeat: 0, ended: false, overlayPalette: 1, priority: 0xff,
      textScrollX: 0, textScrollY: 0, characterBase: 0, textRow: 0,
      attributeMapEnabled: false, attributeAddress: 0, attributeStride: 0,
      attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 8,
      attributeCellHeight: 8, attributeRow: 0 };
  }

  function normalizeConfig(value) {
    const source = value && typeof value === "object" ? value : {};
    const rawProfile =
      typeof value === "string" ? value : (source.profile || "off");
    const profile = String(rawProfile).trim().toLowerCase();
    const enabled = profile === "fx1.26" || profile === "fx126" || source.enabled === true;
    const page = (source.page | 0) === 0xd740 ? 0xd740 : DEFAULT_PAGE;
    return {
      enabled: enabled,
      profile: enabled ? "fx1.26" : "off",
      page: page,
    };
  }

  function loadPowerUpPalette(state, gtiaPalette) {
    if (!state || !gtiaPalette) return;
    const colors = new Uint8Array(gtiaPalette);
    state.palette.set(colors.subarray(0, PALETTE_ENTRIES * PALETTE_COMPONENTS), 0);
  }

  function createState(config, gtiaPalette) {
    const normalized = normalizeConfig(config);
    const state = {
      enabled: normalized.enabled,
      profile: normalized.profile,
      page: normalized.page,
      vram: new Uint8Array(VRAM_SIZE),
      palette: new Uint8Array(PALETTE_COUNT * PALETTE_ENTRIES * PALETTE_COMPONENTS),
      videoControlPending: 0,
      videoControlActive: 0,
      xdlAddressPending: 0,
      xdlAddressActive: 0,
      colorSelect: 0,
      paletteSelect: 0,
      collisionMask: 0,
      collisionDetect: 0,
      blitAddress: 0,
      blitCollisionCode: 0,
      blitterBusy: 0,
      irqStatus: 0,
      irqControl: 0,
      priority: new Uint8Array(4),
      memacBControl: 0,
      memacControl: 0,
      memacBankSelect: 0,
      xdl: createXdlState(),
    };
    // AHRM 12.4: power-up loads palette 0 from the GTIA palette; the other
    // three palettes remain clear until software writes them.
    loadPowerUpPalette(state, gtiaPalette);
    return state;
  }

  function softReset(state) {
    if (!state) return;
    state.videoControlPending = 0;
    state.videoControlActive = 0;
    state.xdlAddressPending = 0;
    state.xdlAddressActive = 0;
    state.collisionDetect = 0;
    state.blitterBusy = 0;
    state.irqStatus = 0;
    state.irqControl = 0;
    state.priority.fill(0);
    state.memacBControl = 0;
    state.memacControl = 0;
    state.memacBankSelect = 0;
  }

  function powerCycle(state, gtiaPalette) {
    if (!state) return;
    softReset(state);
    state.vram.fill(0);
    state.palette.fill(0);
    loadPowerUpPalette(state, gtiaPalette);
    state.colorSelect = 0;
    state.paletteSelect = 0;
    state.collisionMask = 0;
    state.blitAddress = 0;
    state.blitCollisionCode = 0;
  }

  function verticalSync(state) {
    if (!state || !state.enabled) return;
    state.videoControlActive = state.videoControlPending & 0x0f;
    state.xdlAddressActive = state.xdlAddressPending & 0x7ffff;
    state.xdl = createXdlState();
    state.xdl.address = state.xdlAddressActive;
  }

  function nextXdlLine(state, scanline) {
    if (!state || !(state.videoControlActive & 1) || (scanline | 0) < 8 || state.xdl.ended) return null;
    const x = state.xdl;
    const read = function () { return state.vram[(x.address++) & 0x7ffff]; };
    if (x.repeat === 0) {
      const c0 = read(); const c1 = read();
      if (c0 & 1) { x.mode = "text"; x.enabled = true; }
      if (c0 & 2) { x.mode = (c1 & 0x10) ? "hires" : ((c1 & 0x20) ? "lores" : "standard"); x.enabled = true; }
      if (c0 & 4) x.enabled = false;
      if (c0 & 0x08) x.attributeMapEnabled = true;
      if (c0 & 0x10) x.attributeMapEnabled = false;
      if (c0 & 0x20) x.repeat = read();
      if (c0 & 0x40) { x.overlayAddress = read() | (read() << 8) | ((read() & 7) << 16); x.overlayStride = read() | ((read() & 15) << 8); }
      if (c0 & 0x80) { x.textScrollX = read(); x.textScrollY = read(); }
      if (c1 & 1) x.characterBase = read() << 11;
      if (c1 & 2) {
        x.attributeAddress = read() | (read() << 8) | ((read() & 7) << 16);
        // AHRM 12.4 stores stride bits 7-2 in their native byte positions;
        // bits 1-0 are zero because attribute-map rows are four-byte aligned.
        x.attributeStride = (read() & 0xfc) | ((read() & 0x0f) << 8);
      }
      if (c1 & 4) {
        // AHRM 12.4 encodes both map scroll values and cell dimensions as
        // pixel counts minus one. A zero scroll is retained only by omitting
        // this optional block (the VSync default).
        x.attributeScrollX = (read() & 0x1f) + 1;
        x.attributeScrollY = (read() & 0x1f) + 1;
        x.attributeCellWidth = (read() & 0x1f) + 1;
        x.attributeCellHeight = (read() & 0x1f) + 1;
      }
      if (c1 & 8) { const misc = read(); x.overlayPalette = (misc >> 2) & 3; x.priority = read(); }
      if (c1 & 0x80) x.ended = true;
    } else {
      // The repeat byte is the number of *additional* mode lines.  Keep its
      // full value for the line that loaded the entry, then consume one on
      // each following line (AHRM 12.4, XDL repeat count).
      x.repeat--;
    }
    const line = (x.enabled || x.attributeMapEnabled) ? {
      mode: x.mode,
      address: x.overlayAddress & 0x7ffff,
      stride: x.overlayStride & 0xfff,
      overlayPalette: x.overlayPalette,
      priority: x.priority,
      characterBase: x.characterBase & 0x7ffff,
      textScrollX: x.textScrollX & 0xff,
      textScrollY: x.textScrollY & 0xff,
      textRow: x.textRow & 7,
      attributeMapEnabled: !!x.attributeMapEnabled,
      attributeAddress: x.attributeAddress & 0x7ffff,
      attributeStride: x.attributeStride & 0xffc,
      attributeScrollX: x.attributeScrollX,
      attributeScrollY: x.attributeScrollY,
      attributeCellWidth: x.attributeCellWidth,
      attributeCellHeight: x.attributeCellHeight,
      attributeRow: x.attributeRow,
    } : null;
    if (x.enabled) {
      if (x.mode === "text") {
        x.textRow = (x.textRow + 1) & 7;
        if (x.textRow === 0) x.overlayAddress = (x.overlayAddress + x.overlayStride) & 0x7ffff;
      } else {
        x.overlayAddress = (x.overlayAddress + x.overlayStride) & 0x7ffff;
      }
    }
    if (x.attributeMapEnabled) x.attributeRow++;
    return line;
  }

  function collisionBitsForPriority(priority) {
    const layers = priority & 0xffff;
    let result = 0;
    if (layers & (PRIO_PM0 | PRIO_M10_PM0)) result |= 0x01;
    if (layers & (PRIO_PM1 | PRIO_M10_PM1)) result |= 0x02;
    if (layers & (PRIO_PM2 | PRIO_M10_PM2)) result |= 0x04;
    if (layers & (PRIO_PM3 | PRIO_M10_PM3)) result |= 0x08;
    if (layers & PRIO_PF0) result |= 0x10;
    if (layers & PRIO_PF1) result |= 0x20;
    if (layers & (PRIO_PF2 | PRIO_PF3)) result |= 0x40;
    return result;
  }

  function overlayCollisionEnabled(state, color) {
    return (state.collisionMask & (1 << ((color & 0xff) >>> 5))) !== 0;
  }

  function attributeMapCell(state, line, standardX) {
    if (!line || !line.attributeMapEnabled) return null;
    const width = line.attributeCellWidth | 0;
    const height = line.attributeCellHeight | 0;
    if (width < 8 || width > 32 || height < 1 || height > 32) return null;
    const x = (standardX | 0) + (line.attributeScrollX | 0);
    const y = (line.attributeRow | 0) + (line.attributeScrollY | 0);
    const column = Math.floor(x / width);
    // AHRM 12.4 limits the buffered line to 43 four-byte cells.
    if (column < 0 || column >= 43) return null;
    const row = Math.floor(y / height);
    const address = (line.attributeAddress + row * line.attributeStride + (column << 2)) & 0x7ffff;
    const playfield0 = state.vram[address] & 0xff;
    const playfield1 = state.vram[(address + 1) & 0x7ffff] & 0xff;
    const playfield2 = state.vram[(address + 2) & 0x7ffff] & 0xff;
    const control = state.vram[(address + 3) & 0x7ffff] & 0xff;
    return { control: control, playfield0: playfield0, playfield1: playfield1,
      playfield2: playfield2, reverse: (control & 0x04) !== 0,
      playfieldPalette: (control >>> 6) & 0x03,
      overlayPalette: (control >>> 4) & 0x03,
      priority: state.priority[control & 0x03] & 0xff };
  }

  // AHRM 12.4 calls out the PF3 bitmap separately from the map cell itself:
  // the mask begins at the left edge of each scrolled cell and is sampled at
  // 1, 2, or 4 standard-resolution pixels per bit according to cell width.
  function attributeMapPf3MaskBit(line, standardX, mask) {
    const width = line.attributeCellWidth | 0;
    if (width < 8 || width > 32) return false;
    const x = (standardX | 0) + (line.attributeScrollX | 0);
    const cellX = ((x % width) + width) % width;
    const bitPixelWidth = width <= 8 ? 1 : (width <= 16 ? 2 : 4);
    const bit = 7 - Math.floor(cellX / bitPixelWidth);
    return (mask & (1 << bit)) !== 0;
  }

  function isAnticHiresSource(line) {
    // AHRM 4.2 identifies modes 2, 3, and F as ANTIC hires modes. Reverse
    // groups their decoded bit stream into PF0-PF3 pairs.
    const mode = line.anticMode & 0x0f;
    return mode === 0x02 || mode === 0x03 || mode === 0x0f;
  }

  function isAnticModeF(line) {
    // The separate PF3-mask behavior is specific to Graphics 8 / mode F.
    return (line.anticMode & 0x0f) === 0x0f;
  }

  function hasGtiaSpecialMode(line) {
    return !!line && (line.anticGtiaMode & 0x03) !== 0;
  }

  function isGtiaReverseBlackMode(line) {
    const mode = line ? line.anticGtiaMode & 0x03 : 0;
    // FX 1.26 makes the validated reversed-hires combinations in every GTIA
    // special mode opaque palette color 0. The rule is intentionally limited
    // to valid raw hires pairs; other source-mode combinations remain open.
    return mode !== 0;
  }

  function isGtiaMode10(line) {
    return !!line && (line.anticGtiaMode & 0x03) === 2;
  }

  function isGtiaMode9Or11(line) {
    const mode = line ? line.anticGtiaMode & 0x03 : 0;
    return mode === 1 || mode === 3;
  }

  function reverseHiresColor(line, map, sourceBits, pixel) {
    if (!sourceBits) return -1;
    const pair = pixel & ~1;
    const left = sourceBits[pair];
    const right = sourceBits[pair + 1];
    // $ff marks a position outside mode-F's fetched ANTIC data. Do not let
    // border/special-mode pixels acquire a fabricated playfield color.
    if (left > 1 || right > 1) return -1;
    switch ((left << 1) | right) {
      case 0: return map.playfield0;
      case 1: return map.playfield1;
      case 2: return map.playfield2;
      default: return line.anticPf3 & 0xff;
    }
  }

  function isAnticLoresMode(line) {
    const mode = line.anticMode & 0x0f;
    // AHRM defines modes 4-E as lores. Two-bit sources retain their value;
    // modes 6/7 derive that value from the glyph bit and its PF0-PF3 character
    // color selector. ANTIC holds a lower-resolution source value across its
    // emitted pixels; each emitted copy is reinterpreted as the hires pair.
    return mode >= 0x04 && mode <= 0x0e;
  }

  function isAnticLoresCharacterMode(line) {
    const mode = line.anticMode & 0x0f;
    return mode === 0x04 || mode === 0x05;
  }

  function isAnticLoresSelectorCharacterMode(line) {
    const mode = line.anticMode & 0x0f;
    return mode === 0x06 || mode === 0x07;
  }

  function reverseLoresColor(map, sourceValues, pixel) {
    if (!sourceValues) return -1;
    const source = sourceValues[pixel];
    if (source > 3) return -1;
    // Rev changes a two-bit lores value into two hires samples. Its high and
    // low bits select the PF1 luminance over a PF2 base respectively; they
    // are not remapped to PF1/PF2 colors. This follows AHRM's lores-to-hires
    // rule and preserves the original two-pixel phase.
    const highBit = (source >>> 1) & 1;
    const lowBit = source & 1;
    const bit = (pixel & 1) === 0 ? highBit : lowBit;
    return bit
      ? ((map.playfield2 & 0xf0) | (map.playfield1 & 0x0f))
      : map.playfield2;
  }

  function reverseLoresMode10Color(map, sourceValues, pixel) {
    if (!sourceValues) return -1;
    // In the externally validated FX 1.26 mode-4 case, GTIA mode 10 consumes
    // two adjacent two-bit lores values as one raw nibble. Of the measured
    // values, only nibble 1 selects the attribute cell's PF0; 2, 3, and $B
    // produce palette color 0. Keep this deliberately narrow until the other
    // lores modes and raw-nibble values have their own evidence.
    const group = pixel & ~3;
    const high = sourceValues[group];
    const low = sourceValues[group + 2];
    if (high > 3 || low > 3) return -1;
    return ((high << 2) | low) === 1 ? map.playfield0 : 0;
  }

  function hasReverseLoresSource(sourceValues, pixel) {
    return !!sourceValues && sourceValues[pixel] <= 3;
  }

  function compositeOverlayPixel(state, video, target, targetPixel, priorityPixel, color, sourceByte, overlayPalette, priorityMask, attribute) {
    if (attribute && (attribute.control & 0x08)) state.collisionDetect |= 0x80;
    if (attribute) {
      overlayPalette = attribute.overlayPalette;
      priorityMask = attribute.priority;
    }
    const p = ((((overlayPalette === undefined ? 1 : overlayPalette) * 256) + color) * 3) | 0;
    const rgb = ((255 << 24) | (state.palette[p + 2] << 16) |
      (state.palette[p + 1] << 8) | state.palette[p]) >>> 0;
    const atariPriority = video.priority ? video.priority[priorityPixel] : 0;
    const storedContributors = video.vbxeCollisionPriority
      ? video.vbxeCollisionPriority[priorityPixel] & 0xffff
      : 0;
    const visiblePriority = (storedContributors & VBXE_CONTRIBUTOR_VALID) !== 0
      ? storedContributors & ~VBXE_CONTRIBUTOR_VALID
      : atariPriority;
    if (sourceByte !== null && overlayCollisionEnabled(state, sourceByte)) {
      // AHRM 12.4: COLMASK selects source-byte ranges and collision
      // detection is independent of whether the overlay wins its priority
      // comparison. Attribute-map and text collision handling belongs with
      // their renderers and is intentionally not synthesized here.
      state.collisionDetect |= collisionBitsForPriority(visiblePriority);
    }
    // AHRM 12.4 defines both collision and overlay priority against the
    // color inputs that survive GTIA PRIOR processing. The raw priority plane
    // retains hidden P/M layers for normal GTIA collision handling, while this
    // optional plane removes them for VBXE.
    const wins = visiblePriority === 0
      ? (priorityMask & 0x80)
      : ((visiblePriority & 0x01) && (priorityMask & 0x10)) ||
        ((visiblePriority & 0x02) && (priorityMask & 0x20)) ||
        ((visiblePriority & 0x0c) && (priorityMask & 0x40)) ||
        ((visiblePriority & 0x10) && (priorityMask & 0x01)) ||
        ((visiblePriority & 0x20) && (priorityMask & 0x02)) ||
        ((visiblePriority & 0x40) && (priorityMask & 0x04)) ||
        ((visiblePriority & 0x80) && (priorityMask & 0x08));
    if (wins) target[targetPixel] = rgb;
  }

  function hiresTarget(video, scanline) {
    const width = video.vbxeHiresWidth | 0;
    const line = (scanline | 0) - 8;
    if (!video.vbxeHiresRgb || width < 640 || line < 0) return null;
    const base = line * width;
    return base + width <= video.vbxeHiresRgb.length
      ? { pixels: video.vbxeHiresRgb, width: width, base: base + ((width - 640) >> 1), rowBase: base }
      : null;
  }

  function renderTextXdlLine(state, video, scanline, line) {
    const atariBase = (scanline | 0) * 456 + 128;
    const target = hiresTarget(video, scanline);
    const pixels = target ? target.pixels : video.vbxeRgb;
    const base = target ? target.base : atariBase;
    const outputPixels = target ? 640 : 256;
    if (target) pixels.fill(0, target.rowBase, target.rowBase + target.width);
    else pixels.fill(0, base, base + 256);
    const priorityMask = line.priority === undefined ? 0xff : line.priority;
    const transparency = (state.videoControlActive >> 2) & 0x03;
    for (let x = 0; x < outputPixels; x++) {
      const sourceX = (target ? x : Math.floor(x * 640 / 256)) + (line.textScrollX || 0);
      const sourceRow = (line.textRow & 7) + (line.textScrollY || 0);
      const cell = sourceX >> 3;
      const rowAddress = (line.address + Math.floor(sourceRow / 8) * (line.stride || 0)) & 0x7ffff;
      const cellAddress = (rowAddress + (cell << 1)) & 0x7ffff;
      const character = state.vram[cellAddress] & 0xff;
      const attribute = state.vram[(cellAddress + 1) & 0x7ffff] & 0xff;
      const glyph = state.vram[((line.characterBase || 0) + (character << 3) + (sourceRow & 7)) & 0x7ffff];
      const foreground = attribute & 0x7f;
      const glyphSet = (glyph & (0x80 >>> (sourceX & 7))) !== 0;
      if (!glyphSet && !(attribute & 0x80) && transparency >= 1) continue;
      const color = glyphSet ? foreground : ((attribute & 0x80) ? foreground | 0x80 : 0x80);
      if (color === 0 && transparency >= 1) continue;
      const priorityPixel = atariBase + (target ? Math.floor(x * 256 / 640) : x);
      const map = attributeMapCell(state, line, target ? (x >> 1) : Math.floor(x * 320 / 256));
      compositeOverlayPixel(state, video, pixels, base + x, priorityPixel, color, null, line.overlayPalette, priorityMask, map);
    }
  }

  function renderXdlLine(state, video, scanline, line) {
    if (!line || !video || !video.vbxeRgb) return;
    if (line.mode === "text") {
      renderTextXdlLine(state, video, scanline, line);
      return;
    }
    if (line.mode !== "standard" && line.mode !== "lores" && line.mode !== "hires") {
      // Attribute-map-only XDL entries have no overlay renderer to clear the
      // RGB plane.  Leaving its prior line contents in place both hides the
      // current map output and makes stale pixels survive across frames.
      const atariBase = (scanline | 0) * 456 + 128;
      video.vbxeRgb.fill(0, atariBase, atariBase + 256);
      const target = hiresTarget(video, scanline);
      if (target) target.pixels.fill(0, target.rowBase, target.rowBase + target.width);
      return;
    }
    const atariBase = (scanline | 0) * 456 + 128;
    const hires = line.mode === "hires";
    const target = hires ? hiresTarget(video, scanline) : null;
    const pixels = target ? target.pixels : video.vbxeRgb;
    const base = target ? target.base : atariBase;
    const outputPixels = target ? 640 : 256;
    if (target) pixels.fill(0, target.rowBase, target.rowBase + target.width);
    else pixels.fill(0, base, base + 256);
    const pixelCount = hires ? 640 : (line.mode === "lores" ? 160 : 320);
    const priorityMask = line.priority === undefined ? 0xff : line.priority;
    for (let x = 0; x < outputPixels; x++) {
      const sourceX = target ? x : Math.floor(x * pixelCount / 256);
      // AHRM 12.4: hires graphics store two 4-bit pixels per byte, most
      // significant nibble first. COLMASK still selects the complete source
      // byte range rather than the unpacked nibble.
      const sourceByte = state.vram[(line.address + (hires ? (sourceX >> 1) : sourceX)) & 0x7ffff] & 0xff;
      const color = hires
        ? ((sourceX & 1) !== 0 ? sourceByte & 0x0f : sourceByte >>> 4)
        : sourceByte;
      const transparency = (state.videoControlActive >> 2) & 0x03;
      const transparent = (color === 0 && transparency >= 1) ||
        (transparency === 3 && (hires ? color === 0x0f : (color & 0x0f) === 0x0f));
      if (transparent) continue;
      const priorityPixel = atariBase + (target ? Math.floor(x * 256 / 640) : x);
      const map = attributeMapCell(state, line,
        target ? (x >> 1) : Math.floor(x * 320 / 256));
      compositeOverlayPixel(state, video, pixels, base + x, priorityPixel, color, sourceByte, line.overlayPalette, priorityMask, map);
    }
  }

  function applyPlayfieldAttributes(state, video, scanline, line) {
    if (!line || !line.attributeMapEnabled || !video || !video.vbxeRgb) return;
    const atariBase = (scanline | 0) * 456 + 128;
    if (atariBase < 0 || atariBase + 256 > video.vbxeRgb.length) return;
    const extendedColor = (state.videoControlActive & 0x02) !== 0;

    // ANTIC normal-width playfields occupy 320 physical hires samples from
    // x=96 through x=415 (AHRM 6.2). Attribute maps are specified in VBXE
    // standard pixels, so drawing only through the old 256-sample viewport
    // silently shrinks their signal. Mirror the final map color into the
    // 640-sample presentation plane, two samples per ANTIC source pixel.
    const nativeTarget = hiresTarget(video, scanline);
    const nativeAtariBase = (scanline | 0) * 456 + 96;
    if (nativeTarget && nativeAtariBase >= 0 &&
        nativeAtariBase + 320 <= video.priority.length) {
      // Direct state callers do not have renderXdlLine's off-overlay clear.
      if (!line.mode || line.mode === "off") {
        nativeTarget.pixels.fill(0, nativeTarget.rowBase,
          nativeTarget.rowBase + nativeTarget.width);
      }
      for (let standardX = 0; standardX < 320; standardX++) {
        const sourcePixel = nativeAtariBase + standardX;
        const targetPixel = nativeTarget.base + standardX * 2;
        // A legacy standard/lores overlay is still stored in vbxeRgb. Do not
        // let a playfield override appear above it while that renderer path is
        // migrated to the native plane.
        const legacyOverlay = video.vbxeRgb[
          atariBase + Math.floor(standardX * 256 / 320)
        ];
        if (nativeTarget.pixels[targetPixel] !== 0 || legacyOverlay !== 0) continue;
        const visible = video.vbxeCollisionPriority &&
            (video.vbxeCollisionPriority[sourcePixel] & VBXE_CONTRIBUTOR_VALID) !== 0
          ? video.vbxeCollisionPriority[sourcePixel] & ~VBXE_CONTRIBUTOR_VALID
          : (video.priority ? video.priority[sourcePixel] : 0);
        const map = attributeMapCell(state, line, standardX);
        if (!map) continue;
        let color = -1;
        if (map.reverse && isGtiaReverseBlackMode(line) && isAnticHiresSource(line) &&
            reverseHiresColor(line, map, video.anticSourceBits, sourcePixel) >= 0) {
          // The raw GTIA mode-9/11 fields are visible without VBXE, but FX
          // 1.26 composes these validated reversed cells as opaque palette 0.
          color = 0;
        } else if (map.reverse && isGtiaMode10(line) && isAnticLoresCharacterMode(line)) {
          color = reverseLoresMode10Color(map, video.anticSourceLores, sourcePixel);
        } else if (map.reverse && isGtiaMode10(line) && isAnticLoresSelectorCharacterMode(line) &&
            hasReverseLoresSource(video.anticSourceLores, sourcePixel)) {
          color = 0;
        } else if (map.reverse && isGtiaMode9Or11(line) && isAnticLoresCharacterMode(line) &&
            hasReverseLoresSource(video.anticSourceLores, sourcePixel)) {
          color = 0;
        } else if (map.reverse && !hasGtiaSpecialMode(line) && isAnticHiresSource(line)) {
          color = reverseHiresColor(line, map, video.anticSourceBits, sourcePixel);
        } else if (map.reverse && !hasGtiaSpecialMode(line) && isAnticLoresMode(line)) {
          color = reverseLoresColor(map, video.anticSourceLores, sourcePixel);
        } else if (!map.reverse && isAnticModeF(line) &&
            (visible & PRIO_PF2) &&
            attributeMapPf3MaskBit(line, standardX, map.playfield0)) {
          color = line.anticPf3 & 0xff;
        } else if (visible & PRIO_PF0) color = map.playfield0;
        else if (visible & PRIO_PF1) color = map.playfield1;
        else if (visible & PRIO_PF2) color = map.playfield2;
        if (color === undefined || color === null || color < 0) continue;
        color = extendedColor ? color & 0xff : color & 0xfe;
        const p = ((map.playfieldPalette * 256 + color) * 3) | 0;
        const rgb = ((255 << 24) | (state.palette[p + 2] << 16) |
          (state.palette[p + 1] << 8) | state.palette[p]) >>> 0;
        nativeTarget.pixels[targetPixel] = rgb;
        nativeTarget.pixels[targetPixel + 1] = rgb;
      }
    }

    for (let x = 0; x < 256; x++) {
      const pixel = atariBase + x;
      // A visible overlay already has its final RGB value in this plane and
      // must remain above the playfield override.
      if (video.vbxeRgb[pixel] !== 0) continue;
      const visible = video.vbxeCollisionPriority &&
          (video.vbxeCollisionPriority[pixel] & VBXE_CONTRIBUTOR_VALID) !== 0
        ? video.vbxeCollisionPriority[pixel] & ~VBXE_CONTRIBUTOR_VALID
        : (video.priority ? video.priority[pixel] : 0);
      const standardX = Math.floor(x * 320 / 256);
      const map = attributeMapCell(state, line, standardX);
      if (!map) continue;
      let color = -1;
      if (map.reverse && isGtiaReverseBlackMode(line) && isAnticHiresSource(line) &&
          reverseHiresColor(line, map, video.anticSourceBits, pixel) >= 0) {
        color = 0;
      } else if (map.reverse && isGtiaMode10(line) && isAnticLoresCharacterMode(line)) {
        color = reverseLoresMode10Color(map, video.anticSourceLores, pixel);
      } else if (map.reverse && isGtiaMode10(line) && isAnticLoresSelectorCharacterMode(line) &&
          hasReverseLoresSource(video.anticSourceLores, pixel)) {
        color = 0;
      } else if (map.reverse && isGtiaMode9Or11(line) && isAnticLoresCharacterMode(line) &&
          hasReverseLoresSource(video.anticSourceLores, pixel)) {
        color = 0;
      } else if (map.reverse && !hasGtiaSpecialMode(line) && isAnticHiresSource(line)) {
        color = reverseHiresColor(line, map, video.anticSourceBits, pixel);
      } else if (map.reverse && !hasGtiaSpecialMode(line) && isAnticLoresMode(line)) {
        color = reverseLoresColor(map, video.anticSourceLores, pixel);
      } else if (!map.reverse && isAnticModeF(line) &&
          (visible & PRIO_PF2) &&
          attributeMapPf3MaskBit(line, standardX, map.playfield0)) {
        color = line.anticPf3 & 0xff;
      } else if (visible & PRIO_PF0) color = map.playfield0;
      else if (visible & PRIO_PF1) color = map.playfield1;
      else if (visible & PRIO_PF2) color = map.playfield2;
      if (color === undefined || color === null || color < 0) continue;
      color = extendedColor ? color & 0xff : color & 0xfe;
      const p = ((map.playfieldPalette * 256 + color) * 3) | 0;
      video.vbxeRgb[pixel] = ((255 << 24) | (state.palette[p + 2] << 16) |
        (state.palette[p + 1] << 8) | state.palette[p]) >>> 0;
    }
  }

  function isAddress(state, address) {
    if (!state || !state.enabled) return false;
    const a = address & 0xffff;
    return a >= state.page && a < state.page + REGISTER_COUNT;
  }

  // Returns a local VRAM address for a CPU or ANTIC MEMAC request, or -1
  // when this device does not claim the Atari address. Hardware/ROM and
  // expansion-window precedence is intentionally decided by the bus mapper.
  function memacAddress(state, address, isAntic) {
    if (!state || !state.enabled) return -1;
    const addr = address & 0xffff;
    const accessBit = isAntic ? 0x04 : 0x08;
    const aSize = 0x1000 << (state.memacControl & 0x03);
    const aBase = (state.memacControl & 0xf0) << 8;
    if (
      (state.memacBankSelect & 0x80) !== 0 &&
      (state.memacControl & accessBit) !== 0 &&
      addr >= aBase && addr - aBase < aSize
    ) {
      const vramBase = ((state.memacBankSelect & 0x7f) << 12) & ~(aSize - 1);
      return (vramBase + addr - aBase) & 0x7ffff;
    }
    if (
      addr >= 0x4000 && addr < 0x8000 &&
      (state.memacBControl & (isAntic ? 0x80 : 0x40)) !== 0
    ) {
      return (((state.memacBControl & 0x1f) << 14) + addr - 0x4000) & 0x7ffff;
    }
    return -1;
  }

  function paletteOffset(state) {
    return (((state.paletteSelect & 0x03) * PALETTE_ENTRIES +
      (state.colorSelect & 0xff)) * PALETTE_COMPONENTS) | 0;
  }

  function access(state, address, value) {
    if (!isAddress(state, address)) return null;
    const reg = (address - state.page) & 0x1f;
    if (value === undefined || value === null) {
      switch (reg) {
        case 0x00: return 0x11; // FX core 1, full functionality.
        case 0x01: return 0x26; // FX 1.26, no RAMBO shared-memory flag.
        case 0x0a: return state.collisionDetect & 0xff;
        case 0x10: return state.blitCollisionCode & 0xff;
        case 0x13: return state.blitterBusy & 0x03;
        case 0x14: return state.irqStatus & 0x01;
        case 0x1e: return state.memacControl & 0xff;
        case 0x1f: return state.memacBankSelect & 0xff;
        default: return 0xff;
      }
    }

    const v = value & 0xff;
    switch (reg) {
      case 0x00:
        state.videoControlPending = v & 0x0f;
        break;
      case 0x01:
        state.xdlAddressPending = (state.xdlAddressPending & 0x7ff00) | v;
        break;
      case 0x02:
        state.xdlAddressPending = (state.xdlAddressPending & 0x700ff) | (v << 8);
        break;
      case 0x03:
        state.xdlAddressPending = (state.xdlAddressPending & 0x0ffff) | ((v & 0x07) << 16);
        break;
      case 0x04:
        state.colorSelect = v;
        break;
      case 0x05:
        state.paletteSelect = v & 0x03;
        break;
      case 0x06:
      case 0x07:
      case 0x08: {
        const component = reg - 0x06;
        state.palette[paletteOffset(state) + component] = v & 0xfe;
        if (reg === 0x08) state.colorSelect = (state.colorSelect + 1) & 0xff;
        break;
      }
      case 0x09:
        state.collisionMask = v;
        break;
      case 0x0a:
        state.collisionDetect = 0;
        break;
      case 0x10:
      case 0x11:
      case 0x12:
        state.blitAddress = (state.blitAddress & ~(0xff << ((reg - 0x10) * 8))) |
          ((reg === 0x12 ? v & 0x07 : v) << ((reg - 0x10) * 8));
        state.blitAddress &= 0x7ffff;
        break;
      case 0x13:
        // The blitter data path arrives in a later milestone. Preserve the
        // defined stopped state until that state machine exists.
        if ((v & 0x01) === 0) state.blitterBusy = 0;
        break;
      case 0x14:
        state.irqControl = v & 0x01;
        state.irqStatus = 0;
        break;
      case 0x15:
      case 0x16:
      case 0x17:
      case 0x18:
        state.priority[reg - 0x15] = v;
        break;
      case 0x1d:
        state.memacBControl = v;
        break;
      case 0x1e:
        state.memacControl = v;
        break;
      case 0x1f:
        state.memacBankSelect = v;
        break;
      default:
        break;
    }
    return 0xff;
  }

  function cloneState(state) {
    if (!state) return null;
    return {
      enabled: !!state.enabled,
      profile: state.profile === "fx1.26" ? "fx1.26" : "off",
      page: state.page === 0xd740 ? 0xd740 : DEFAULT_PAGE,
      vram: new Uint8Array(state.vram || 0),
      palette: new Uint8Array(state.palette || 0),
      videoControlPending: state.videoControlPending & 0xff,
      videoControlActive: state.videoControlActive & 0xff,
      xdlAddressPending: state.xdlAddressPending & 0x7ffff,
      xdlAddressActive: state.xdlAddressActive & 0x7ffff,
      colorSelect: state.colorSelect & 0xff,
      paletteSelect: state.paletteSelect & 0x03,
      collisionMask: state.collisionMask & 0xff,
      collisionDetect: state.collisionDetect & 0xff,
      blitAddress: state.blitAddress & 0x7ffff,
      blitCollisionCode: state.blitCollisionCode & 0xff,
      blitterBusy: state.blitterBusy & 0x03,
      irqStatus: state.irqStatus & 0x01,
      irqControl: state.irqControl & 0x01,
      priority: new Uint8Array(state.priority || 0),
      memacBControl: state.memacBControl & 0xff,
      memacControl: state.memacControl & 0xff,
      memacBankSelect: state.memacBankSelect & 0xff,
      xdl: Object.assign({}, state.xdl),
    };
  }

  function restoreState(snapshot, fallbackConfig) {
    const source = snapshot && typeof snapshot === "object" ? snapshot : null;
    const state = createState(source || fallbackConfig);
    if (!source) return state;
    const copy = function (target, input) {
      if (input) target.set(new Uint8Array(input).subarray(0, target.length));
    };
    state.enabled = !!source.enabled;
    state.profile = source.profile === "fx1.26" ? "fx1.26" : "off";
    state.page = source.page === 0xd740 ? 0xd740 : DEFAULT_PAGE;
    copy(state.vram, source.vram);
    copy(state.palette, source.palette);
    copy(state.priority, source.priority);
    ["videoControlPending", "videoControlActive", "colorSelect", "collisionMask",
      "collisionDetect", "blitCollisionCode", "blitterBusy", "irqStatus", "irqControl",
      "memacBControl", "memacControl", "memacBankSelect"].forEach(function (key) {
      if (source[key] !== undefined) state[key] = source[key] & 0xff;
    });
    state.xdlAddressPending = source.xdlAddressPending & 0x7ffff;
    state.xdlAddressActive = source.xdlAddressActive & 0x7ffff;
    state.blitAddress = source.blitAddress & 0x7ffff;
    state.paletteSelect = source.paletteSelect & 0x03;
    if (source.xdl) state.xdl = Object.assign(createXdlState(), source.xdl);
    return state;
  }

  window.A8EVbxe = {
    VRAM_SIZE: VRAM_SIZE,
    normalizeConfig: normalizeConfig,
    createState: createState,
    softReset: softReset,
    powerCycle: powerCycle,
    verticalSync: verticalSync,
    nextXdlLine: nextXdlLine,
    renderXdlLine: renderXdlLine,
    applyPlayfieldAttributes: applyPlayfieldAttributes,
    attributeMapCell: attributeMapCell,
    collisionBitsForPriority: collisionBitsForPriority,
    isAddress: isAddress,
    memacAddress: memacAddress,
    access: access,
    cloneState: cloneState,
    restoreState: restoreState,
  };
})();
