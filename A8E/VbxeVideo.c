/********************************************************************
*
* VBXE (VideoBoard XE) video side - native core, stage 2.
*
* XDL parser, overlay (standard, lores, hires, text), overlay priority and
* collisions, playfield palettes, attribute map and the XDL/overlay local-bus
* slot accounting. A port of the matching parts of jsA8E/js/core/vbxe.js
* (AHRM 12.4 with the Altirra behaviors noted there).
*
* Differences from jsA8E, all on the output side:
*  - the picture is the 456-pixel ANTIC line only: hires and text overlays
*    (640 pixels) are averaged into one standard pixel, because the
*    native window has no 640-wide plane;
*  - a line is composed once when it closes, with the GTIA registers it ended
*    with, so mid-line GTIA changes are not replayed;
*  - the reverse attribute-map modes that need the raw ANTIC bit stream use
*    the plain playfield selection instead.
*
********************************************************************/

#include <string.h>

#include "Vbxe.h"

#define VBXE_FIRST_LINE 8u
#define VBXE_XDL_UPDATE_CYCLES 22u

/* GTIA layer bits, as stored in the priority plane. */
#define PRIO_PF0 0x0001u
#define PRIO_PF1 0x0002u
#define PRIO_PF2 0x0004u
#define PRIO_PF3 0x0008u
#define PRIO_PM0 0x0010u
#define PRIO_PM1 0x0020u
#define PRIO_PM2 0x0040u
#define PRIO_PM3 0x0080u
#define PRIO_M10_PM0 0x0100u
#define PRIO_M10_PM1 0x0200u
#define PRIO_M10_PM2 0x0400u
#define PRIO_M10_PM3 0x0800u
#define PRIO_PM_ALL (PRIO_PM0 | PRIO_PM1 | PRIO_PM2 | PRIO_PM3 | \
	PRIO_M10_PM0 | PRIO_M10_PM1 | PRIO_M10_PM2 | PRIO_M10_PM3)

/* Indexed by overlay width code: narrow, normal, wide. */
static const u32 m_aOverlayDmaStart[3] = { 10, 18, 26 };
static const u32 m_aOverlayMachineCycles[3] = { 64, 80, 84 };
static const u32 m_aOverlayTextSlots[3] = { 195, 243, 255 };
static const u32 m_aOverlayStandardWidth[3] = { 256, 320, 336 };
static const u32 m_aOverlayStart[3] = { 128, 96, 88 };

typedef struct
{
	u8 cControl;
	u8 cPlayfield0;
	u8 cPlayfield1;
	u8 cPlayfield2;
	u8 bReverse;
	u8 cOverlayPalette;
	u8 cPlayfieldPalette;
	u8 cPriority;
} VbxeMapCell_t;

/********************************************************************
* XDL engine
********************************************************************/

void Vbxe_XdlReset(Vbxe_t *pVbxe, u8 bVerticalSync)
{
	VbxeXdl_t tPrevious;

	if(pVbxe == NULL) return;
	tPrevious = pVbxe->tXdl;
	memset(&pVbxe->tXdl, 0, sizeof(pVbxe->tXdl));
	pVbxe->tXdl.eMode = VBXE_OVERLAY_OFF;
	pVbxe->tXdl.cOverlayWidth = 1;
	pVbxe->tXdl.cOverlayPalette = 1;
	pVbxe->tXdl.cPriority = 0xff;
	pVbxe->tXdl.cAttrCellWidth = 8;
	pVbxe->tXdl.cAttrCellHeight = 8;
	pVbxe->tXdl.lOverlayAddress = tPrevious.lOverlayAddress & 0x7ffffu;
	pVbxe->tXdl.lOverlayStride = tPrevious.lOverlayStride & 0xfffu;
	pVbxe->tXdl.lAttrAddress = tPrevious.lAttrAddress & 0x7ffffu;
	pVbxe->tXdl.lAttrStride = tPrevious.lAttrStride & 0xffcu;
	pVbxe->tXdl.lCharacterBase = tPrevious.lCharacterBase & 0x7ffffu;
	if(bVerticalSync) pVbxe->tXdl.lAddress = pVbxe->lXdlAddressActive & 0x7ffffu;
}

static u8 Vbxe_XdlRead(Vbxe_t *pVbxe)
{
	return pVbxe->pVram[(pVbxe->tXdl.lAddress++) & VBXE_VRAM_MASK];
}

