(function () {
  "use strict";

  function createApi(cfg) {
    const PIXELS_PER_LINE = cfg.PIXELS_PER_LINE;
    const CYCLES_PER_LINE = cfg.CYCLES_PER_LINE || 114;

    const IO_COLPF3 = cfg.IO_COLPF3;
    const IO_COLPM0_TRIG2 = cfg.IO_COLPM0_TRIG2;
    const IO_COLPM1_TRIG3 = cfg.IO_COLPM1_TRIG3;
    const IO_COLPM2_PAL = cfg.IO_COLPM2_PAL;
    const IO_COLPM3 = cfg.IO_COLPM3;
    const IO_DMACTL = cfg.IO_DMACTL;
    const IO_GRACTL = cfg.IO_GRACTL;
    const IO_GRAFM_TRIG1 = cfg.IO_GRAFM_TRIG1;
    const IO_GRAFP0_P1PL = cfg.IO_GRAFP0_P1PL;
    const IO_GRAFP1_P2PL = cfg.IO_GRAFP1_P2PL;
    const IO_GRAFP2_P3PL = cfg.IO_GRAFP2_P3PL;
    const IO_GRAFP3_TRIG0 = cfg.IO_GRAFP3_TRIG0;
    const IO_HPOSM0_P0PF = cfg.IO_HPOSM0_P0PF;
    const IO_HPOSM1_P1PF = cfg.IO_HPOSM1_P1PF;
    const IO_HPOSM2_P2PF = cfg.IO_HPOSM2_P2PF;
    const IO_HPOSM3_P3PF = cfg.IO_HPOSM3_P3PF;
    const IO_HPOSP0_M0PF = cfg.IO_HPOSP0_M0PF;
    const IO_HPOSP1_M1PF = cfg.IO_HPOSP1_M1PF;
    const IO_HPOSP2_M2PF = cfg.IO_HPOSP2_M2PF;
    const IO_HPOSP3_M3PF = cfg.IO_HPOSP3_M3PF;
    const IO_PMBASE = cfg.IO_PMBASE;
    const IO_PRIOR = cfg.IO_PRIOR;
    const IO_SIZEM_P0PL = cfg.IO_SIZEM_P0PL;
    const IO_SIZEP0_M0PL = cfg.IO_SIZEP0_M0PL;
    const IO_SIZEP1_M1PL = cfg.IO_SIZEP1_M1PL;
    const IO_SIZEP2_M2PL = cfg.IO_SIZEP2_M2PL;
    const IO_SIZEP3_M3PL = cfg.IO_SIZEP3_M3PL;
    const IO_VDELAY = cfg.IO_VDELAY;
    const PLAYFIELD_SCRATCH_VIEW_X = cfg.PLAYFIELD_SCRATCH_VIEW_X || 0;
    const PMG_POSITION_BIAS_PIXELS = 0;

    function pmgRegisterIndex(address) {
      switch (address) {
        case IO_HPOSP0_M0PF: return 0;
        case IO_HPOSP1_M1PF: return 1;
        case IO_HPOSP2_M2PF: return 2;
        case IO_HPOSP3_M3PF: return 3;
        case IO_HPOSM0_P0PF: return 4;
        case IO_HPOSM1_P1PF: return 5;
        case IO_HPOSM2_P2PF: return 6;
        case IO_HPOSM3_P3PF: return 7;
        case IO_SIZEP0_M0PL: return 8;
        case IO_SIZEP1_M1PL: return 9;
        case IO_SIZEP2_M2PL: return 10;
        case IO_SIZEP3_M3PL: return 11;
        case IO_SIZEM_P0PL: return 12;
        case IO_GRAFP0_P1PL: return 13;
        case IO_GRAFP1_P2PL: return 14;
        case IO_GRAFP2_P3PL: return 15;
        case IO_GRAFP3_TRIG0: return 16;
        case IO_GRAFM_TRIG1: return 17;
        default: return -1;
      }
    }

    function recordPmgRegisterEvent(ctx, address, value, lineCycle) {
      const drawLine = ctx.ioData.drawLine;
      const registerIndex = pmgRegisterIndex(address);
      if (
        !drawLine ||
        !drawLine.pmgEventRegisters ||
        !drawLine.pmgEventValues ||
        !drawLine.pmgEventCycles ||
        registerIndex < 0 ||
        lineCycle < 0 ||
        lineCycle >= CYCLES_PER_LINE
      ) return;
      if (drawLine.pmgEventCount >= drawLine.pmgEventRegisters.length) {
        drawLine.pmgEventOverflow = true;
        return;
      }
      const eventIndex = drawLine.pmgEventCount++;
      drawLine.pmgEventRegisters[eventIndex] = registerIndex;
      drawLine.pmgEventValues[eventIndex] = value & 0xff;
      drawLine.pmgEventCycles[eventIndex] = lineCycle & 0xff;
    }

    function recordPmgRegisterWrite(ctx, address, value) {
      const io = ctx.ioData;
      const writeCycle =
        (io.clock | 0) + Math.max((ctx.currentInstructionCycles | 0) - 1, 0);
      recordPmgRegisterEvent(
        ctx,
        address,
        value,
        writeCycle - (io.displayListFetchCycle | 0),
      );
    }

    const PRIO_PF0 = cfg.PRIO_PF0;
    const PRIO_PF1 = cfg.PRIO_PF1;
    const PRIO_PF2 = cfg.PRIO_PF2;
    const PRIO_PF3 = cfg.PRIO_PF3;
    const PRIO_BKG = cfg.PRIO_BKG;
    const PRIO_PM0 = cfg.PRIO_PM0;
    const PRIO_PM1 = cfg.PRIO_PM1;
    const PRIO_PM2 = cfg.PRIO_PM2;
    const PRIO_PM3 = cfg.PRIO_PM3;
    const PRIO_M10_PM0 = cfg.PRIO_M10_PM0;
    const PRIO_M10_PM1 = cfg.PRIO_M10_PM1;
    const PRIO_M10_PM2 = cfg.PRIO_M10_PM2;
    const PRIO_M10_PM3 = cfg.PRIO_M10_PM3;

    function drawPlayer(
      color,
      size,
      data,
      priorityMask,
      priorityBit,
      prio,
      dst,
      startIndex,
      special,
      overlap,
    ) {
      let mask = 0x80;
      let collision = 0;
      let step;
      const cColor = color & 0xff;
      const cPriorityMask = priorityMask & 0xffff;
      const cPriorityBit = priorityBit & 0xffff;
      const cOverlap = overlap & 0xffff;

      if ((size & 0x03 & 0xff) === 0x01) step = 4;
      else if ((size & 0x03 & 0xff) === 0x03) step = 8;
      else step = 2;

      let idx = startIndex | 0;
      while (mask) {
        if (data & mask) {
          for (let o = 0; o < step; o++) {
            const pi = (idx + o) | 0;
            const p = prio[pi] & 0xffff;

            if (cOverlap && p & cOverlap) {
              if (special && p & PRIO_PF1) {
                dst[pi] = (dst[pi] | (cColor & 0xf0)) & 0xff;
              } else if (!(p & cPriorityMask)) {
                dst[pi] = (dst[pi] | cColor) & 0xff;
              }
            } else {
              if (special && p & PRIO_PF1) {
                dst[pi] = ((dst[pi] & 0x0f) | (cColor & 0xf0)) & 0xff;
              } else if (!(p & cPriorityMask)) {
                dst[pi] = cColor;
              }
            }

            prio[pi] = (prio[pi] | cPriorityBit) & 0xffff;
            collision |= prio[pi] & 0xffff;
          }
        }

        idx += step;
        mask >>= 1;
      }

      if (special) {
        collision =
          (collision & ~(PRIO_PF1 | PRIO_PF2)) |
          (collision & PRIO_PF1 ? PRIO_PF2 : 0);
      }

      return collision & 0xffff;
    }

    function drawMissile(
      number,
      color,
      size,
      data,
      priorityMask,
      prio,
      dst,
      startIndex,
      special,
      prior,
    ) {
      let collision = 0;
      const cColor = color & 0xff;
      const cPriorityMask = priorityMask & 0xffff;

      const shifted = (number & 3) << 1;
      let mask = (0x02 << shifted) & 0xff;

      let width;
      const sizeBits = size & (0x03 << shifted);
      if (sizeBits === 0x01 << shifted) width = 4;
      else if (sizeBits === 0x03 << shifted) width = 8;
      else width = 2;

      function drawPixel(pi) {
        const p = prio[pi] & 0xffff;
        if (special && p & PRIO_PF1) {
          dst[pi] = ((dst[pi] & 0x0f) | (cColor & 0xf0)) & 0xff;
        } else if (!(p & cPriorityMask)) {
          const priorMode = (prior >> 6) & 3;
          if ((prior & 0x10) && (priorMode === 1 || priorMode === 3) && (p === PRIO_BKG)) {
            if (priorMode === 3 && (dst[pi] & 0x0f) === 0x00) {
              dst[pi] = ((cColor | dst[pi]) & 0xf0) & 0xff;
            } else {
              dst[pi] = (cColor | dst[pi]) & 0xff;
            }
          } else {
            dst[pi] = cColor;
          }
        }
        collision |= p;
      }

      if (data & mask) {
        for (let o0 = 0; o0 < width; o0++) drawPixel((startIndex + o0) | 0);
      }

      mask >>= 1;
      if (data & mask) {
        const base = (startIndex + width) | 0;
        for (let o1 = 0; o1 < width; o1++) drawPixel((base + o1) | 0);
      }

      if (special) {
        collision =
          (collision & ~(PRIO_PF1 | PRIO_PF2)) |
          (collision & PRIO_PF1 ? PRIO_PF2 : 0);
      }

      return collision & 0xffff;
    }

    function playerStep(size) {
      if ((size & 0x03 & 0xff) === 0x01) return 4;
      if ((size & 0x03 & 0xff) === 0x03) return 8;
      return 2;
    }

    function missileWidth(number, size) {
      const shifted = (number & 3) << 1;
      const sizeBits = size & (0x03 << shifted);
      if (sizeBits === 0x01 << shifted) return 4;
      if (sizeBits === 0x03 << shifted) return 8;
      return 2;
    }

    function missileSizeCode(number, size) {
      return (size >> ((number & 3) << 1)) & 0x03;
    }

    function pmgStartX(hpos) {
      return (((hpos & 0xff) << 1) + PMG_POSITION_BIAS_PIXELS) | 0;
    }

    function reloadPlayerShift(shiftState, stateState, index, data) {
      shiftState[index] = (shiftState[index] | data) & 0xff;
      stateState[index] = 0;
    }

    function reloadMissileShift(shiftState, stateState, index, data) {
      shiftState[index] = (shiftState[index] | data) & 0x03;
      stateState[index] = 0;
    }

    function advancePlayerShift(shiftState, stateState, index, size) {
      const nextState = (((stateState[index] & 0xff) + 1) & (size & 0x03)) | 0;
      stateState[index] = nextState & 0xff;
      if (nextState === 0) {
        shiftState[index] = (shiftState[index] << 1) & 0xff;
      }
    }

    function advanceMissileShift(shiftState, stateState, index, size) {
      const nextState =
        (((stateState[index] & 0xff) + 1) & missileSizeCode(index, size)) | 0;
      stateState[index] = nextState & 0xff;
      if (nextState === 0) {
        shiftState[index] = (shiftState[index] << 1) & 0x03;
      }
    }

    function drawPlayerClockCell(
      color,
      priorityMask,
      priorityBit,
      prio,
      dst,
      startIndex,
      special,
      overlap,
      playfieldColors,
      mixMask,
    ) {
      const cPriorityMask = priorityMask & 0xffff;
      const cPriorityBit = priorityBit & 0xffff;
      const cOverlap = overlap & 0xffff;
      let collision = 0;

      for (let pi = startIndex | 0, end = (startIndex + 2) | 0; pi < end; pi++) {
        const p = prio[pi] & 0xffff;
        // Mix with the original playfield, never a lower player's output.
        const pfColor = (playfieldColors >> ((pi - startIndex) * 8)) & 0xff;
        const cColor = (color | ((p & mixMask) ? pfColor : 0)) & 0xff;
        if (cOverlap && (p & cOverlap)) {
          if (special && (p & PRIO_PF1)) {
            dst[pi] = ((cColor & 0xf0) | dst[pi]) & 0xff;
          } else if (!(p & cPriorityMask)) {
            dst[pi] = (cColor | dst[pi]) & 0xff;
          }
        } else {
          if (special && (p & PRIO_PF1)) {
            dst[pi] = ((dst[pi] & 0x0f) | (cColor & 0xf0)) & 0xff;
          } else if (!(p & cPriorityMask)) {
            dst[pi] = cColor;
          }
        }
        prio[pi] = (p | cPriorityBit) & 0xffff;
        collision |= prio[pi] & 0xffff;
      }

      if (special) {
        collision =
          (collision & ~(PRIO_PF1 | PRIO_PF2)) |
          (collision & PRIO_PF1 ? PRIO_PF2 : 0);
      }

      return collision & 0xffff;
    }

    function drawMissileClockCell(
      color,
      priorityMask,
      prio,
      dst,
      startIndex,
      special,
    ) {
      const cColor = color & 0xff;
      const cPriorityMask = priorityMask & 0xffff;
      let collision = 0;

      for (let pi = startIndex | 0, end = (startIndex + 2) | 0; pi < end; pi++) {
        const p = prio[pi] & 0xffff;
        if (special && (p & PRIO_PF1)) {
          dst[pi] = ((dst[pi] & 0x0f) | (cColor & 0xf0)) & 0xff;
        } else if (!(p & cPriorityMask)) {
          dst[pi] = cColor;
        }
        collision |= p;
      }

      if (special) {
        collision =
          (collision & ~(PRIO_PF1 | PRIO_PF2)) |
          (collision & PRIO_PF1 ? PRIO_PF2 : 0);
      }

      return collision & 0xffff;
    }

    function drawPlayerSpan(
      color,
      size,
      data,
      priorityMask,
      priorityBit,
      prio,
      dst,
      startIndex,
      spanStart,
      spanEnd,
      special,
      overlap,
    ) {
      const cColor = color & 0xff;
      const cPriorityMask = priorityMask & 0xffff;
      const cPriorityBit = priorityBit & 0xffff;
      const cOverlap = overlap & 0xffff;
      const step = playerStep(size);
      let collision = 0;
      let idx = startIndex | 0;

      for (let mask = 0x80; mask; mask >>= 1, idx += step) {
        if (!(data & mask)) continue;
        const segStart = idx | 0;
        const segEnd = (segStart + step) | 0;
        const drawStart = segStart > spanStart ? segStart : spanStart;
        const drawEnd = segEnd < spanEnd ? segEnd : spanEnd;
        for (let pi = drawStart; pi < drawEnd; pi++) {
          const p = prio[pi] & 0xffff;
          if (cOverlap && p & cOverlap) {
            if (special && p & PRIO_PF1) {
              dst[pi] = (dst[pi] | (cColor & 0xf0)) & 0xff;
            } else if (!(p & cPriorityMask)) {
              dst[pi] = (dst[pi] | cColor) & 0xff;
            }
          } else {
            if (special && p & PRIO_PF1) {
              dst[pi] = ((dst[pi] & 0x0f) | (cColor & 0xf0)) & 0xff;
            } else if (!(p & cPriorityMask)) {
              dst[pi] = cColor;
            }
          }
          prio[pi] = (p | cPriorityBit) & 0xffff;
          collision |= prio[pi] & 0xffff;
        }
      }

      if (special) {
        collision =
          (collision & ~(PRIO_PF1 | PRIO_PF2)) |
          (collision & PRIO_PF1 ? PRIO_PF2 : 0);
      }
      return collision & 0xffff;
    }

    function drawMissileSpan(
      number,
      color,
      size,
      data,
      priorityMask,
      prio,
      dst,
      startIndex,
      spanStart,
      spanEnd,
      special,
      prior,
    ) {
      const cColor = color & 0xff;
      const cPriorityMask = priorityMask & 0xffff;
      const width = missileWidth(number, size);
      const shifted = (number & 3) << 1;
      let collision = 0;
      let mask = (0x02 << shifted) & 0xff;
      let idx = startIndex | 0;

      for (let segment = 0; segment < 2; segment++) {
        if (data & mask) {
          const segStart = idx | 0;
          const segEnd = (segStart + width) | 0;
          const drawStart = segStart > spanStart ? segStart : spanStart;
          const drawEnd = segEnd < spanEnd ? segEnd : spanEnd;
          for (let pi = drawStart; pi < drawEnd; pi++) {
            const p = prio[pi] & 0xffff;
            if (special && p & PRIO_PF1) {
              dst[pi] = ((dst[pi] & 0x0f) | (cColor & 0xf0)) & 0xff;
            } else if (!(p & cPriorityMask)) {
              const priorMode = (prior >> 6) & 3;
              if ((prior & 0x10) && (priorMode === 1 || priorMode === 3) && (p === PRIO_BKG)) {
                if (priorMode === 3 && (dst[pi] & 0x0f) === 0x00) {
                  dst[pi] = ((cColor | dst[pi]) & 0xf0) & 0xff;
                } else {
                  dst[pi] = (cColor | dst[pi]) & 0xff;
                }
              } else {
                dst[pi] = cColor;
              }
            }
            collision |= p;
          }
        }
        idx += width;
        mask >>= 1;
      }

      if (special) {
        collision =
          (collision & ~(PRIO_PF1 | PRIO_PF2)) |
          (collision & PRIO_PF1 ? PRIO_PF2 : 0);
      }
      return collision & 0xffff;
    }

    function playerPriorityMask(prior, number) {
      switch (number | 0) {
        case 3:
          if (prior & 0x01) return PRIO_PM0 | PRIO_PM1 | PRIO_PM2 | PRIO_M10_PM0 | PRIO_M10_PM1 | PRIO_M10_PM2;
          if (prior & 0x02)
            {return PRIO_PM0 | PRIO_PM1 | PRIO_PF0 | PRIO_PF1 | PRIO_PF2 | PRIO_PF3 | PRIO_PM2 | PRIO_M10_PM0 | PRIO_M10_PM1 | PRIO_M10_PM2;}
          if (prior & 0x04)
            {return PRIO_PF0 | PRIO_PF1 | PRIO_PF2 | PRIO_PF3 | PRIO_PM0 | PRIO_PM1 | PRIO_PM2 | PRIO_M10_PM0 | PRIO_M10_PM1 | PRIO_M10_PM2;}
          if (prior & 0x08) return PRIO_PF0 | PRIO_PF1 | PRIO_PM0 | PRIO_PM1 | PRIO_PM2 | PRIO_M10_PM0 | PRIO_M10_PM1 | PRIO_M10_PM2;
          return 0x00;
        case 2:
          if (prior & 0x01) return PRIO_PM0 | PRIO_PM1 | PRIO_M10_PM0 | PRIO_M10_PM1;
          if (prior & 0x02) return PRIO_PM0 | PRIO_PM1 | PRIO_PF0 | PRIO_PF1 | PRIO_PF2 | PRIO_PF3 | PRIO_M10_PM0 | PRIO_M10_PM1;
          if (prior & 0x04) return PRIO_PF0 | PRIO_PF1 | PRIO_PF2 | PRIO_PF3 | PRIO_PM0 | PRIO_PM1 | PRIO_M10_PM0 | PRIO_M10_PM1;
          if (prior & 0x08) return PRIO_PF0 | PRIO_PF1 | PRIO_PM0 | PRIO_PM1 | PRIO_M10_PM0 | PRIO_M10_PM1;
          return 0x00;
        case 1:
          if (prior & 0x01) return PRIO_PM0 | PRIO_M10_PM0;
          if (prior & 0x02) return PRIO_PM0 | PRIO_M10_PM0;
          if (prior & 0x04) return PRIO_PF0 | PRIO_PF1 | PRIO_PF2 | PRIO_PF3 | PRIO_PM0 | PRIO_M10_PM0;
          if (prior & 0x08) return PRIO_PF0 | PRIO_PF1 | PRIO_PM0 | PRIO_M10_PM0;
          return 0x00;
        default:
          if (prior & 0x04) return PRIO_PF0 | PRIO_PF1 | PRIO_PF2 | PRIO_PF3;
          if (prior & 0x08) return PRIO_PF0 | PRIO_PF1;
          return 0x00;
      }
    }

    function missilePriorityMask(prior, number) {
      switch (number | 0) {
        case 3:
          if (prior & 0x01) return prior & 0x10 ? PRIO_PM0 | PRIO_PM1 | PRIO_PM2 | PRIO_PM3 | PRIO_M10_PM0 | PRIO_M10_PM1 | PRIO_M10_PM2 | PRIO_M10_PM3 : PRIO_PM0 | PRIO_PM1 | PRIO_PM2 | PRIO_M10_PM0 | PRIO_M10_PM1 | PRIO_M10_PM2;
          if (prior & 0x02)
            {return prior & 0x10 ? PRIO_PM0 | PRIO_PM1 | PRIO_M10_PM0 | PRIO_M10_PM1 : PRIO_PM0 | PRIO_PM1 | PRIO_PF0 | PRIO_PF1 | PRIO_PF2 | PRIO_PF3 | PRIO_PM2 | PRIO_M10_PM0 | PRIO_M10_PM1 | PRIO_M10_PM2;}
          if (prior & 0x04)
            {return prior & 0x10 ? 0x00 : PRIO_PF0 | PRIO_PF1 | PRIO_PF2 | PRIO_PF3 | PRIO_PM0 | PRIO_PM1 | PRIO_PM2 | PRIO_M10_PM0 | PRIO_M10_PM1 | PRIO_M10_PM2;}
          if (prior & 0x08)
            {return prior & 0x10 ? PRIO_PM0 | PRIO_PM1 | PRIO_PM2 | PRIO_PM3 | PRIO_M10_PM0 | PRIO_M10_PM1 | PRIO_M10_PM2 | PRIO_M10_PM3 : PRIO_PF0 | PRIO_PF1 | PRIO_PM0 | PRIO_PM1 | PRIO_PM2 | PRIO_M10_PM0 | PRIO_M10_PM1 | PRIO_M10_PM2;}
          return 0x00;
        case 2:
          if (prior & 0x01) return prior & 0x10 ? PRIO_PM0 | PRIO_PM1 | PRIO_PM2 | PRIO_PM3 | PRIO_M10_PM0 | PRIO_M10_PM1 | PRIO_M10_PM2 | PRIO_M10_PM3 : PRIO_PM0 | PRIO_PM1 | PRIO_M10_PM0 | PRIO_M10_PM1;
          if (prior & 0x02) return prior & 0x10 ? PRIO_PM0 | PRIO_PM1 | PRIO_M10_PM0 | PRIO_M10_PM1 : PRIO_PM0 | PRIO_PM1 | PRIO_PF0 | PRIO_PF1 | PRIO_PF2 | PRIO_PF3 | PRIO_M10_PM0 | PRIO_M10_PM1;
          if (prior & 0x04) return prior & 0x10 ? 0x00 : PRIO_PF0 | PRIO_PF1 | PRIO_PF2 | PRIO_PF3 | PRIO_PM0 | PRIO_PM1 | PRIO_M10_PM0 | PRIO_M10_PM1;
          if (prior & 0x08) return prior & 0x10 ? PRIO_PM0 | PRIO_PM1 | PRIO_PM2 | PRIO_PM3 | PRIO_M10_PM0 | PRIO_M10_PM1 | PRIO_M10_PM2 | PRIO_M10_PM3 : PRIO_PF0 | PRIO_PF1 | PRIO_PM0 | PRIO_PM1 | PRIO_M10_PM0 | PRIO_M10_PM1;
          return 0x00;
        case 1:
          if (prior & 0x01) return prior & 0x10 ? PRIO_PM0 | PRIO_PM1 | PRIO_PM2 | PRIO_PM3 | PRIO_M10_PM0 | PRIO_M10_PM1 | PRIO_M10_PM2 | PRIO_M10_PM3 : PRIO_PM0 | PRIO_M10_PM0;
          if (prior & 0x02) return prior & 0x10 ? PRIO_PM0 | PRIO_PM1 | PRIO_M10_PM0 | PRIO_M10_PM1 : PRIO_PM0 | PRIO_M10_PM0;
          if (prior & 0x04) return prior & 0x10 ? 0x00 : PRIO_PF0 | PRIO_PF1 | PRIO_PF2 | PRIO_PF3 | PRIO_PM0 | PRIO_M10_PM0;
          if (prior & 0x08) return prior & 0x10 ? PRIO_PM0 | PRIO_PM1 | PRIO_PM2 | PRIO_PM3 | PRIO_M10_PM0 | PRIO_M10_PM1 | PRIO_M10_PM2 | PRIO_M10_PM3 : PRIO_PF0 | PRIO_PF1 | PRIO_PM0 | PRIO_M10_PM0;
          return 0x00;
        default:
          if (prior & 0x01) return prior & 0x10 ? PRIO_PM0 | PRIO_PM1 | PRIO_PM2 | PRIO_PM3 | PRIO_M10_PM0 | PRIO_M10_PM1 | PRIO_M10_PM2 | PRIO_M10_PM3 : 0x00;
          if (prior & 0x02) return prior & 0x10 ? PRIO_PM0 | PRIO_PM1 | PRIO_M10_PM0 | PRIO_M10_PM1 : 0x00;
          if (prior & 0x04) return prior & 0x10 ? 0x00 : PRIO_PF0 | PRIO_PF1 | PRIO_PF2 | PRIO_PF3;
          if (prior & 0x08) return prior & 0x10 ? PRIO_PM0 | PRIO_PM1 | PRIO_PM2 | PRIO_PM3 | PRIO_M10_PM0 | PRIO_M10_PM1 | PRIO_M10_PM2 | PRIO_M10_PM3 : PRIO_PF0 | PRIO_PF1;
          return 0x00;
      }
    }

    function mergeMissileDmaValue(sram, y, value) {
      if ((y & 0x01) !== 0) return value & 0xff;

      const vdelay = sram[IO_VDELAY] & 0x0f;
      let merged = value & 0xff;
      for (let missile = 0; missile < 4; missile++) {
        if ((vdelay & (1 << missile)) !== 0) {
          const bits = 0x03 << (missile * 2);
          merged = (merged & ~bits) | (sram[IO_GRAFM_TRIG1] & bits);
        }
      }
      return merged & 0xff;
    }

    function fetchPmgDmaCycle(ctx, lineCycle, y, delayedDmaCtl) {
      if (y >= 248) return 0;

      const sram = ctx.sram;
      const dmactl =
        delayedDmaCtl === undefined ? sram[IO_DMACTL] & 0xff : delayedDmaCtl & 0xff;

      const pmDmaPlayers = (dmactl & 0x08) !== 0;
      const pmDmaMissiles = ((dmactl & 0x04) !== 0) || pmDmaPlayers;
      const pmReceivePlayers = (sram[IO_GRACTL] & 0x02) !== 0;
      const pmReceiveMissiles = (sram[IO_GRACTL] & 0x01) !== 0;

      if (!pmDmaPlayers && !pmDmaMissiles) return 0;

      const pmbaseHi = (sram[IO_PMBASE] & 0xff) << 8;
      const hires = (dmactl & 0x10) !== 0;

      function fetchPmAddr(offset) {
        const lineIndex = hires ? y : (y >> 1);
        const base = hires ? (pmbaseHi & 0xf800) : (pmbaseHi & 0xfc00);
        return (base + offset + (lineIndex & 0xffff)) & 0xffff;
      }

      function vdelayAllowsLoad(vdelayMask) {
        return ((sram[IO_VDELAY] & vdelayMask) === 0) || ((y & 0x01) !== 0);
      }

      if (lineCycle === 0 && pmDmaMissiles) {
        if (pmReceiveMissiles) {
          const oldValue = sram[IO_GRAFM_TRIG1] & 0xff;
          const newValue = mergeMissileDmaValue(
            sram,
            y,
            ctx.ram[fetchPmAddr(hires ? 768 : 384)],
          );
          sram[IO_GRAFM_TRIG1] = newValue;
          if (newValue !== oldValue) {
            recordPmgRegisterEvent(ctx, IO_GRAFM_TRIG1, newValue, lineCycle);
          }
        }
        return 1;
      }
      if (pmDmaPlayers) {
        if (lineCycle === 2) {
          if (pmReceivePlayers && vdelayAllowsLoad(0x10)) {
            sram[IO_GRAFP0_P1PL] = ctx.ram[fetchPmAddr(hires ? 1024 : 512)];
            recordPmgRegisterEvent(ctx, IO_GRAFP0_P1PL, sram[IO_GRAFP0_P1PL], lineCycle);
          }
          return 1;
        } else if (lineCycle === 3) {
          if (pmReceivePlayers && vdelayAllowsLoad(0x20)) {
            sram[IO_GRAFP1_P2PL] = ctx.ram[fetchPmAddr(hires ? 1280 : 640)];
            recordPmgRegisterEvent(ctx, IO_GRAFP1_P2PL, sram[IO_GRAFP1_P2PL], lineCycle);
          }
          return 1;
        } else if (lineCycle === 4) {
          if (pmReceivePlayers && vdelayAllowsLoad(0x40)) {
            sram[IO_GRAFP2_P3PL] = ctx.ram[fetchPmAddr(hires ? 1536 : 768)];
            recordPmgRegisterEvent(ctx, IO_GRAFP2_P3PL, sram[IO_GRAFP2_P3PL], lineCycle);
          }
          return 1;
        } else if (lineCycle === 5) {
          if (pmReceivePlayers && vdelayAllowsLoad(0x80)) {
            sram[IO_GRAFP3_TRIG0] = ctx.ram[fetchPmAddr(hires ? 1792 : 896)];
            recordPmgRegisterEvent(ctx, IO_GRAFP3_TRIG0, sram[IO_GRAFP3_TRIG0], lineCycle);
          }
          return 1;
        }
      }
      return 0;
    }

    function fetchPhantomMissileDmaCycle(ctx, lineCycle, y, displayListByte) {
      const sram = ctx.sram;
      if (lineCycle !== 1 || (sram[IO_GRACTL] & 0x01) === 0) return 0;

      const oldValue = sram[IO_GRAFM_TRIG1] & 0xff;
      const newValue = mergeMissileDmaValue(sram, y, displayListByte);
      sram[IO_GRAFM_TRIG1] = newValue;
      if (newValue !== oldValue) {
        recordPmgRegisterEvent(ctx, IO_GRAFM_TRIG1, newValue, lineCycle);
      }
      return 1;
    }

    function drawPlayerMissilesClock(ctx, spanStart) {
      const io = ctx.ioData;
      const ram = ctx.ram;
      const sram = ctx.sram;
      const y = io.video.currentDisplayLine | 0;
      if (y >= 248) return;

      const spanPixelStart = spanStart | 0;
      const spanPixelEnd = (spanPixelStart + 4) | 0;
      if (spanPixelEnd <= 0 || spanPixelStart >= PIXELS_PER_LINE) return;

      const dst = io.videoOut.pixels;
      const prio = io.videoOut.priority;
      const prior = sram[IO_PRIOR] & 0xff;
      const mode = io.currentDisplayListCommand & 0x0f;
      const special =
        (mode === 0x02 || mode === 0x03 || mode === 0x0f) &&
        (prior & 0xc0) === 0;
      let lineBase = y * PIXELS_PER_LINE;
      if (dst === io.videoOut.playfieldScratchPixels) {
        lineBase =
          y * (io.videoOut.playfieldScratchWidth | 0) +
          PLAYFIELD_SCRATCH_VIEW_X;
      }
      const clipStart = lineBase + (spanPixelStart > 0 ? spanPixelStart : 0);
      const clipEnd = lineBase + (spanPixelEnd < PIXELS_PER_LINE ? spanPixelEnd : PIXELS_PER_LINE);
      if (clipEnd <= clipStart) return;

      const visibleSpanStart = spanPixelStart > 0 ? spanPixelStart : 0;
      const playerShift = io.drawLine.playerPmgShift;
      const playerState = io.drawLine.playerPmgState;
      const missileShift = io.drawLine.missilePmgShift;
      const missileState = io.drawLine.missilePmgState;
      const playerGrafRegs = [
        IO_GRAFP0_P1PL,
        IO_GRAFP1_P2PL,
        IO_GRAFP2_P3PL,
        IO_GRAFP3_TRIG0,
      ];
      const playerHposRegs = [
        IO_HPOSP0_M0PF,
        IO_HPOSP1_M1PF,
        IO_HPOSP2_M2PF,
        IO_HPOSP3_M3PF,
      ];
      const playerSizeRegs = [
        IO_SIZEP0_M0PL,
        IO_SIZEP1_M1PL,
        IO_SIZEP2_M2PL,
        IO_SIZEP3_M3PL,
      ];
      const playerColorRegs = [
        IO_COLPM0_TRIG2,
        IO_COLPM1_TRIG3,
        IO_COLPM2_PAL,
        IO_COLPM3,
      ];
      const playerPriorityBits = [PRIO_PM0, PRIO_PM1, PRIO_PM2, PRIO_PM3];
      const playerOverlapMasks = [prior & 0x20 ? PRIO_PM1 : 0, 0, prior & 0x20 ? PRIO_PM3 : 0, 0];
      const missileHposRegs = [
        IO_HPOSM0_P0PF,
        IO_HPOSM1_P1PF,
        IO_HPOSM2_P2PF,
        IO_HPOSM3_P3PF,
      ];
      const missileMasks = [0x03, 0x0c, 0x30, 0xc0];
      const playerCollision = new Uint16Array(4);
      const missileCollision = new Uint16Array(4);

      function primePlayerClock(index, x) {
        const data = sram[playerGrafRegs[index]] & 0xff;
        const hpos = pmgStartX(sram[playerHposRegs[index]] & 0xff);
        const size = sram[playerSizeRegs[index]] & 0xff;
        if (x === hpos && data) reloadPlayerShift(playerShift, playerState, index, data);
        advancePlayerShift(playerShift, playerState, index, size);
      }

      function primeMissileClock(index, x) {
        const data = (sram[IO_GRAFM_TRIG1] & missileMasks[index]) >> (index * 2);
        const hpos = pmgStartX(sram[missileHposRegs[index]] & 0xff);
        const size = sram[IO_SIZEM_P0PL] & 0xff;
        if (x === hpos && data) reloadMissileShift(missileShift, missileState, index, data);
        advanceMissileShift(missileShift, missileState, index, size);
      }

      function primePlayerClockFromRegisters(index, x, registers) {
        const data = registers[13 + index] & 0xff;
        const hpos = pmgStartX(registers[index] & 0xff);
        const size = registers[8 + index] & 0xff;
        if (x === hpos && data) reloadPlayerShift(playerShift, playerState, index, data);
        advancePlayerShift(playerShift, playerState, index, size);
      }

      function primeMissileClockFromRegisters(index, x, registers) {
        const data = (registers[17] & missileMasks[index]) >> (index * 2);
        const hpos = pmgStartX(registers[4 + index] & 0xff);
        const size = registers[12] & 0xff;
        if (x === hpos && data) reloadMissileShift(missileShift, missileState, index, data);
        advanceMissileShift(missileShift, missileState, index, size);
      }

      if (io.drawLine.pmgFirstVisibleSpan) {
        const drawLine = io.drawLine;
        const canReplayPmgHistory =
          !drawLine.pmgEventOverflow &&
          drawLine.pmgInitialRegisters &&
          drawLine.pmgReplayRegisters &&
          drawLine.pmgEventRegisters &&
          drawLine.pmgEventValues &&
          drawLine.pmgEventCycles;
        if (canReplayPmgHistory) {
          const replayRegisters = drawLine.pmgReplayRegisters;
          replayRegisters.set(drawLine.pmgInitialRegisters);
          let eventIndex = 0;
          for (let x = 0; x < visibleSpanStart; x += 2) {
            const lineCycle = Math.floor((x - 24) / 4);
            while (
              eventIndex < drawLine.pmgEventCount &&
              drawLine.pmgEventCycles[eventIndex] <= lineCycle
            ) {
              replayRegisters[drawLine.pmgEventRegisters[eventIndex]] =
                drawLine.pmgEventValues[eventIndex];
              eventIndex++;
            }
            primePlayerClockFromRegisters(3, x, replayRegisters);
            primePlayerClockFromRegisters(2, x, replayRegisters);
            primePlayerClockFromRegisters(1, x, replayRegisters);
            primePlayerClockFromRegisters(0, x, replayRegisters);
            primeMissileClockFromRegisters(3, x, replayRegisters);
            primeMissileClockFromRegisters(2, x, replayRegisters);
            primeMissileClockFromRegisters(1, x, replayRegisters);
            primeMissileClockFromRegisters(0, x, replayRegisters);
          }
        } else {
          for (let x = 0; x < visibleSpanStart; x += 2) {
            primePlayerClock(3, x);
            primePlayerClock(2, x);
            primePlayerClock(1, x);
            primePlayerClock(0, x);
            primeMissileClock(3, x);
            primeMissileClock(2, x);
            primeMissileClock(1, x);
            primeMissileClock(0, x);
          }
        }
        io.drawLine.pmgFirstVisibleSpan = false;
      }

      for (let x = visibleSpanStart; x < spanPixelEnd; x += 2) {
        const playfieldColors = dst[lineBase + x] | (dst[lineBase + x + 1] << 8);
        const mixModeZero = (prior & 0xcf) === 0;
        let data = sram[IO_GRAFP3_TRIG0] & 0xff;
        let hpos = pmgStartX(sram[IO_HPOSP3_M3PF] & 0xff);
        let size = sram[IO_SIZEP3_M3PL] & 0xff;
        if (x === hpos && data) reloadPlayerShift(playerShift, playerState, 3, data);
        if (playerShift[3] & 0x80) {
          playerCollision[3] |= drawPlayerClockCell(
            sram[IO_COLPM3],
            playerPriorityMask(prior, 3),
            PRIO_PM3,
            prio,
            dst,
            lineBase + x,
            special,
            0,
            playfieldColors,
            mixModeZero ? (PRIO_PF2 | PRIO_PF3 | (special ? PRIO_PF1 : 0)) : 0,
          );
        }
        advancePlayerShift(playerShift, playerState, 3, size);

        data = sram[IO_GRAFP2_P3PL] & 0xff;
        hpos = pmgStartX(sram[IO_HPOSP2_M2PF] & 0xff);
        size = sram[IO_SIZEP2_M2PL] & 0xff;
        if (x === hpos && data) reloadPlayerShift(playerShift, playerState, 2, data);
        if (playerShift[2] & 0x80) {
          playerCollision[2] |= drawPlayerClockCell(
            sram[IO_COLPM2_PAL],
            playerPriorityMask(prior, 2),
            PRIO_PM2,
            prio,
            dst,
            lineBase + x,
            special,
            prior & 0x20 ? PRIO_PM3 : 0,
            playfieldColors,
            mixModeZero ? (PRIO_PF2 | PRIO_PF3 | (special ? PRIO_PF1 : 0)) : 0,
          );
        }
        advancePlayerShift(playerShift, playerState, 2, size);

        data = sram[IO_GRAFP1_P2PL] & 0xff;
        hpos = pmgStartX(sram[IO_HPOSP1_M1PF] & 0xff);
        size = sram[IO_SIZEP1_M1PL] & 0xff;
        if (x === hpos && data) reloadPlayerShift(playerShift, playerState, 1, data);
        if (playerShift[1] & 0x80) {
          playerCollision[1] |= drawPlayerClockCell(
            sram[IO_COLPM1_TRIG3],
            playerPriorityMask(prior, 1),
            PRIO_PM1,
            prio,
            dst,
            lineBase + x,
            special,
            0,
            playfieldColors,
            mixModeZero ? (special ? 0 : PRIO_PF0 | PRIO_PF1) : 0,
          );
        }
        advancePlayerShift(playerShift, playerState, 1, size);

        data = sram[IO_GRAFP0_P1PL] & 0xff;
        hpos = pmgStartX(sram[IO_HPOSP0_M0PF] & 0xff);
        size = sram[IO_SIZEP0_M0PL] & 0xff;
        if (x === hpos && data) reloadPlayerShift(playerShift, playerState, 0, data);
        if (playerShift[0] & 0x80) {
          playerCollision[0] |= drawPlayerClockCell(
            sram[IO_COLPM0_TRIG2],
            playerPriorityMask(prior, 0),
            PRIO_PM0,
            prio,
            dst,
            lineBase + x,
            special,
            prior & 0x20 ? PRIO_PM1 : 0,
            playfieldColors,
            mixModeZero ? (special ? 0 : PRIO_PF0 | PRIO_PF1) : 0,
          );
        }
        advancePlayerShift(playerShift, playerState, 0, size);

        data = (sram[IO_GRAFM_TRIG1] & 0xc0) >> 6;
        hpos = pmgStartX(sram[IO_HPOSM3_P3PF] & 0xff);
        size = sram[IO_SIZEM_P0PL] & 0xff;
        if (x === hpos && data) reloadMissileShift(missileShift, missileState, 3, data);
        if (missileShift[3] & 0x02) {
          missileCollision[3] |= drawMissileClockCell(
            prior & 0x10 ? sram[IO_COLPF3] : sram[IO_COLPM3],
            missilePriorityMask(prior, 3),
            prio,
            dst,
            lineBase + x,
            special,
          );
        }
        advanceMissileShift(missileShift, missileState, 3, size);

        data = (sram[IO_GRAFM_TRIG1] & 0x30) >> 4;
        hpos = pmgStartX(sram[IO_HPOSM2_P2PF] & 0xff);
        if (x === hpos && data) reloadMissileShift(missileShift, missileState, 2, data);
        if (missileShift[2] & 0x02) {
          missileCollision[2] |= drawMissileClockCell(
            prior & 0x10 ? sram[IO_COLPF3] : sram[IO_COLPM2_PAL],
            missilePriorityMask(prior, 2),
            prio,
            dst,
            lineBase + x,
            special,
          );
        }
        advanceMissileShift(missileShift, missileState, 2, size);

        data = (sram[IO_GRAFM_TRIG1] & 0x0c) >> 2;
        hpos = pmgStartX(sram[IO_HPOSM1_P1PF] & 0xff);
        if (x === hpos && data) reloadMissileShift(missileShift, missileState, 1, data);
        if (missileShift[1] & 0x02) {
          missileCollision[1] |= drawMissileClockCell(
            prior & 0x10 ? sram[IO_COLPF3] : sram[IO_COLPM1_TRIG3],
            missilePriorityMask(prior, 1),
            prio,
            dst,
            lineBase + x,
            special,
          );
        }
        advanceMissileShift(missileShift, missileState, 1, size);

        data = sram[IO_GRAFM_TRIG1] & 0x03;
        hpos = pmgStartX(sram[IO_HPOSM0_P0PF] & 0xff);
        if (x === hpos && data) reloadMissileShift(missileShift, missileState, 0, data);
        if (missileShift[0] & 0x02) {
          missileCollision[0] |= drawMissileClockCell(
            prior & 0x10 ? sram[IO_COLPF3] : sram[IO_COLPM0_TRIG2],
            missilePriorityMask(prior, 0),
            prio,
            dst,
            lineBase + x,
            special,
          );
        }
        advanceMissileShift(missileShift, missileState, 0, size);
      }

      let collision = playerCollision[3] & 0xffff;
      ram[IO_HPOSM3_P3PF] |= collision & 0x0f;

      collision = playerCollision[2] & 0xffff;
      ram[IO_HPOSM2_P2PF] |= collision & 0x0f;
      if (collision & PRIO_PM3) ram[IO_GRAFP2_P3PL] |= 0x04;
      ram[IO_GRAFP1_P2PL] |= (collision >> 4) & ~0x04 & 0x0f;

      collision = playerCollision[1] & 0xffff;
      ram[IO_HPOSM1_P1PF] |= collision & 0x0f;
      if (collision & PRIO_PM3) ram[IO_GRAFP2_P3PL] |= 0x02;
      if (collision & PRIO_PM2) ram[IO_GRAFP1_P2PL] |= 0x02;
      ram[IO_GRAFP0_P1PL] |= (collision >> 4) & ~0x02 & 0x0f;

      collision = playerCollision[0] & 0xffff;
      ram[IO_HPOSM0_P0PF] |= collision & 0x0f;
      if (collision & PRIO_PM3) ram[IO_GRAFP2_P3PL] |= 0x01;
      if (collision & PRIO_PM2) ram[IO_GRAFP1_P2PL] |= 0x01;
      if (collision & PRIO_PM1) ram[IO_GRAFP0_P1PL] |= 0x01;
      ram[IO_SIZEM_P0PL] |= (collision >> 4) & ~0x01 & 0x0f;

      collision = missileCollision[3] & 0xffff;
      ram[IO_HPOSP3_M3PF] |= collision & 0x0f;
      ram[IO_SIZEP3_M3PL] |= (collision >> 4) & 0x0f;

      collision = missileCollision[2] & 0xffff;
      ram[IO_HPOSP2_M2PF] |= collision & 0x0f;
      ram[IO_SIZEP2_M2PL] |= (collision >> 4) & 0x0f;

      collision = missileCollision[1] & 0xffff;
      ram[IO_HPOSP1_M1PF] |= collision & 0x0f;
      ram[IO_SIZEP1_M1PL] |= (collision >> 4) & 0x0f;

      collision = missileCollision[0] & 0xffff;
      ram[IO_HPOSP0_M0PF] |= collision & 0x0f;
      ram[IO_SIZEP0_M0PL] |= (collision >> 4) & 0x0f;
    }

    function drawPlayerMissiles(ctx) {
      const io = ctx.ioData;
      const ram = ctx.ram;
      const sram = ctx.sram;
      const y = io.video.currentDisplayLine | 0;

      if (y >= 248) return;

      const dst = io.videoOut.pixels;
      const prio = io.videoOut.priority;
      const prior = sram[IO_PRIOR] & 0xff;
      const mode = io.currentDisplayListCommand & 0x0f;
      const special =
        (mode === 0x02 || mode === 0x03 || mode === 0x0f) &&
        (prior & 0xc0) === 0;

      // Keep the order of the players being drawn!

      // Player 3
      let data;
      let mask;
      data = sram[IO_GRAFP3_TRIG0] & 0xff;

      let hpos = sram[IO_HPOSP3_M3PF] & 0xff;
      if (data) {
        const start = y * PIXELS_PER_LINE + pmgStartX(hpos);
        if (prior & 0x01) mask = PRIO_PM0 | PRIO_PM1 | PRIO_PM2 | PRIO_M10_PM0 | PRIO_M10_PM1 | PRIO_M10_PM2;
        else if (prior & 0x02)
          {mask =
            PRIO_PM0 | PRIO_PM1 | PRIO_PF0 | PRIO_PF1 | PRIO_PF2 | PRIO_PF3 | PRIO_PM2 |
            PRIO_M10_PM0 | PRIO_M10_PM1 | PRIO_M10_PM2;}
        else if (prior & 0x04)
          {mask =
            PRIO_PF0 | PRIO_PF1 | PRIO_PF2 | PRIO_PF3 | PRIO_PM0 | PRIO_PM1 | PRIO_PM2 |
            PRIO_M10_PM0 | PRIO_M10_PM1 | PRIO_M10_PM2;}
        else if (prior & 0x08)
          {mask = PRIO_PF0 | PRIO_PF1 | PRIO_PM0 | PRIO_PM1 | PRIO_PM2 | PRIO_M10_PM0 | PRIO_M10_PM1 | PRIO_M10_PM2;}
        else mask = 0x00;

        const col = drawPlayer(
          sram[IO_COLPM3],
          sram[IO_SIZEP3_M3PL],
          data,
          mask,
          PRIO_PM3,
          prio,
          dst,
          start,
          special,
          0,
        );

        ram[IO_HPOSM3_P3PF] |= col & 0x0f;
      }

      // Player 2
      data = sram[IO_GRAFP2_P3PL] & 0xff;

      hpos = sram[IO_HPOSP2_M2PF] & 0xff;
      if (data) {
        const start2 = y * PIXELS_PER_LINE + pmgStartX(hpos);
        if (prior & 0x01) mask = PRIO_PM0 | PRIO_PM1 | PRIO_M10_PM0 | PRIO_M10_PM1;
        else if (prior & 0x02)
          {mask =
            PRIO_PM0 | PRIO_PM1 | PRIO_PF0 | PRIO_PF1 | PRIO_PF2 | PRIO_PF3 | PRIO_M10_PM0 | PRIO_M10_PM1;}
        else if (prior & 0x04)
          {mask =
            PRIO_PF0 | PRIO_PF1 | PRIO_PF2 | PRIO_PF3 | PRIO_PM0 | PRIO_PM1 | PRIO_M10_PM0 | PRIO_M10_PM1;}
        else if (prior & 0x08) mask = PRIO_PF0 | PRIO_PF1 | PRIO_PM0 | PRIO_PM1 | PRIO_M10_PM0 | PRIO_M10_PM1;
        else mask = 0x00;

        const col2 = drawPlayer(
          sram[IO_COLPM2_PAL],
          sram[IO_SIZEP2_M2PL],
          data,
          mask,
          PRIO_PM2,
          prio,
          dst,
          start2,
          special,
          prior & 0x20 ? PRIO_PM3 : 0,
        );

        ram[IO_HPOSM2_P2PF] |= col2 & 0x0f;
        if (col2 & PRIO_PM3) ram[IO_GRAFP2_P3PL] |= 0x04;
        ram[IO_GRAFP1_P2PL] |= (col2 >> 4) & ~0x04 & 0x0f;
      }

      // Player 1
      data = sram[IO_GRAFP1_P2PL] & 0xff;

      hpos = sram[IO_HPOSP1_M1PF] & 0xff;
      if (data) {
        const start1 = y * PIXELS_PER_LINE + pmgStartX(hpos);
        if (prior & 0x01) mask = PRIO_PM0 | PRIO_M10_PM0;
        else if (prior & 0x02) mask = PRIO_PM0 | PRIO_M10_PM0;
        else if (prior & 0x04)
          {mask = PRIO_PF0 | PRIO_PF1 | PRIO_PF2 | PRIO_PF3 | PRIO_PM0 | PRIO_M10_PM0;}
        else if (prior & 0x08) mask = PRIO_PF0 | PRIO_PF1 | PRIO_PM0 | PRIO_M10_PM0;
        else mask = 0x00;

        const col1 = drawPlayer(
          sram[IO_COLPM1_TRIG3],
          sram[IO_SIZEP1_M1PL],
          data,
          mask,
          PRIO_PM1,
          prio,
          dst,
          start1,
          special,
          0,
        );

        ram[IO_HPOSM1_P1PF] |= col1 & 0x0f;
        if (col1 & PRIO_PM3) ram[IO_GRAFP2_P3PL] |= 0x02;
        if (col1 & PRIO_PM2) ram[IO_GRAFP1_P2PL] |= 0x02;
        ram[IO_GRAFP0_P1PL] |= (col1 >> 4) & ~0x02 & 0x0f;
      }

      // Player 0
      data = sram[IO_GRAFP0_P1PL] & 0xff;

      hpos = sram[IO_HPOSP0_M0PF] & 0xff;
      if (data) {
        const start0 = y * PIXELS_PER_LINE + pmgStartX(hpos);
        if (prior & 0x01) mask = 0x00;
        else if (prior & 0x02) mask = 0x00;
        else if (prior & 0x04) mask = PRIO_PF0 | PRIO_PF1 | PRIO_PF2 | PRIO_PF3;
        else if (prior & 0x08) mask = PRIO_PF0 | PRIO_PF1;
        else mask = 0x00;

        const col0 = drawPlayer(
          sram[IO_COLPM0_TRIG2],
          sram[IO_SIZEP0_M0PL],
          data,
          mask,
          PRIO_PM0,
          prio,
          dst,
          start0,
          special,
          prior & 0x20 ? PRIO_PM1 : 0,
        );

        ram[IO_HPOSM0_P0PF] |= col0 & 0x0f;
        if (col0 & PRIO_PM3) ram[IO_GRAFP2_P3PL] |= 0x01;
        if (col0 & PRIO_PM2) ram[IO_GRAFP1_P2PL] |= 0x01;
        if (col0 & PRIO_PM1) ram[IO_GRAFP0_P1PL] |= 0x01;
        ram[IO_SIZEM_P0PL] |= (col0 >> 4) & ~0x01 & 0x0f;
      }

      // All missiles
      data = sram[IO_GRAFM_TRIG1] & 0xff;

      // Missile 3
      hpos = sram[IO_HPOSM3_P3PF] & 0xff;
      if (data & 0xc0) {
        const startM3 = y * PIXELS_PER_LINE + pmgStartX(hpos);
        mask = missilePriorityMask(prior, 3);

        const colM3 = drawMissile(
          3,
          prior & 0x10 ? sram[IO_COLPF3] : sram[IO_COLPM3],
          sram[IO_SIZEM_P0PL],
          data,
          mask,
          prio,
          dst,
          startM3,
          special,
          prior,
        );

        ram[IO_HPOSP3_M3PF] |= colM3 & 0x0f;
        ram[IO_SIZEP3_M3PL] |= (colM3 >> 4) & 0x0f;
      }

      // Missile 2
      hpos = sram[IO_HPOSM2_P2PF] & 0xff;
      if (data & 0x30) {
        const startM2 = y * PIXELS_PER_LINE + pmgStartX(hpos);
        mask = missilePriorityMask(prior, 2);

        const colM2 = drawMissile(
          2,
          prior & 0x10 ? sram[IO_COLPF3] : sram[IO_COLPM2_PAL],
          sram[IO_SIZEM_P0PL],
          data,
          mask,
          prio,
          dst,
          startM2,
          special,
          prior,
        );

        ram[IO_HPOSP2_M2PF] |= colM2 & 0x0f;
        ram[IO_SIZEP2_M2PL] |= (colM2 >> 4) & 0x0f;
      }

      // Missile 1
      hpos = sram[IO_HPOSM1_P1PF] & 0xff;
      if (data & 0x0c) {
        const startM1 = y * PIXELS_PER_LINE + pmgStartX(hpos);
        mask = missilePriorityMask(prior, 1);

        const colM1 = drawMissile(
          1,
          prior & 0x10 ? sram[IO_COLPF3] : sram[IO_COLPM1_TRIG3],
          sram[IO_SIZEM_P0PL],
          data,
          mask,
          prio,
          dst,
          startM1,
          special,
          prior,
        );

        ram[IO_HPOSP1_M1PF] |= colM1 & 0x0f;
        ram[IO_SIZEP1_M1PL] |= (colM1 >> 4) & 0x0f;
      }

      // Missile 0
      hpos = sram[IO_HPOSM0_P0PF] & 0xff;
      if (data & 0x03) {
        const startM0 = y * PIXELS_PER_LINE + pmgStartX(hpos);
        mask = missilePriorityMask(prior, 0);

        const colM0 = drawMissile(
          0,
          prior & 0x10 ? sram[IO_COLPF3] : sram[IO_COLPM0_TRIG2],
          sram[IO_SIZEM_P0PL],
          data,
          mask,
          prio,
          dst,
          startM0,
          special,
          prior,
        );

        ram[IO_HPOSP0_M0PF] |= colM0 & 0x0f;
        ram[IO_SIZEP0_M0PL] |= (colM0 >> 4) & 0x0f;
      }
    }

    return {
      drawPlayerMissilesClock: drawPlayerMissilesClock,
      fetchPmgDmaCycle: fetchPmgDmaCycle,
      fetchPhantomMissileDmaCycle: fetchPhantomMissileDmaCycle,
      drawPlayerMissiles: drawPlayerMissiles,
      recordPmgRegisterEvent: recordPmgRegisterEvent,
      recordPmgRegisterWrite: recordPmgRegisterWrite,
    };
  }

  window.A8EGtia = {
    createApi: createApi,
  };
})();
