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

  function normalizeProfile(value) {
    const profile = String(value === undefined || value === null ? "" : value)
      .trim().toLowerCase();
    if (profile === "fx1.20" || profile === "fx120") return "fx1.20";
    if (profile === "fx1.24" || profile === "fx124") return "fx1.24";
    if (profile === "fx1.26" || profile === "fx126") return "fx1.26";
    return "off";
  }

  function createXdlState() {
    return { address: 0, overlayAddress: 0, overlayStride: 0, mode: "off",
      enabled: false, repeat: 0, ended: false, overlayWidth: 1,
      playfieldPalette: 0, overlayPalette: 1, priority: 0xff,
      textScrollX: 0, textScrollY: 0, characterBase: 0, textRow: 0,
      attributeMapEnabled: false, attributeAddress: 0, attributeStride: 0,
      attributeScrollX: 0, attributeScrollY: 0, attributeCellWidth: 8,
      attributeCellHeight: 8, attributeRow: 0 };
  }

  function normalizeConfig(value) {
    const source = value && typeof value === "object" ? value : {};
    const rawProfile =
      typeof value === "string" ? value : (source.profile || "off");
    const requestedProfile = normalizeProfile(rawProfile);
    // Keep the original boolean-only configuration compatible by treating it
    // as the current FX 1.26 profile.
    const enabled = source.enabled === false ? false :
      requestedProfile !== "off" || source.enabled === true;
    const page = (source.page | 0) === 0xd740 ? 0xd740 : DEFAULT_PAGE;
    return {
      enabled: enabled,
      profile: enabled ? (requestedProfile !== "off" ? requestedProfile : "fx1.26") : "off",
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
      blitter: null,
      irqStatus: 0,
      irqControl: 0,
      blitterIrqPending: false,
      blitterIrqScheduled: false,
      blitterIrqResidual: 0,
      memacSlots: 0,
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
    // Altirra WarmReset disables current XDL execution but retains the
    // programmed start-address latch and COLDETECT until their own strobes.
    state.xdl = createXdlState();
    state.blitCollisionCode = 0;
    state.blitterBusy = 0;
    state.blitter = null;
    state.irqStatus = 0;
    state.irqControl = 0;
    state.blitterIrqPending = false;
    state.blitterIrqScheduled = false;
    state.blitterIrqResidual = 0;
    state.memacSlots = 0;
    state.memacBControl &= 0x3f;
    state.memacControl &= 0xf3;
    state.memacBankSelect &= 0x7f;
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
    state.collisionDetect = 0;
    state.blitAddress = 0;
    state.blitCollisionCode = 0;
    state.priority.fill(0);
    state.memacBControl = 0;
    state.memacControl = 0;
    state.memacBankSelect = 0;
    state.xdlAddressPending = 0;
    state.xdlAddressActive = 0;
  }

  function verticalSync(state) {
    if (!state || !state.enabled) return;
    state.videoControlActive = state.videoControlPending & 0x0f;
    state.xdlAddressActive = state.xdlAddressPending & 0x7ffff;
    state.xdl = createXdlState();
    state.xdl.address = state.xdlAddressActive;
  }

  function signed(value, bits) {
    const sign = 1 << (bits - 1);
    return (value & sign) !== 0 ? value - (sign << 1) : value;
  }

  function readBlitBlock(state, address) {
    const block = new Uint8Array(21);
    for (let i = 0; i < block.length; i++) block[i] = state.vram[(address + i) & 0x7ffff];
    return block;
  }

  function loadBlitterBlock(state) {
    const blockAddress = state.blitter && state.blitter.blockAddress !== undefined
      ? state.blitter.blockAddress & 0x7ffff : state.blitAddress & 0x7ffff;
    const block = readBlitBlock(state, blockAddress);
    state.blitter = {
      blockAddress: blockAddress,
      source: (block[0] | (block[1] << 8) | (block[2] << 16)) & 0x7ffff,
      sourceYStep: signed(block[3] | ((block[4] & 0x1f) << 8), 13),
      sourceXStep: signed(block[5], 8),
      destination: (block[6] | (block[7] << 8) | (block[8] << 16)) & 0x7ffff,
      destinationYStep: signed(block[9] | ((block[10] & 0x1f) << 8), 13),
      destinationXStep: signed(block[11], 8),
      width: 1 + block[12] + ((block[13] & 0x01) << 8),
      height: 1 + block[14],
      dataAnd: block[15], dataXor: block[16], collisionMask: block[17],
      zoomX: 1 + (block[18] & 0x07), zoomY: 1 + ((block[18] >>> 4) & 0x07),
      patternEnabled: (block[19] & 0x80) !== 0, patternWidth: 1 + (block[19] & 0x3f),
      mode: block[20] & 0x07, next: (block[20] & 0x08) !== 0,
      x: 0, y: 0, repeatX: 0, repeatY: 0,
    };
    state.blitterBusy = 0x02;
  }

  function byteCollisionEnabled(mask, value) {
    return value !== 0 && (mask & (1 << ((value - 1) >>> 5))) !== 0;
  }

  function nibbleCollisionEnabled(mask, value) {
    return value !== 0 && (mask & (1 << (value === 1 ? 0 : value >>> 1))) !== 0;
  }

  function recordByteBlitCollision(state, work, source, destination) {
    if (state.blitCollisionCode === 0 && source !== 0 &&
        byteCollisionEnabled(work.collisionMask, destination)) state.blitCollisionCode = destination & 0xff;
  }

  function recordNibbleBlitCollision(state, work, source, destination, high) {
    const sourceNibble = high ? source >>> 4 : source & 0x0f;
    const destinationNibble = high ? destination >>> 4 : destination & 0x0f;
    if (state.blitCollisionCode === 0 && sourceNibble !== 0 &&
        nibbleCollisionEnabled(work.collisionMask, destinationNibble))
      state.blitCollisionCode = high ? destination & 0xf0 : destination & 0x0f;
  }

  function applyBlitOperation(state, work, source, destination) {
    switch (work.mode) {
      case 0: return source;
      case 1:
        if (source === 0) return destination;
        recordByteBlitCollision(state, work, source, destination);
        return source;
      case 2:
        recordByteBlitCollision(state, work, source, destination);
        return (destination + source) & 0xff;
      case 3:
        recordByteBlitCollision(state, work, source, destination);
        return destination | source;
      case 4:
        recordByteBlitCollision(state, work, source, destination);
        return destination & source;
      case 5:
        recordByteBlitCollision(state, work, source, destination);
        return destination ^ source;
      case 6:
        recordNibbleBlitCollision(state, work, source, destination, true);
        recordNibbleBlitCollision(state, work, source, destination, false);
        return (source & 0xf0 ? source & 0xf0 : destination & 0xf0) |
          (source & 0x0f ? source & 0x0f : destination & 0x0f);
      default: return destination;
    }
  }

  function finishBlitterBlock(state, deferIrq) {
    const work = state.blitter;
    if (work.next) {
      // Altirra loads every linked BCB as a new blit.  The collision result
      // belongs to that one block and is cleared before the following block
      // begins, not merely when BLITTER_START is written.
      state.blitCollisionCode = 0;
      state.blitter = {
        blockAddress: (work.blockAddress + 21) & 0x7ffff,
        loadCyclesRemaining: 21,
      };
      state.blitterBusy = 0x01;
      return;
    }
    state.blitter = null;
    state.blitterBusy = 0;
    if (state.irqControl & 0x01) {
      if (deferIrq) state.blitterIrqPending = true;
      else state.irqStatus = 0x01;
    }
  }

  // AHRM 12.4, table 113. This is the local-VRAM cost of one completed
  // output byte when the bus is otherwise available. Source-fetch elision is
  // a separate one-cycle saving and cannot reduce an operation below its
  // destination-side/write cost.
  function blitByteCycles(work, source, sourceFetchSkipped) {
    let cycles;
    switch (work.mode) {
      case 0: cycles = 2; break;
      case 1:
        cycles = source === 0 ? 1 : (work.collisionMask ? 3 : 2);
        break;
      case 2:
      case 3:
      case 5:
      case 6: cycles = source === 0 ? 1 : 3; break;
      case 4: cycles = source === 0 ? 2 : 3; break;
      default: cycles = 3; break;
    }
    return Math.max(1, cycles - (sourceFetchSkipped ? 1 : 0));
  }

  function advanceBlitter(state, budget, deferIrq) {
    if (!state || !state.enabled || state.blitterBusy === 0) return 0;
    let remaining = Math.max(0, budget | 0);
    let completed = 0;
    while (remaining > 0 && state.blitterBusy !== 0) {
      if (state.blitterBusy === 0x01) {
        const loading = state.blitter;
        const loadCycles = loading.loadCyclesRemaining === undefined
          ? 21 : loading.loadCyclesRemaining | 0;
        if (remaining < loadCycles) {
          loading.loadCyclesRemaining = loadCycles - remaining;
          break;
        }
        remaining -= loadCycles;
        loadBlitterBlock(state);
        continue;
      }
      const work = state.blitter;
      const sourceX = work.patternEnabled ? work.x % work.patternWidth : work.x;
      const sourceAddress = (work.source + work.y * work.sourceYStep +
        sourceX * work.sourceXStep) & 0x7ffff;
      const outputX = work.x * work.zoomX + work.repeatX;
      const outputY = work.y * work.zoomY + work.repeatY;
      const destinationAddress = (work.destination + outputY * work.destinationYStep +
        outputX * work.destinationXStep) & 0x7ffff;
      const source = ((state.vram[sourceAddress] & work.dataAnd) ^ work.dataXor) & 0xff;
      const sourceFetchSkipped = work.dataAnd === 0 || work.repeatX !== 0;
      const cycles = blitByteCycles(work, source, sourceFetchSkipped);
      if (cycles > remaining) break;
      state.vram[destinationAddress] = applyBlitOperation(
        state, work, source, state.vram[destinationAddress] & 0xff);
      completed++;
      remaining -= cycles;
      work.repeatX++;
      if (work.repeatX < work.zoomX) continue;
      work.repeatX = 0;
      work.x++;
      if (work.x < work.width) continue;
      work.x = 0;
      work.repeatY++;
      if (work.repeatY < work.zoomY) continue;
      work.repeatY = 0;
      work.y++;
      if (work.y < work.height) continue;
      finishBlitterBlock(state, deferIrq);
      if (state.blitterIrqPending) state.blitterIrqResidual = remaining;
    }
    return completed;
  }

  // The renderer supplies a whole-scanline local-bus budget, while the FX
  // completion signal is visible part way through that line.  Keep the
  // completed remainder in local cycles so the machine scheduler can expose
  // the IRQ at the corresponding CPU-cycle position.
  function scheduleBlitterIrq(state) {
    if (!state || !state.blitterIrqPending) return -1;
    const residual = state.blitterIrqResidual | 0;
    state.blitterIrqPending = false;
    state.blitterIrqScheduled = true;
    state.blitterIrqResidual = 0;
    return residual;
  }

  function raiseScheduledBlitterIrq(state) {
    if (!state || !state.blitterIrqScheduled) return false;
    state.blitterIrqScheduled = false;
    state.irqStatus = 0x01;
    return true;
  }

  function startBlitter(state) {
    if (!state || !state.enabled || state.blitterBusy !== 0) return;
    state.blitCollisionCode = 0;
    state.blitter = {
      blockAddress: state.blitAddress & 0x7ffff,
      loadCyclesRemaining: 21,
    };
    state.blitterBusy = 0x01;
  }

  function stopBlitter(state) {
    if (!state) return;
    state.blitter = null;
    state.blitterBusy = 0;
  }

  function nextXdlLine(state, scanline) {
    if (!state) return null;
    state.xdlSlots = 0;
    if (!(state.videoControlActive & 1) || (scanline | 0) < 8) return null;
    const x = state.xdl;
    // Altirra's XDL engine applies END after the entry's complete repeat run,
    // not when the terminating entry is first decoded.
    if (x.ended && x.repeat === 0) return null;
    let xdlBytes = 0;
    const read = function () {
      xdlBytes++;
      return state.vram[(x.address++) & 0x7ffff];
    };
    let attributeMapReload = false;
    if (x.repeat === 0) {
      // A new entry claims exactly the bytes it contains; repeated lines
      // reuse the latched entry without another XDL fetch.
      const c0 = read(); const c1 = read();
      if (c0 & 1) { x.mode = "text"; x.enabled = true; }
      if (c0 & 2) { x.mode = (c1 & 0x10) ? "hires" : ((c1 & 0x20) ? "lores" : "standard"); x.enabled = true; }
      if (c0 & 4) x.enabled = false;
      if (c0 & 0x10) x.attributeMapEnabled = false;
      else if (c0 & 0x08) {
        x.attributeMapEnabled = true;
        // AHRM 12.4: AtMapOn restarts the buffered map row.  The line
        // buffer must be refilled even when the prior row counter had not
        // rolled over.
        attributeMapReload = true;
      }
      if (c0 & 0x20) x.repeat = read();
      if (c0 & 0x40) { x.overlayAddress = read() | (read() << 8) | ((read() & 7) << 16); x.overlayStride = read() | ((read() & 15) << 8); }
      // XDLC_OVSCRL carries only the three pixel-offset bits used by text
      // mode.  The unused high bits read from VRAM do not survive the latch.
      if (c0 & 0x80) { x.textScrollX = read() & 7; x.textScrollY = read() & 7; }
      if (c1 & 1) x.characterBase = read() << 11;
      if (c1 & 2) {
        x.attributeAddress = read() | (read() << 8) | ((read() & 7) << 16);
        // AHRM 12.4 stores stride bits 7-2 in their native byte positions;
        // bits 1-0 are zero because attribute-map rows are four-byte aligned.
        x.attributeStride = (read() & 0xfc) | ((read() & 0x0f) << 8);
        // Readdressing also invalidates the on-chip line buffer.
        attributeMapReload = true;
      }
      if (c1 & 4) {
        // Altirra latches the two scroll counters verbatim and expands only
        // the two cell-size fields. The counters are five-bit delta counters;
        // values beyond a cell dimension deliberately overscroll through the
        // 32-position wrap, rather than being conventional pixel offsets.
        x.attributeScrollX = read() & 0x1f;
        x.attributeScrollY = read() & 0x1f;
        x.attributeCellWidth = (read() & 0x1f) + 1;
        x.attributeCellHeight = (read() & 0x1f) + 1;
      }
      if (c1 & 8) {
        const misc = read();
        // Altirra's XDLC_ATT decode: bits 7-6 select the ANTIC playfield
        // palette, bits 5-4 select the overlay palette, and width %11 is
        // the narrow-width alias.  Preserve all three latches even when the
        // current renderer does not yet consume every geometry variant.
        x.overlayWidth = (misc & 0x03) === 0x03 ? 0 : misc & 0x03;
        x.playfieldPalette = misc >>> 6;
        x.overlayPalette = (misc >>> 4) & 0x03;
        x.priority = read();
      }
      if (c1 & 0x80) x.ended = true;
      if (attributeMapReload) x.attributeRow = x.attributeScrollY;
      state.xdlSlots = xdlBytes;
    } else {
      // The repeat byte is the number of *additional* mode lines.  Keep its
      // full value for the line that loaded the entry, then consume one on
      // each following line (AHRM 12.4, XDL repeat count).
      x.repeat--;
    }
    const line = (x.enabled || x.attributeMapEnabled) ? {
      mode: x.mode, overlayEnabled: !!x.enabled,
      address: x.overlayAddress & 0x7ffff,
      stride: x.overlayStride & 0xfff,
      overlayWidth: x.overlayWidth,
      playfieldPalette: x.playfieldPalette,
      overlayPalette: x.overlayPalette,
      priority: x.priority,
      characterBase: x.characterBase & 0x7ffff,
      textScrollX: x.textScrollX & 7,
      textScrollY: x.textScrollY & 7,
      textRow: x.textRow & 7,
      attributeMapEnabled: !!x.attributeMapEnabled,
      attributeAddress: x.attributeAddress & 0x7ffff,
      attributeStride: x.attributeStride & 0xffc,
      attributeScrollX: x.attributeScrollX,
      attributeScrollY: x.attributeScrollY,
      attributeCellWidth: x.attributeCellWidth,
      attributeCellHeight: x.attributeCellHeight,
      attributeRow: x.attributeRow,
      attributeMapReload: attributeMapReload,
    } : null;
    if (x.enabled) {
      if (x.mode === "text") {
        x.textRow = (x.textRow + 1) & 7;
        if (x.textRow === 0) x.overlayAddress = (x.overlayAddress + x.overlayStride) & 0x7ffff;
      } else {
        x.overlayAddress = (x.overlayAddress + x.overlayStride) & 0x7ffff;
      }
    }
    if (x.attributeMapEnabled) {
      // Match EndScanline in Altirra: mAttrRow is a five-bit counter.  The
      // local map row address advances only on its comparison with the cell
      // height, which gives the documented extended first row on overscroll.
      x.attributeRow = (x.attributeRow + 1) & 0x1f;
      if (x.attributeRow === x.attributeCellHeight) {
        x.attributeRow = 0;
        x.attributeAddress = (x.attributeAddress + x.attributeStride) & 0x7ffff;
      }
    }
    return line;
  }

  function collisionBitsForPriority(priority, gtiaMode) {
    const layers = priority & 0xffff;
    // VBXE samples the final color inputs.  In GTIA's special color modes the
    // active input expands to the complete hardware group rather than the
    // ordinary GTIA object-collision layer.  Altirra FX 1.26 mode-F probes
    // establish the GTIA-10 resulting COLDETECT mask.
    if (layers !== 0 && gtiaMode === 2) return 0x7f;
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

  function overlayWinsPriority(profile, visiblePriority, priorityMask) {
    const layers = visiblePriority & 0xffff;
    if (profile === "fx1.20" || profile === "fx1.24") {
      // AHRM table 109: pre-1.26 boards have no background priority bit.
      // Thus a $00 mask still displays above a plain background; only PF2 and
      // PF3/P5 can be overridden by bits 6 and 7 respectively.
      return layers === 0 ||
        ((layers & PRIO_PF2) !== 0 && (priorityMask & 0x40) !== 0) ||
        ((layers & PRIO_PF3) !== 0 && (priorityMask & 0x80) !== 0);
    }
    return layers === 0
      ? (priorityMask & 0x80) !== 0
      : ((layers & 0x01) !== 0 && (priorityMask & 0x10) !== 0) ||
        ((layers & 0x02) !== 0 && (priorityMask & 0x20) !== 0) ||
        ((layers & 0x0c) !== 0 && (priorityMask & 0x40) !== 0) ||
        ((layers & 0x10) !== 0 && (priorityMask & 0x01) !== 0) ||
        ((layers & 0x20) !== 0 && (priorityMask & 0x02) !== 0) ||
        ((layers & 0x40) !== 0 && (priorityMask & 0x04) !== 0) ||
        ((layers & 0x80) !== 0 && (priorityMask & 0x08) !== 0);
  }

  function overlayCollisionEnabled(state, color) {
    return (state.collisionMask & (1 << ((color & 0xff) >>> 5))) !== 0;
  }

  function attributeMapCell(state, line, standardX) {
    if (!line || !line.attributeMapEnabled) return null;
    const width = line.attributeCellWidth | 0;
    const height = line.attributeCellHeight | 0;
    if (width < 1 || width > 32 || height < 1 || height > 32) return null;
    const rawScroll = line.attributeScrollX & 0x1f;
    const effectiveScroll = rawScroll >= width ? rawScroll - 32 : rawScroll;
    const x = (standardX | 0) + effectiveScroll;
    // For a negative overscroll offset, Altirra keeps fetching the first
    // buffered cell until the counter reaches zero. Do not turn that into a
    // fictitious preceding map column.
    const column = x < 0 ? 0 : Math.floor(x / width);
    // AHRM 12.4 limits the buffered line to 43 four-byte cells.
    if (column < 0 || column >= 43) return null;
    // `attributeAddress` already names the currently buffered map row. Its
    // five-bit vertical counter is advanced by nextXdlLine after each line.
    const address = (line.attributeAddress + (column << 2)) & 0x7ffff;
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
    if (width < 1 || width > 32) return false;
    const rawScroll = line.attributeScrollX & 0x1f;
    const x = (standardX | 0) + (rawScroll >= width ? rawScroll - 32 : rawScroll);
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

  function isAnticLoresGraphicsMode(line) {
    const mode = line.anticMode & 0x0f;
    // These graphics sources use the ordinary raw two-bit lores capture, but
    // their FX 1.26 GTIA-10 Reverse composition is independently tested.
    return mode >= 0x08 && mode <= 0x0e;
  }

  function isValidatedGtia9Or11GraphicsMode(line) {
    const anticMode = line.anticMode & 0x0f;
    // Altirra has established the opaque-palette-0 result for every graphics
    // mode 8-E in both GTIA 9 and 11. The caller has already excluded
    // ordinary and GTIA-10 composition.
    return anticMode >= 0x08 && anticMode <= 0x0e;
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

  function compositeOverlayPixel(state, video, target, targetPixel, priorityPixel, color, sourceByte, overlayPalette, priorityMask, attribute, gtiaMode) {
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
      // comparison. The caller supplies the hardware-visible source byte for
      // its overlay mode.
      state.collisionDetect |= collisionBitsForPriority(visiblePriority, gtiaMode);
    }
    // AHRM 12.4 defines both collision and overlay priority against the
    // color inputs that survive GTIA PRIOR processing. The raw priority plane
    // retains hidden P/M layers for normal GTIA collision handling, while this
    // optional plane removes them for VBXE.
    const wins = overlayWinsPriority(state.profile, visiblePriority, priorityMask);
    if (wins) target[targetPixel] = rgb;
  }

  function overlayWidthCode(line) {
    const width = line && line.overlayWidth !== undefined ? line.overlayWidth | 0 : 1;
    return width === 0 || width === 3 ? 0 : (width === 2 ? 2 : 1);
  }

  function overlayNativeWidth(line) {
    return [512, 640, 672][overlayWidthCode(line)];
  }

  function overlayLegacyStart(line) {
    // Altirra RenderOverlay bounds, converted from color clocks to jsA8E's
    // ANTIC line buffer: narrow $40-BF, normal $30-CF, wide $2C-D3.
    return [128, 96, 88][overlayWidthCode(line)];
  }

  function hiresTarget(video, scanline, signalWidth) {
    const width = video.vbxeHiresWidth | 0;
    const line = (scanline | 0) - 8;
    if (!video.vbxeHiresRgb || width < 640 || line < 0) return null;
    const activeWidth = signalWidth === undefined ? 640 : signalWidth | 0;
    if (activeWidth < 1 || activeWidth > width) return null;
    const base = line * width;
    return base + width <= video.vbxeHiresRgb.length
      ? { pixels: video.vbxeHiresRgb, width: width,
        base: base + ((width - activeWidth) >> 1), rowBase: base,
        signalWidth: activeWidth }
      : null;
  }

  function renderTextXdlLine(state, video, scanline, line) {
    const atariBase = (scanline | 0) * 456 + 128;
    const signalWidth = overlayNativeWidth(line);
    const target = hiresTarget(video, scanline, signalWidth);
    const pixels = target ? target.pixels : video.vbxeRgb;
    const base = target ? target.base : atariBase;
    const outputPixels = target ? signalWidth : 256;
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
      const priorityPixel = target
        ? (scanline | 0) * 456 + overlayLegacyStart(line) + (x >> 1)
        : atariBase + x;
      const map = attributeMapCell(state, line,
        target ? (x >> 1) : Math.floor(x * 320 / 256));
      // Altirra FX 1.26 text-collision probe: COLMASK selects the cell's
      // attribute byte, rather than its character name or fetched glyph byte.
      compositeOverlayPixel(state, video, pixels, base + x, priorityPixel, color, attribute, line.overlayPalette, priorityMask, map, line.anticGtiaMode);
    }
  }

  function clearXdlOutputLine(video, scanline) {
    if (!video || !video.vbxeRgb) return;
    const atariBase = (scanline | 0) * 456 + 88;
    if (atariBase >= 0 && atariBase + 336 <= video.vbxeRgb.length)
      video.vbxeRgb.fill(0, atariBase, atariBase + 336);
    const target = hiresTarget(video, scanline);
    if (target) target.pixels.fill(0, target.rowBase, target.rowBase + target.width);
  }

  function renderXdlLine(state, video, scanline, line) {
    if (!video || !video.vbxeRgb) return;
    // The presentation planes are an overlay, not a framebuffer. Clear this
    // scanline when XDL has been disabled at VSync so a prior attribute-map
    // result cannot survive after hardware has returned to pure ANTIC/GTIA.
    if (!line) {
      clearXdlOutputLine(video, scanline);
      return;
    }
    // The legacy and native presentation planes are mutually exclusive for a
    // given overlay mode. Clear both before drawing so a prior standard line
    // cannot leak through when this line switches to hires/text (or back).
    clearXdlOutputLine(video, scanline);
    if (line.mode === "text") {
      renderTextXdlLine(state, video, scanline, line);
      return;
    }
    if (line.mode !== "standard" && line.mode !== "lores" && line.mode !== "hires") {
      // Attribute-map-only XDL entries have no overlay renderer to clear the
      // RGB plane.  Leaving its prior line contents in place both hides the
      // current map output and makes stale pixels survive across frames.
      clearXdlOutputLine(video, scanline);
      return;
    }
    const hires = line.mode === "hires";
    const nativeWidth = overlayNativeWidth(line);
    const target = hires ? hiresTarget(video, scanline, nativeWidth) : null;
    const pixels = target ? target.pixels : video.vbxeRgb;
    const atariBase = target ? 0 : (scanline | 0) * 456 + overlayLegacyStart(line);
    const base = target ? target.base : atariBase;
    const outputPixels = target ? nativeWidth : (nativeWidth >> 1);
    const priorityMask = line.priority === undefined ? 0xff : line.priority;
    for (let x = 0; x < outputPixels; x++) {
      const sourceX = hires ? x : (line.mode === "lores" ? x >> 1 : x);
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
      const priorityPixel = target
        ? (scanline | 0) * 456 + overlayLegacyStart(line) + (x >> 1)
        : atariBase + x;
      const map = attributeMapCell(state, line,
        target ? (x >> 1) : x);
      compositeOverlayPixel(state, video, pixels, base + x, priorityPixel, color, sourceByte, line.overlayPalette, priorityMask, map, line.anticGtiaMode);
    }
  }

  function applyDefaultPlayfieldPalette(state, video, scanline, line) {
    if (!line || !line.playfieldPalette || !video || !video.vbxeRgb || !video.pixels) return;
    const scanBase = (scanline | 0) * 456;
    const start = overlayLegacyStart(line);
    const width = overlayNativeWidth(line) >> 1;
    const extendedColor = (state.videoControlActive & 0x02) !== 0;
    const pmMask = PRIO_PM0 | PRIO_PM1 | PRIO_PM2 | PRIO_PM3 |
      PRIO_M10_PM0 | PRIO_M10_PM1 | PRIO_M10_PM2 | PRIO_M10_PM3;
    const palette = line.playfieldPalette & 0x03;
    for (let x = 0; x < width; x++) {
      const pixel = scanBase + start + x;
      if (pixel < 0 || pixel >= video.vbxeRgb.length || video.vbxeRgb[pixel] !== 0) continue;
      const stored = video.vbxeCollisionPriority ? video.vbxeCollisionPriority[pixel] & 0xffff : 0;
      const visible = (stored & VBXE_CONTRIBUTOR_VALID) !== 0
        ? stored & ~VBXE_CONTRIBUTOR_VALID
        : (video.priority ? video.priority[pixel] & 0xffff : 0);
      // VBXE shadows GTIA's playfield/background path, but never recolors a
      // player/missile color that won GTIA priority.
      if ((visible & pmMask) !== 0) continue;
      const color = extendedColor ? video.pixels[pixel] & 0xff : video.pixels[pixel] & 0xfe;
      const p = (palette * 256 + color) * 3;
      video.vbxeRgb[pixel] = ((255 << 24) | (state.palette[p + 2] << 16) |
        (state.palette[p + 1] << 8) | state.palette[p]) >>> 0;
    }
  }

  function applyPlayfieldAttributes(state, video, scanline, line) {
    if (!line || !video || !video.vbxeRgb) return;
    if (!line.attributeMapEnabled) {
      applyDefaultPlayfieldPalette(state, video, scanline, line);
      return;
    }
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
        } else if (map.reverse && isGtiaMode10(line) && isAnticLoresGraphicsMode(line)) {
          color = 0;
        } else if (map.reverse && isGtiaMode9Or11(line) && isAnticLoresCharacterMode(line) &&
            hasReverseLoresSource(video.anticSourceLores, sourcePixel)) {
          color = 0;
        } else if (map.reverse && isGtiaMode9Or11(line) && isAnticLoresSelectorCharacterMode(line) &&
            hasReverseLoresSource(video.anticSourceLores, sourcePixel)) {
          color = 0;
        } else if (map.reverse && isGtiaMode9Or11(line) && isValidatedGtia9Or11GraphicsMode(line)) {
          color = 0;
        } else if (map.reverse && !hasGtiaSpecialMode(line) && isAnticHiresSource(line)) {
          color = reverseHiresColor(line, map, video.anticSourceBits, sourcePixel);
        } else if (map.reverse && !hasGtiaSpecialMode(line) && isAnticLoresMode(line)) {
          color = reverseLoresColor(map, video.anticSourceLores, sourcePixel);
        } else if (!map.reverse && isAnticHiresSource(line) &&
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
      } else if (map.reverse && isGtiaMode10(line) && isAnticLoresGraphicsMode(line)) {
        color = 0;
      } else if (map.reverse && isGtiaMode9Or11(line) && isAnticLoresCharacterMode(line) &&
          hasReverseLoresSource(video.anticSourceLores, pixel)) {
        color = 0;
      } else if (map.reverse && isGtiaMode9Or11(line) && isAnticLoresSelectorCharacterMode(line) &&
          hasReverseLoresSource(video.anticSourceLores, pixel)) {
        color = 0;
      } else if (map.reverse && isGtiaMode9Or11(line) && isValidatedGtia9Or11GraphicsMode(line)) {
        color = 0;
      } else if (map.reverse && !hasGtiaSpecialMode(line) && isAnticHiresSource(line)) {
        color = reverseHiresColor(line, map, video.anticSourceBits, pixel);
      } else if (map.reverse && !hasGtiaSpecialMode(line) && isAnticLoresMode(line)) {
        color = reverseLoresColor(map, video.anticSourceLores, pixel);
      } else if (!map.reverse && isAnticHiresSource(line) &&
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
      // Altirra maps bit 7 to CPU read/write and bit 6 to ANTIC DMA.
      (state.memacBControl & (isAntic ? 0x40 : 0x80)) !== 0
    ) {
      return (((state.memacBControl & 0x1f) << 14) + addr - 0x4000) & 0x7ffff;
    }
    return -1;
  }

  // The exact odd local-bus phase is resolved by the CPU/ANTIC caller. Keep
  // the per-scanline claim here so the lower-priority blitter budget can be
  // reduced even when the CPU and ANTIC access local VRAM through different
  // memory paths.
  function noteMemacAccess(state) {
    if (!state || !state.enabled) return;
    state.memacSlots = Math.min(912, (state.memacSlots | 0) + 1);
  }

  function localBusBudget(state, line) {
    if (!state || !state.enabled) return 0;
    let used = state.memacSlots | 0;
    // XDL DMA is charged by the decoder using the actual entry length.
    used += state.xdlSlots | 0;
    if (line && line.overlayEnabled) {
      // Altirra's FX scheduler reserves a different number of local cycles
      // for each of the three actual overlay widths.  This remains an
      // aggregate scanline reservation; individual even-cycle fetch phases
      // are outside this renderer's interface.
      const width = overlayWidthCode(line);
      if (line.mode === "lores") used += [128, 160, 168][width];
      else if (line.mode === "text") used += [195, 243, 255][width];
      else used += [256, 320, 336][width];
    }
    if (line && line.attributeMapEnabled &&
        (line.attributeMapReload ||
          line.attributeRow === 0)) {
      // The buffered map row always fetches 172 bytes. MEMAC remains counted
      // separately because it preempts this fetch rather than being hidden by
      // it, which gives the documented 236-cycle busy-line minimum.
      used += 172;
    }
    state.memacSlots = 0;
    state.xdlSlots = 0;
    return Math.max(0, 912 - used);
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
        // Altirra 4.40 reports the full FX core as $10 for all selectable
        // revisions. This takes precedence over the older AHRM text that
        // labels the latest FX core $11.
        case 0x00: return 0x10;
        case 0x01:
          return state.profile === "fx1.20" ? 0x20 :
            state.profile === "fx1.24" ? 0x24 : 0x26;
        case 0x0a: return state.collisionDetect & 0xff;
        case 0x10: return state.blitCollisionCode & 0xff;
        // AHRM 12.4: bit 0 denotes a control-block load and bit 1 denotes
        // active data processing. They are never set at the same time.
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
        // The FPGA stores seven component bits. Altirra exposes the same
        // 8-bit expansion used by its palette corrector: D7 is copied into
        // D0 rather than forcing D0 low.
        state.palette[paletteOffset(state) + component] =
          (v & 0xfe) | (v >>> 7);
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
        if ((v & 0x01) === 0) stopBlitter(state);
        else startBlitter(state);
        break;
      case 0x14:
        state.irqControl = v & 0x01;
        state.irqStatus = 0;
        state.blitterIrqPending = false;
        state.blitterIrqScheduled = false;
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
      profile: normalizeProfile(state.profile),
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
      blitter: state.blitter ? Object.assign({}, state.blitter) : null,
      irqStatus: state.irqStatus & 0x01,
      irqControl: state.irqControl & 0x01,
      blitterIrqPending: !!state.blitterIrqPending,
      blitterIrqScheduled: !!state.blitterIrqScheduled,
      blitterIrqResidual: state.blitterIrqResidual | 0,
      memacSlots: state.memacSlots | 0,
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
    state.profile = normalizeProfile(source.profile);
    state.enabled = state.profile !== "off" && source.enabled !== false;
    state.page = source.page === 0xd740 ? 0xd740 : DEFAULT_PAGE;
    copy(state.vram, source.vram);
    copy(state.palette, source.palette);
    copy(state.priority, source.priority);
    ["videoControlPending", "videoControlActive", "colorSelect", "collisionMask",
      "collisionDetect", "blitCollisionCode", "blitterBusy", "irqStatus", "irqControl",
      "memacSlots",
      "memacBControl", "memacControl", "memacBankSelect"].forEach(function (key) {
      if (source[key] !== undefined) state[key] = source[key] & 0xff;
    });
    state.blitterIrqPending = !!source.blitterIrqPending;
    state.blitterIrqScheduled = !!source.blitterIrqScheduled;
    state.blitterIrqResidual = source.blitterIrqResidual | 0;
    state.xdlAddressPending = source.xdlAddressPending & 0x7ffff;
    state.xdlAddressActive = source.xdlAddressActive & 0x7ffff;
    state.blitAddress = source.blitAddress & 0x7ffff;
    state.blitter = source.blitter ? Object.assign({}, source.blitter) : null;
    state.paletteSelect = source.paletteSelect & 0x03;
    if (source.xdl) state.xdl = Object.assign(createXdlState(), source.xdl);
    return state;
  }

  window.A8EVbxe = {
    VRAM_SIZE: VRAM_SIZE,
    normalizeConfig: normalizeConfig,
    normalizeProfile: normalizeProfile,
    createState: createState,
    softReset: softReset,
    powerCycle: powerCycle,
    verticalSync: verticalSync,
    advanceBlitter: advanceBlitter,
    scheduleBlitterIrq: scheduleBlitterIrq,
    raiseScheduledBlitterIrq: raiseScheduledBlitterIrq,
    localBusBudget: localBusBudget,
    nextXdlLine: nextXdlLine,
    renderXdlLine: renderXdlLine,
    applyPlayfieldAttributes: applyPlayfieldAttributes,
    attributeMapCell: attributeMapCell,
    collisionBitsForPriority: collisionBitsForPriority,
    overlayWinsPriority: overlayWinsPriority,
    isAddress: isAddress,
    memacAddress: memacAddress,
    noteMemacAccess: noteMemacAccess,
    access: access,
    cloneState: cloneState,
    restoreState: restoreState,
  };
})();