static void Vbxe_LoadAttributeBuffer(Vbxe_t *pVbxe)
{
	VbxeXdl_t *pXdl = &pVbxe->tXdl;
	u32 i;

	for(i = 0; i < VBXE_ATTR_BUFFER_SIZE; i++)
	{
		pXdl->aAttrBuffer[i] = pVbxe->pVram[(pXdl->lAttrAddress + i) & VBXE_VRAM_MASK];
	}
	pXdl->bAttrBufferValid = 1;
}

static u8 Vbxe_WidthCode(u8 cWidth)
{
	return cWidth == 0 || cWidth == 3 ? 0 : (cWidth == 2 ? 2 : 1);
}

/* Decodes the next scanline's XDL state. Returns 0 when VBXE draws nothing. */
static u8 Vbxe_NextXdlLine(Vbxe_t *pVbxe, u32 lScanline, VbxeLine_t *pLine)
{
	VbxeXdl_t *pXdl = &pVbxe->tXdl;
	u8 bAttrReload = 0;

	if(!(pVbxe->cVideoControlActive & 1) || lScanline < VBXE_FIRST_LINE) return 0;
	/* Altirra applies END after the entry's complete repeat run. */
	if(pXdl->bEnded && pXdl->cRepeat == 0) return 0;

	if(pXdl->cRepeat == 0)
	{
		u8 c0 = Vbxe_XdlRead(pVbxe);
		u8 c1 = Vbxe_XdlRead(pVbxe);
		u8 cMode = c0 & 0x03;

		/* Altirra's kOvModeTable: bit 2 disables the overlay; value 3 is
		 * an invalid mode and also disables it. */
		if(c0 & 0x04)
		{
			pXdl->eMode = VBXE_OVERLAY_OFF;
			pXdl->bEnabled = 0;
		}
		else if(cMode == 1)
		{
			pXdl->eMode = VBXE_OVERLAY_TEXT;
			pXdl->bEnabled = 1;
		}
		else if(cMode == 2)
		{
			pXdl->eMode = (c1 & 0x10) ? VBXE_OVERLAY_HIRES :
				((c1 & 0x20) ? VBXE_OVERLAY_LORES : VBXE_OVERLAY_STANDARD);
			pXdl->bEnabled = 1;
		}
		else if(cMode == 3)
		{
			pXdl->eMode = VBXE_OVERLAY_OFF;
			pXdl->bEnabled = 0;
		}
		if(c0 & 0x10) pXdl->bAttrEnabled = 0;
		else if(c0 & 0x08)
		{
			/* AtMapOn restarts the buffered map row. */
			pXdl->bAttrEnabled = 1;
			bAttrReload = 1;
		}
		if(c0 & 0x10) pXdl->bAttrBufferValid = 0;
		if(c0 & 0x20) pXdl->cRepeat = Vbxe_XdlRead(pVbxe);
		if(c0 & 0x40)
		{
			u32 lLow = Vbxe_XdlRead(pVbxe);
			u32 lMid = Vbxe_XdlRead(pVbxe);
			u32 lHigh = Vbxe_XdlRead(pVbxe) & 7u;
			u32 lStrideLow = Vbxe_XdlRead(pVbxe);
			u32 lStrideHigh = Vbxe_XdlRead(pVbxe) & 15u;

			pXdl->lOverlayAddress = lLow | (lMid << 8) | (lHigh << 16);
			pXdl->lOverlayStride = lStrideLow | (lStrideHigh << 8);
		}
		if(c0 & 0x80)
		{
			pXdl->cTextScrollX = Vbxe_XdlRead(pVbxe) & 7;
			pXdl->cTextScrollY = Vbxe_XdlRead(pVbxe) & 7;
		}
		if(c1 & 0x01) pXdl->lCharacterBase = (u32)Vbxe_XdlRead(pVbxe) << 11;
		if(c1 & 0x02)
		{
			u32 lLow = Vbxe_XdlRead(pVbxe);
			u32 lMid = Vbxe_XdlRead(pVbxe);
			u32 lHigh = Vbxe_XdlRead(pVbxe) & 7u;
			u32 lStrideLow = Vbxe_XdlRead(pVbxe) & 0xfcu;
			u32 lStrideHigh = Vbxe_XdlRead(pVbxe) & 0x0fu;

			pXdl->lAttrAddress = lLow | (lMid << 8) | (lHigh << 16);
			pXdl->lAttrStride = lStrideLow | (lStrideHigh << 8);
			bAttrReload = 1;
		}
		if(c1 & 0x04)
		{
			/* Altirra latches both scroll counters verbatim (five bits). */
			pXdl->cAttrScrollX = Vbxe_XdlRead(pVbxe) & 0x1f;
			pXdl->cAttrScrollY = Vbxe_XdlRead(pVbxe) & 0x1f;
			pXdl->cAttrCellWidth = (u8)((Vbxe_XdlRead(pVbxe) & 0x1f) + 1);
			pXdl->cAttrCellHeight = (u8)((Vbxe_XdlRead(pVbxe) & 0x1f) + 1);
		}
		if(c1 & 0x08)
		{
			u8 cMisc = Vbxe_XdlRead(pVbxe);

			pXdl->cOverlayWidth = (cMisc & 0x03) == 0x03 ? 0 : (cMisc & 0x03);
			pXdl->cPlayfieldPalette = cMisc >> 6;
			pXdl->cOverlayPalette = (cMisc >> 4) & 0x03;
			pXdl->cPriority = Vbxe_XdlRead(pVbxe);
		}
		/* Every new entry restarts text at the latched vertical scroll. */
		pXdl->cTextRow = pXdl->cTextScrollY & 7;
		if(c1 & 0x80) pXdl->bEnded = 1;
		if(bAttrReload) pXdl->cAttrRow = pXdl->cAttrScrollY;
		/* AHRM 12.4: the update takes 22 local cycles whatever its size;
		 * repeated lines skip it. */
		pVbxe->lDmaSlots += VBXE_XDL_UPDATE_CYCLES;
	}
	else
	{
		pXdl->cRepeat--;
	}

	if(pXdl->bAttrEnabled && (bAttrReload || pXdl->cAttrRow == 0))
	{
		/* 43 four-byte cells are buffered during horizontal blanking, so a
		 * MEMAC write during the active line cannot change them. */
		Vbxe_LoadAttributeBuffer(pVbxe);
		bAttrReload = 1;
	}

	if(!pXdl->bEnabled && !pXdl->bAttrEnabled) return 0;

	pLine->eMode = pXdl->eMode;
	pLine->bOverlay = pXdl->bEnabled;
	pLine->lAddress = pXdl->lOverlayAddress & VBXE_VRAM_MASK;
	pLine->lStride = pXdl->lOverlayStride & 0xfffu;
	pLine->cWidthCode = Vbxe_WidthCode(pXdl->cOverlayWidth);
	pLine->cPlayfieldPalette = pXdl->cPlayfieldPalette;
	pLine->cOverlayPalette = pXdl->cOverlayPalette;
	pLine->cPriority = pXdl->cPriority;
	pLine->lCharacterBase = pXdl->lCharacterBase & VBXE_VRAM_MASK;
	pLine->cTextScrollX = pXdl->cTextScrollX & 7;
	pLine->cTextScrollY = pXdl->cTextScrollY & 7;
	pLine->cTextRow = pXdl->cTextRow & 7;
	pLine->bAttrEnabled = pXdl->bAttrEnabled;
	pLine->cAttrScrollX = pXdl->cAttrScrollX;
	pLine->cAttrCellWidth = pXdl->cAttrCellWidth;
	pLine->cAttrCellHeight = pXdl->cAttrCellHeight;
	pLine->cAttrRow = pXdl->cAttrRow;
	pLine->bAttrReload = bAttrReload;

	if(pXdl->bEnabled)
	{
		if(pXdl->eMode == VBXE_OVERLAY_TEXT)
		{
			pXdl->cTextRow = (pXdl->cTextRow + 1) & 7;
			if(pXdl->cTextRow == 0)
				pXdl->lOverlayAddress = (pXdl->lOverlayAddress + pXdl->lOverlayStride) & VBXE_VRAM_MASK;
		}
		else
		{
			pXdl->lOverlayAddress = (pXdl->lOverlayAddress + pXdl->lOverlayStride) & VBXE_VRAM_MASK;
		}
	}
	if(pXdl->bAttrEnabled)
	{
		/* Altirra's mAttrRow is a five-bit counter; the row address
		 * advances only when it reaches the cell height. */
		pXdl->cAttrRow = (pXdl->cAttrRow + 1) & 0x1f;
		if(pXdl->cAttrRow == pXdl->cAttrCellHeight)
		{
			pXdl->cAttrRow = 0;
			pXdl->lAttrAddress = (pXdl->lAttrAddress + pXdl->lAttrStride) & VBXE_VRAM_MASK;
		}
	}
	return 1;
}

