(function () {
  "use strict";

  const VRAM_SIZE = 512 * 1024;
  const PALETTE_COUNT = 4;
  const PALETTE_ENTRIES = 256;
  const PALETTE_COMPONENTS = 3;
  const REGISTER_COUNT = 0x20;
  const DEFAULT_PAGE = 0xd640;

  function createXdlState() {
    return { address: 0, overlayAddress: 0, overlayStride: 0, mode: "off",
      enabled: false, repeat: 0, ended: false, overlayPalette: 1, priority: 0xff };
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

  function createState(config) {
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

  function powerCycle(state) {
    if (!state) return;
    softReset(state);
    state.vram.fill(0);
    state.palette.fill(0);
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
      if (c0 & 0x20) x.repeat = read();
      if (c0 & 0x40) { x.overlayAddress = read() | (read() << 8) | ((read() & 7) << 16); x.overlayStride = read() | ((read() & 15) << 8); }
      if (c0 & 0x80) x.address += 2;
      if (c1 & 1) x.address++;
      if (c1 & 2) x.address += 5;
      if (c1 & 4) x.address += 4;
      if (c1 & 8) { const misc = read(); x.overlayPalette = (misc >> 2) & 3; x.priority = read(); }
      if (c1 & 0x80) x.ended = true;
    }
    const line = x.enabled ? { mode: x.mode, address: x.overlayAddress & 0x7ffff, stride: x.overlayStride & 0xfff, overlayPalette: x.overlayPalette, priority: x.priority } : null;
    if (x.enabled) x.overlayAddress = (x.overlayAddress + x.overlayStride) & 0x7ffff;
    if (x.repeat > 0) x.repeat--;
    return line;
  }

  function renderXdlLine(state, video, scanline, line) {
    if (!line || (line.mode !== "standard" && line.mode !== "lores") || !video || !video.vbxeRgb) return;
    const base = (scanline | 0) * 456 + 128;
    video.vbxeRgb.fill(0, base, base + 256);
    const pixelCount = line.mode === "lores" ? 160 : 320;
    const priorityMask = line.priority === undefined ? 0xff : line.priority;
    for (let x = 0; x < 256; x++) {
      const sourceX = Math.floor(x * pixelCount / 256);
      const color = state.vram[(line.address + sourceX) & 0x7ffff] & 0xff;
      const transparency = (state.videoControlActive >> 2) & 0x03;
      if ((color === 0 && transparency >= 1) || (color === 15 && transparency === 3)) continue;
      const p = ((((line.overlayPalette === undefined ? 1 : line.overlayPalette) * 256) + color) * 3) | 0;
      const rgb = ((255 << 24) | (state.palette[p + 2] << 16) |
        (state.palette[p + 1] << 8) | state.palette[p]) >>> 0;
      const atariPriority = video.priority ? video.priority[base + x] : 0;
      const wins = atariPriority === 0
        ? (priorityMask & 0x80)
        : ((atariPriority & 0x01) && (priorityMask & 0x10)) ||
          ((atariPriority & 0x02) && (priorityMask & 0x20)) ||
          ((atariPriority & 0x0c) && (priorityMask & 0x40)) ||
          ((atariPriority & 0x10) && (priorityMask & 0x01)) ||
          ((atariPriority & 0x20) && (priorityMask & 0x02)) ||
          ((atariPriority & 0x40) && (priorityMask & 0x04)) ||
          ((atariPriority & 0x80) && (priorityMask & 0x08));
      if (wins) video.vbxeRgb[base + x] = rgb;
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
    isAddress: isAddress,
    memacAddress: memacAddress,
    access: access,
    cloneState: cloneState,
    restoreState: restoreState,
  };
})();