/********************************************************************
* Local-bus slots used by the display DMA of a line
********************************************************************/

static u32 Vbxe_LineDmaSlots(const VbxeLine_t *pLine)
{
	u32 lSlots = 0;

	if(pLine->bOverlay)
	{
		lSlots += pLine->eMode == VBXE_OVERLAY_TEXT ? m_aOverlayTextSlots[pLine->cWidthCode] :
			m_aOverlayMachineCycles[pLine->cWidthCode] * (pLine->eMode == VBXE_OVERLAY_LORES ? 2u : 4u);
	}
	if(pLine->bAttrEnabled && (pLine->bAttrReload || pLine->cAttrRow == 0))
	{
		lSlots += VBXE_ATTR_BUFFER_SIZE;
	}
	return lSlots;
}

/********************************************************************
* Priority, transparency and collisions
********************************************************************/

static u8 Vbxe_CollisionBits(u32 lPriority, u8 cGtiaMode)
{
	u8 cResult = 0;

	/* In GTIA's special modes an active input expands to the whole group
	 * (Altirra FX 1.26 mode-F probes). */
	if(lPriority != 0 && cGtiaMode == 2) return 0x7f;
	if(lPriority & (PRIO_PM0 | PRIO_M10_PM0)) cResult |= 0x01;
	if(lPriority & (PRIO_PM1 | PRIO_M10_PM1)) cResult |= 0x02;
	if(lPriority & (PRIO_PM2 | PRIO_M10_PM2)) cResult |= 0x04;
	if(lPriority & (PRIO_PM3 | PRIO_M10_PM3)) cResult |= 0x08;
	if(lPriority & PRIO_PF0) cResult |= 0x10;
	if(lPriority & PRIO_PF1) cResult |= 0x20;
	if(lPriority & (PRIO_PF2 | PRIO_PF3)) cResult |= 0x40;
	return cResult;
}

static u8 Vbxe_OverlayWins(VbxeProfile_t eProfile, u32 lPriority, u8 cMask)
{
	if(eProfile == VBXE_PROFILE_FX120 || eProfile == VBXE_PROFILE_FX124)
	{
		/* AHRM table 109: pre-1.26 boards have no background priority bit. */
		return lPriority == 0 ||
			((lPriority & PRIO_PF2) && (cMask & 0x40)) ||
			((lPriority & PRIO_PF3) && (cMask & 0x80));
	}
	if(lPriority == 0) return (cMask & 0x80) != 0;
	return ((lPriority & 0x01) && (cMask & 0x10)) ||
		((lPriority & 0x02) && (cMask & 0x20)) ||
		((lPriority & 0x0c) && (cMask & 0x40)) ||
		((lPriority & 0x10) && (cMask & 0x01)) ||
		((lPriority & 0x20) && (cMask & 0x02)) ||
		((lPriority & 0x40) && (cMask & 0x04)) ||
		((lPriority & 0x80) && (cMask & 0x08));
}

/* 0 opaque, 1 color 0 transparent, 3 colors 0 and 15 transparent. VIDEO_CONTROL
 * D2 set = opaque (Altirra; the AHRM prose has the polarity reversed). */
static u8 Vbxe_Transparency(const Vbxe_t *pVbxe)
{
	if(pVbxe->cVideoControlActive & 0x04) return 0;
	return (pVbxe->cVideoControlActive & 0x08) ? 3 : 1;
}

static uint32_t Vbxe_Argb(const Vbxe_t *pVbxe, u32 lPalette, u32 lColor)
{
	const u8 *pRgb = &pVbxe->aPalette[(lPalette * 256u + lColor) * 3u];

	return 0xff000000u | ((u32)pRgb[0] << 16) | ((u32)pRgb[1] << 8) | pRgb[2];
}

/********************************************************************
* Attribute map
********************************************************************/

static s32 Vbxe_AttrEffectiveScroll(const VbxeLine_t *pLine)
{
	s32 lRaw = pLine->cAttrScrollX & 0x1f;

	return lRaw >= (s32)pLine->cAttrCellWidth ? lRaw - 32 : lRaw;
}

static u8 Vbxe_MapCell(const Vbxe_t *pVbxe, const VbxeLine_t *pLine, s32 lStandardX,
	VbxeMapCell_t *pCell)
{
	s32 lWidth = pLine->cAttrCellWidth;
	s32 lHeight = pLine->cAttrCellHeight;
	s32 lX;
	s32 lColumn;
	const u8 *pData;

	if(!pLine->bAttrEnabled || lWidth < 1 || lWidth > 32 || lHeight < 1 || lHeight > 32) return 0;
	lX = lStandardX + Vbxe_AttrEffectiveScroll(pLine);
	/* A negative overscroll keeps using the first buffered cell. */
	lColumn = lX < 0 ? 0 : lX / lWidth;
	if(lColumn >= 43) return 0;
	pData = &pVbxe->tXdl.aAttrBuffer[lColumn * 4];
	if(!pVbxe->tXdl.bAttrBufferValid) return 0;
	pCell->cPlayfield0 = pData[0];
	pCell->cPlayfield1 = pData[1];
	pCell->cPlayfield2 = pData[2];
	pCell->cControl = pData[3];
	pCell->bReverse = (pData[3] & 0x04) != 0;
	pCell->cPlayfieldPalette = (pData[3] >> 6) & 0x03;
	pCell->cOverlayPalette = (pData[3] >> 4) & 0x03;
	pCell->cPriority = pVbxe->cPriority[pData[3] & 0x03];
	return 1;
}

/* The PF3 bitmap starts at the left edge of each scrolled cell and is sampled
 * at 1, 2 or 4 standard pixels per bit according to the cell width. */
static u8 Vbxe_MapPf3Bit(const VbxeLine_t *pLine, s32 lStandardX, u8 cMask)
{
	s32 lWidth = pLine->cAttrCellWidth;
	s32 lRemainder;
	s32 lBitWidth;

	if(cMask == 0 || lWidth < 1 || lWidth > 32) return 0;
	lRemainder = (lStandardX + Vbxe_AttrEffectiveScroll(pLine)) % lWidth;
	if(lRemainder < 0) lRemainder += lWidth;
	lBitWidth = lWidth <= 8 ? 1 : (lWidth <= 16 ? 2 : 4);
	return (cMask & (1u << (7 - lRemainder / lBitWidth))) != 0;
}

/********************************************************************
* Overlay
********************************************************************/

static void Vbxe_Composite(Vbxe_t *pVbxe, const VbxeLine_t *pLine, uint32_t *pTarget,
	u32 lPriority, u32 lColor, s32 lColor2, u8 cSourceByte, const VbxeMapCell_t *pCell)
{
	u32 lPalette = pLine->cOverlayPalette;
	u8 cMask = pLine->cPriority;

	if(pCell != NULL)
	{
		if(pCell->cControl & 0x08) pVbxe->cCollisionDetect |= 0x80;
		lPalette = pCell->cOverlayPalette;
		cMask = pCell->cPriority;
	}
	/* COLMASK selects source-byte ranges; collisions do not depend on the
	 * overlay winning the priority comparison. */
	if(pVbxe->cCollisionMask & (1u << (cSourceByte >> 5)))
	{
		pVbxe->cCollisionDetect |= Vbxe_CollisionBits(lPriority, pLine->cGtiaMode);
	}
	if(Vbxe_OverlayWins(pVbxe->eProfile, lPriority, cMask))
	{
		uint32_t lArgb = Vbxe_Argb(pVbxe, lPalette, lColor);

		/* A 640-pixel source pair is averaged into one native pixel. */
		if(lColor2 >= 0)
		{
			uint32_t lOther = Vbxe_Argb(pVbxe, lPalette, (u32)lColor2);

			lArgb = 0xff000000u |
				((((lArgb & 0xff0000u) + (lOther & 0xff0000u)) >> 1) & 0xff0000u) |
				((((lArgb & 0x00ff00u) + (lOther & 0x00ff00u)) >> 1) & 0x00ff00u) |
				((((lArgb & 0x0000ffu) + (lOther & 0x0000ffu)) >> 1) & 0x0000ffu);
		}
		*pTarget = lArgb;
	}
}

/* Color and collision byte of one 640-grid text pixel. Returns 0 if transparent. */
static u8 Vbxe_TextPixel(const Vbxe_t *pVbxe, const VbxeLine_t *pLine, u32 lSourceX,
	u8 cTransparency, u32 *pColor, u8 *pSourceByte)
{
	/* cTextRow already starts at the latched vertical scroll. */
	u32 lSourceRow = pLine->cTextRow;
	u32 lRowAddress = (pLine->lAddress + (lSourceRow >> 3) * pLine->lStride) & VBXE_VRAM_MASK;
	u32 lCellAddress = (lRowAddress + ((lSourceX >> 3) << 1)) & VBXE_VRAM_MASK;
	u8 cCharacter = pVbxe->pVram[lCellAddress];
	u8 cAttribute = pVbxe->pVram[(lCellAddress + 1) & VBXE_VRAM_MASK];
	u8 cGlyph = pVbxe->pVram[(pLine->lCharacterBase + ((u32)cCharacter << 3) + (lSourceRow & 7)) & VBXE_VRAM_MASK];
	u8 cForeground = cAttribute & 0x7f;
	u8 bGlyphSet = (cGlyph & (0x80u >> (lSourceX & 7))) != 0;
	u32 lColor;

	if(!bGlyphSet && !(cAttribute & 0x80) && cTransparency >= 1) return 0;
	lColor = bGlyphSet ? cForeground : ((cAttribute & 0x80) ? (u32)(cForeground | 0x80) : 0x80u);
	if(lColor == 0 && cTransparency >= 1) return 0;
	*pColor = lColor;
	*pSourceByte = cAttribute;
	return 1;
}

static void Vbxe_RenderOverlay(Vbxe_t *pVbxe, const VbxeLine_t *pLine, u32 lScanline,
	const u16 *pPriority)
{
	uint32_t *pRow = pVbxe->pOverlay + (size_t)lScanline * VBXE_LINE_PIXELS;
	u32 lStart = m_aOverlayStart[pLine->cWidthCode];
	u32 lWidth = m_aOverlayStandardWidth[pLine->cWidthCode];
	u8 cTransparency = Vbxe_Transparency(pVbxe);
	u32 x;

	for(x = 0; x < lWidth; x++)
	{
		u32 lColor = 0;
		s32 lColor2 = -1;
		u8 cSourceByte = 0;
		u8 bVisible = 0;
		VbxeMapCell_t tCell;
		u8 bCell;

		if(pLine->eMode == VBXE_OVERLAY_TEXT)
		{
			u32 lFirst = 0;
			u32 lSecond = 0;
			u8 bFirst = Vbxe_TextPixel(pVbxe, pLine, x * 2 + pLine->cTextScrollX,
				cTransparency, &lFirst, &cSourceByte);
			u8 bSecond = Vbxe_TextPixel(pVbxe, pLine, x * 2 + 1 + pLine->cTextScrollX,
				cTransparency, &lSecond, &cSourceByte);

			bVisible = bFirst || bSecond;
			lColor = bFirst ? lFirst : lSecond;
			if(bFirst && bSecond) lColor2 = (s32)lSecond;
		}
		else if(pLine->eMode == VBXE_OVERLAY_HIRES)
		{
			u32 lFirst;
			u32 lSecond;
			u8 bFirst;
			u8 bSecond;

			cSourceByte = pVbxe->pVram[(pLine->lAddress + x) & VBXE_VRAM_MASK];
			lFirst = cSourceByte >> 4;
			lSecond = cSourceByte & 0x0fu;
			bFirst = !((lFirst == 0 && cTransparency >= 1) || (cTransparency == 3 && lFirst == 0x0f));
			bSecond = !((lSecond == 0 && cTransparency >= 1) || (cTransparency == 3 && lSecond == 0x0f));
			bVisible = bFirst || bSecond;
			lColor = bFirst ? lFirst : lSecond;
			if(bFirst && bSecond) lColor2 = (s32)lSecond;
		}
		else
		{
			u32 lSourceX = pLine->eMode == VBXE_OVERLAY_LORES ? x >> 1 : x;

			cSourceByte = pVbxe->pVram[(pLine->lAddress + lSourceX) & VBXE_VRAM_MASK];
			lColor = cSourceByte;
			bVisible = !((lColor == 0 && cTransparency >= 1) ||
				(cTransparency == 3 && (lColor & 0x0f) == 0x0f));
		}
		if(!bVisible) continue;
		bCell = Vbxe_MapCell(pVbxe, pLine, (s32)x, &tCell);
		Vbxe_Composite(pVbxe, pLine, &pRow[lStart + x], pPriority[lStart + x],
			lColor, lColor2, cSourceByte, bCell ? &tCell : NULL);
	}
}

/********************************************************************
* Playfield palette and attribute map recoloring
********************************************************************/

static void Vbxe_ApplyDefaultPalette(const Vbxe_t *pVbxe, const VbxeLine_t *pLine, uint32_t *pRow,
	const u8 *pPixels, const u16 *pPriority)
{
	u32 lStart = m_aOverlayStart[pLine->cWidthCode];
	u32 lWidth = m_aOverlayStandardWidth[pLine->cWidthCode];
	u8 bExtended = (pVbxe->cVideoControlActive & 0x02) != 0;
	u32 x;

	if(pLine->cPlayfieldPalette == 0) return;
	for(x = 0; x < lWidth; x++)
	{
		u32 lPixel = lStart + x;
		u32 lColor;

		if(pLine->bOverlay && pRow[lPixel] != 0) continue;
		/* A player/missile that won GTIA priority is never recolored. */
		if(pPriority[lPixel] & PRIO_PM_ALL) continue;
		lColor = bExtended ? pPixels[lPixel] : (u32)(pPixels[lPixel] & 0xfe);
		pRow[lPixel] = Vbxe_Argb(pVbxe, pLine->cPlayfieldPalette, lColor);
	}
}

/* Reverse cells reinterpret what ANTIC drew. The raw source bits are not kept
 * natively, so they are rebuilt from the GTIA layer of each pixel: for hires a
 * lit pixel is PF1 and an unlit one PF2; for lores 0 is background and PF0,
 * PF1, PF2/PF3 are the values 1, 2 and 3. */
static s32 Vbxe_HiresSourceBit(const u16 *pPriority, u32 lPixel)
{
	if(pPriority[lPixel] & PRIO_PF1) return 1;
	if(pPriority[lPixel] & PRIO_PF2) return 0;
	return -1;
}

static s32 Vbxe_LoresSourceValue(const u16 *pPriority, u32 lPixel)
{
	if(pPriority[lPixel] & PRIO_PF0) return 1;
	if(pPriority[lPixel] & PRIO_PF1) return 2;
	if(pPriority[lPixel] & (PRIO_PF2 | PRIO_PF3)) return 3;
	return 0;
}

/* AHRM 4.2: reverse groups the hires bit stream into PF0-PF3 pairs. */
static s32 Vbxe_ReverseHiresColor(const VbxeLine_t *pLine, const VbxeMapCell_t *pCell,
	const u16 *pPriority, u32 lPixel)
{
	u32 lPair = lPixel & ~1u;
	s32 lLeft = Vbxe_HiresSourceBit(pPriority, lPair);
	s32 lRight = Vbxe_HiresSourceBit(pPriority, lPair + 1);

	if(lLeft < 0 || lRight < 0) return -1;
	switch((lLeft << 1) | lRight)
	{
	case 0: return pCell->cPlayfield0;
	case 1: return pCell->cPlayfield1;
	case 2: return pCell->cPlayfield2;
	default: return pLine->cPf3;
	}
}

/* Rev turns a two-bit lores value into two hires samples: its high and low
 * bits pick the PF1 luminance over a PF2 base for the even and odd pixel. */
static s32 Vbxe_ReverseLoresColor(const VbxeMapCell_t *pCell, const u16 *pPriority, u32 lPixel)
{
	s32 lSource = Vbxe_LoresSourceValue(pPriority, lPixel);
	s32 lBit = (lPixel & 1) == 0 ? (lSource >> 1) & 1 : lSource & 1;

	return lBit ? (s32)((pCell->cPlayfield2 & 0xf0) | (pCell->cPlayfield1 & 0x0f)) :
		pCell->cPlayfield2;
}

static void Vbxe_ApplyAttributeMap(const Vbxe_t *pVbxe, const VbxeLine_t *pLine, uint32_t *pRow,
	const u16 *pPriority)
{
	u32 lStart = m_aOverlayStart[pLine->cWidthCode];
	u32 lWidth = m_aOverlayStandardWidth[pLine->cWidthCode];
	u8 bExtended = (pVbxe->cVideoControlActive & 0x02) != 0;
	u8 bAnticHires = pLine->cAnticMode == 0x02 || pLine->cAnticMode == 0x03 ||
		pLine->cAnticMode == 0x0f;
	u8 bAnticLores = pLine->cAnticMode >= 0x04 && pLine->cAnticMode <= 0x0e;
	u32 x;

	for(x = 0; x < lWidth; x++)
	{
		u32 lPixel = lStart + x;
		u32 lVisible = pPriority[lPixel];
		VbxeMapCell_t tCell;
		s32 lColor = -1;

		if(pLine->bOverlay && pRow[lPixel] != 0) continue;
		if(!Vbxe_MapCell(pVbxe, pLine, (s32)x, &tCell)) continue;
		if(tCell.bReverse && pLine->cGtiaMode == 0 && bAnticHires)
		{
			lColor = Vbxe_ReverseHiresColor(pLine, &tCell, pPriority, lPixel);
		}
		else if(tCell.bReverse && pLine->cGtiaMode == 0 && bAnticLores)
		{
			lColor = Vbxe_ReverseLoresColor(&tCell, pPriority, lPixel);
		}
		else if(!tCell.bReverse && bAnticHires && (lVisible & PRIO_PF2) &&
		   Vbxe_MapPf3Bit(pLine, (s32)x, tCell.cPlayfield0))
		{
			lColor = pLine->cPf3;
		}
		else if(lVisible & PRIO_PF0) lColor = tCell.cPlayfield0;
		else if(lVisible & PRIO_PF1) lColor = tCell.cPlayfield1;
		else if(lVisible & PRIO_PF2) lColor = tCell.cPlayfield2;
		if(lColor < 0) continue;
		lColor = bExtended ? (lColor & 0xff) : (lColor & 0xfe);
		pRow[lPixel] = Vbxe_Argb(pVbxe, tCell.cPlayfieldPalette, (u32)lColor);
	}
}

/********************************************************************
* Entry points
********************************************************************/

void Vbxe_ComposeLine(Vbxe_t *pVbxe, u32 lScanline, const u8 *pPixels,
	const u16 *pPriority, u8 cAnticMode, u8 cPf3, u8 cGtiaMode)
{
	VbxeLine_t tLine;
	uint32_t *pRow;

	if(pVbxe == NULL || !pVbxe->bEnabled || lScanline >= VBXE_LINES) return;
	pRow = pVbxe->pOverlay + (size_t)lScanline * VBXE_LINE_PIXELS;
	pVbxe->lDmaSlots = 0;
	/* Present nothing for a line when XDL is off, and drop stale output. */
	if(pVbxe->bOverlayDirty)
	{
		memset(pRow, 0, VBXE_LINE_PIXELS * sizeof(uint32_t));
	}
	if(!Vbxe_NextXdlLine(pVbxe, lScanline, &tLine)) return;

	tLine.cAnticMode = cAnticMode & 0x0f;
	tLine.cPf3 = cPf3;
	tLine.cGtiaMode = cGtiaMode & 0x03;
	pVbxe->lDmaSlots += Vbxe_LineDmaSlots(&tLine);
	pVbxe->bOverlayDirty = 1;
	if(tLine.bOverlay &&
	   (tLine.eMode == VBXE_OVERLAY_STANDARD || tLine.eMode == VBXE_OVERLAY_LORES ||
	    tLine.eMode == VBXE_OVERLAY_HIRES || tLine.eMode == VBXE_OVERLAY_TEXT))
	{
		Vbxe_RenderOverlay(pVbxe, &tLine, lScanline, pPriority);
	}
	if(tLine.bAttrEnabled) Vbxe_ApplyAttributeMap(pVbxe, &tLine, pRow, pPriority);
	else Vbxe_ApplyDefaultPalette(pVbxe, &tLine, pRow, pPixels, pPriority);
}

const uint32_t *Vbxe_OverlayLine(const Vbxe_t *pVbxe, u32 lScanline)
{
	if(pVbxe == NULL || !pVbxe->bEnabled || !pVbxe->bOverlayDirty ||
	   lScanline >= VBXE_LINES) return NULL;
	return pVbxe->pOverlay + (size_t)lScanline * VBXE_LINE_PIXELS;
}
