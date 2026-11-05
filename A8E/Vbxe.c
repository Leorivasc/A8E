/********************************************************************
*
* VBXE (VideoBoard XE) device - native core, stages 1 and 2 (video: VbxeVideo.c).
* See Vbxe.h for the scope and implementation/VBXE_ROADMAP.md.
*
* The blitter, MEMAC and register rules are a direct port of
* jsA8E/js/core/vbxe.js so both cores behave the same.
*
********************************************************************/

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

#include "AtariIo.h"
#include "Pia.h"
#include "Vbxe.h"

#define VBXE_BCB_SIZE 21u

static Vbxe_t *Vbxe_Of(_6502_Context_t *pContext)
{
	return ((IoData_t *)pContext->pIoData)->pVbxe;
}

VbxeProfile_t Vbxe_ParseProfile(const char *pName)
{
	if(pName == NULL || pName[0] == '\0') return VBXE_PROFILE_FX126;
	if(strcasecmp(pName, "fx1.20") == 0 || strcasecmp(pName, "1.20") == 0 || strcasecmp(pName, "fx120") == 0)
		return VBXE_PROFILE_FX120;
	if(strcasecmp(pName, "fx1.24") == 0 || strcasecmp(pName, "1.24") == 0 || strcasecmp(pName, "fx124") == 0)
		return VBXE_PROFILE_FX124;
	if(strcasecmp(pName, "fx1.26") == 0 || strcasecmp(pName, "1.26") == 0 || strcasecmp(pName, "fx126") == 0)
		return VBXE_PROFILE_FX126;
	return VBXE_PROFILE_OFF;
}

Vbxe_t *Vbxe_Create(VbxeProfile_t eProfile, u16 sPage)
{
	Vbxe_t *pVbxe;

	if(eProfile == VBXE_PROFILE_OFF) return NULL;
	pVbxe = (Vbxe_t *)calloc(1, sizeof(Vbxe_t));
	if(pVbxe == NULL) return NULL;
	pVbxe->pVram = (u8 *)calloc(1, VBXE_VRAM_SIZE);
	pVbxe->pWindowInstalled = (u8 *)calloc(1, 0x10000);
	pVbxe->pFetchWindow = (u8 *)calloc(1, 0x10000);
	pVbxe->pOverlay = (uint32_t *)calloc((size_t)VBXE_LINE_PIXELS * VBXE_LINES, sizeof(uint32_t));
	if(!pVbxe->pVram || !pVbxe->pWindowInstalled || !pVbxe->pFetchWindow || !pVbxe->pOverlay)
	{
		Vbxe_Free(pVbxe);
		return NULL;
	}
	pVbxe->bEnabled = 1;
	pVbxe->eProfile = eProfile;
	pVbxe->sPage = sPage == VBXE_PAGE_D7 ? VBXE_PAGE_D7 : VBXE_PAGE_D6;
	return pVbxe;
}

void Vbxe_Free(Vbxe_t *pVbxe)
{
	if(pVbxe == NULL) return;
	free(pVbxe->pVram);
	free(pVbxe->pWindowInstalled);
	free(pVbxe->pFetchWindow);
	free(pVbxe->pOverlay);
	free(pVbxe);
}

/********************************************************************
* Reset and vertical sync
********************************************************************/

void Vbxe_SoftReset(Vbxe_t *pVbxe)
{
	if(pVbxe == NULL) return;
	/* Altirra WarmReset: stop XDL and the blitter, drop the IRQ state, turn
	 * the MEMAC windows off but keep their bank/base latches, COLDETECT and
	 * the XDL address latch. */
	pVbxe->cVideoControlPending = 0;
	pVbxe->cVideoControlActive = 0;
	Vbxe_XdlReset(pVbxe, 0);
	pVbxe->lDmaSlots = 0;
	pVbxe->cBlitCollisionCode = 0;
	pVbxe->cBlitterBusy = 0;
	pVbxe->cIrqStatus = 0;
	pVbxe->cIrqControl = 0;
	pVbxe->bBlitterIrqPending = 0;
	pVbxe->bBlitterIrqScheduled = 0;
	pVbxe->lBlitterIrqResidual = 0;
	pVbxe->bBlitterEarlyRun = 0;
	pVbxe->lMemacSlots = 0;
	pVbxe->cMemacBControl &= 0x3f;
	pVbxe->cMemacControl &= 0xf3;
	pVbxe->cMemacBankSelect &= 0x7f;
}

void Vbxe_VerticalSync(Vbxe_t *pVbxe)
{
	if(pVbxe == NULL || !pVbxe->bEnabled) return;
	/* AHRM 12.4: only the XDL enable bit (D0) is buffered until VSync. */
	pVbxe->cVideoControlActive =
		(u8)((pVbxe->cVideoControlActive & 0x0e) | (pVbxe->cVideoControlPending & 0x01));
	pVbxe->lXdlAddressActive = pVbxe->lXdlAddressPending & 0x7ffffu;
	/* The overlay and attribute-map address/stride latches survive VSync. */
	Vbxe_XdlReset(pVbxe, 1);
}

/********************************************************************
* MEMAC
********************************************************************/

s32 Vbxe_MemacAddress(const Vbxe_t *pVbxe, u16 sAddress, u8 bAntic)
{
	u32 lAccessBit = bAntic ? 0x04u : 0x08u;
	u32 lSize;
	u32 lBase;

	if(pVbxe == NULL || !pVbxe->bEnabled) return -1;
	lSize = 0x1000u << (pVbxe->cMemacControl & 0x03u);
	lBase = (u32)(pVbxe->cMemacControl & 0xf0u) << 8;
	if((pVbxe->cMemacBankSelect & 0x80u) != 0 &&
	   (pVbxe->cMemacControl & lAccessBit) != 0 &&
	   sAddress >= lBase && (u32)sAddress - lBase < lSize)
	{
		u32 lVramBase = (((u32)(pVbxe->cMemacBankSelect & 0x7fu)) << 12) & ~(lSize - 1u);
		return (s32)((lVramBase + sAddress - lBase) & VBXE_VRAM_MASK);
	}
	/* Altirra maps bit 7 to CPU read/write and bit 6 to ANTIC DMA, which is
	 * the reverse of the AHRM text table. */
	if(sAddress >= 0x4000u && sAddress < 0x8000u &&
	   (pVbxe->cMemacBControl & (bAntic ? 0x40u : 0x80u)) != 0)
	{
		return (s32)((((u32)(pVbxe->cMemacBControl & 0x1fu) << 14) + sAddress - 0x4000u) &
			VBXE_VRAM_MASK);
	}
	return -1;
}

static u8 *Vbxe_MemacAccess(_6502_Context_t *pContext, u8 *pValue)
{
	Vbxe_t *pVbxe = Vbxe_Of(pContext);
	u16 sAddress = pContext->sAccessAddress;
	s32 lVram = Vbxe_MemacAddress(pVbxe, sAddress, 0);

	if(lVram < 0)
	{
		/* The window was closed but the bus has not been re-synchronized yet. */
		if(pValue) pContext->pMemory[sAddress] = *pValue;
		return &pContext->pMemory[sAddress];
	}
	if(pVbxe->lMemacSlots < VBXE_LOCAL_BUS_SLOTS) pVbxe->lMemacSlots++;
	if(pValue) pVbxe->pVram[lVram] = *pValue;
	return &pVbxe->pVram[lVram];
}

/* Only the enable bits, the MEMAC A base/size/access bits and the MEMAC B
 * enables decide which addresses are claimed; the bank numbers do not. */
static u32 Vbxe_WindowKey(const Vbxe_t *pVbxe)
{
	return 0x1000000u | (u32)pVbxe->cMemacControl |
		((u32)(pVbxe->cMemacBankSelect & 0x80u) << 1) |
		((u32)(pVbxe->cMemacBControl & 0xc0u) << 9);
}

void Vbxe_RebuildWindows(_6502_Context_t *pContext)
{
	Vbxe_t *pVbxe = Vbxe_Of(pContext);

	if(pVbxe == NULL) return;
	pVbxe->lWindowKey = 0;
	Vbxe_SyncWindows(pContext);
}

void Vbxe_SyncWindows(_6502_Context_t *pContext)
{
	Vbxe_t *pVbxe = Vbxe_Of(pContext);
	u32 lAddress;

	if(pVbxe == NULL) return;
	if(pVbxe->lWindowKey == Vbxe_WindowKey(pVbxe)) return;
	pVbxe->lWindowKey = Vbxe_WindowKey(pVbxe);
	/* Give the addresses we own back to RAM, unless another mapping (ROM,
	 * I/O) has since replaced our handler, then claim the ones the current
	 * registers route to VRAM. Only RAM-mapped addresses can be replaced:
	 * ROM and the hardware pages keep priority. */
	for(lAddress = 0; lAddress < 0x10000u; lAddress++)
	{
		if(pVbxe->pWindowInstalled[lAddress] &&
		   _6502_GetAccess(pContext, (u16)lAddress) == Vbxe_MemacAccess)
			_6502_SetRam(pContext, (u16)lAddress, (u16)lAddress);
		pVbxe->pWindowInstalled[lAddress] = 0;
		pVbxe->pFetchWindow[lAddress] = 0;
	}
	pVbxe->bAnyFetchWindow = 0;
	if(!pVbxe->bEnabled) return;
	for(lAddress = 0; lAddress < 0x10000u; lAddress++)
	{
		if(lAddress >= 0xd000u && lAddress < 0xd800u) continue;
		if(!_6502_IsRamAccess(pContext, (u16)lAddress)) continue;
		if(Vbxe_MemacAddress(pVbxe, (u16)lAddress, 0) < 0) continue;
		_6502_SetIo(pContext, (u16)lAddress, Vbxe_MemacAccess);
		pVbxe->pWindowInstalled[lAddress] = 1;
		pVbxe->pFetchWindow[lAddress] = 1;
		pVbxe->bAnyFetchWindow = 1;
	}
}

/* The CPU fetches opcodes and operands straight from RAM[]. While a MEMAC
 * window covers the program counter, put the instruction bytes from VRAM
 * there for the duration of the instruction and restore the RAM after it. */
static void Vbxe_StageFetch(_6502_Context_t *pContext, u16 sPc)
{
	Vbxe_t *pVbxe = Vbxe_Of(pContext);
	u32 lIndex;

	if(pVbxe == NULL || !pVbxe->bAnyFetchWindow) return;
	for(lIndex = 0; lIndex < 3; lIndex++)
	{
		u16 sAddress = (u16)(sPc + lIndex);
		if(pVbxe->pFetchWindow[sAddress])
		{
			s32 lVram = Vbxe_MemacAddress(pVbxe, sAddress, 0);
			pVbxe->aFetchSave[lIndex] = pContext->pMemory[sAddress];
			if(lVram >= 0) pContext->pMemory[sAddress] = pVbxe->pVram[lVram];
		}
	}
}

static void Vbxe_RestoreFetch(_6502_Context_t *pContext, u16 sPc)
{
	Vbxe_t *pVbxe = Vbxe_Of(pContext);
	u32 lIndex;

	if(pVbxe == NULL || !pVbxe->bAnyFetchWindow) return;
	for(lIndex = 0; lIndex < 3; lIndex++)
	{
		u16 sAddress = (u16)(sPc + lIndex);
		if(pVbxe->pFetchWindow[sAddress])
			pContext->pMemory[sAddress] = pVbxe->aFetchSave[lIndex];
	}
}

/********************************************************************
* Blitter (AHRM 12.4)
********************************************************************/

static s32 Vbxe_Signed(u32 lValue, u32 lBits)
{
	u32 lSign = 1u << (lBits - 1u);
	return (lValue & lSign) != 0 ? (s32)lValue - (s32)(lSign << 1) : (s32)lValue;
}

static void Vbxe_LoadBlitterBlock(Vbxe_t *pVbxe)
{
	VbxeBlitter_t *pWork = &pVbxe->tBlit;
	u8 aBlock[VBXE_BCB_SIZE];
	u32 lIndex;
	u32 lAddress = pWork->lBlockAddress & VBXE_VRAM_MASK;

	for(lIndex = 0; lIndex < VBXE_BCB_SIZE; lIndex++)
		aBlock[lIndex] = pVbxe->pVram[(lAddress + lIndex) & VBXE_VRAM_MASK];

	pWork->lBlockAddress = lAddress;
	pWork->lLoadCyclesRemaining = 0;
	pWork->lSource = ((u32)aBlock[0] | ((u32)aBlock[1] << 8) | ((u32)aBlock[2] << 16)) & VBXE_VRAM_MASK;
	pWork->lSourceYStep = Vbxe_Signed((u32)aBlock[3] | (((u32)aBlock[4] & 0x1fu) << 8), 13);
	pWork->lSourceXStep = Vbxe_Signed(aBlock[5], 8);
	pWork->lDestination = ((u32)aBlock[6] | ((u32)aBlock[7] << 8) | ((u32)aBlock[8] << 16)) & VBXE_VRAM_MASK;
	pWork->lDestinationYStep = Vbxe_Signed((u32)aBlock[9] | (((u32)aBlock[10] & 0x1fu) << 8), 13);
	pWork->lDestinationXStep = Vbxe_Signed(aBlock[11], 8);
	pWork->lWidth = 1u + aBlock[12] + (((u32)aBlock[13] & 0x01u) << 8);
	pWork->lHeight = 1u + aBlock[14];
	pWork->cDataAnd = aBlock[15];
	pWork->cDataXor = aBlock[16];
	pWork->cCollisionMask = aBlock[17];
	pWork->cZoomX = (u8)(1u + (aBlock[18] & 0x07u));
	pWork->cZoomY = (u8)(1u + ((aBlock[18] >> 4) & 0x07u));
	pWork->bPatternEnabled = (u8)((aBlock[19] & 0x80u) != 0);
	pWork->cPatternWidth = (u8)(1u + (aBlock[19] & 0x3fu));
	pWork->cMode = (u8)(aBlock[20] & 0x07u);
	pWork->bNext = (u8)((aBlock[20] & 0x08u) != 0);
	pWork->bConstantFetchPending = (u8)(aBlock[15] == 0);
	pWork->lX = 0;
	pWork->lY = 0;
	pWork->cRepeatX = 0;
	pWork->cRepeatY = 0;
	pVbxe->cBlitterBusy = 0x02;
}

/* AHRM 12.4: bit n enables destination values $20n-$20n+1F, $00 is
 * transparent (bit 0 covers $01-1F, bit 1 covers $20-3F). */
static u8 Vbxe_ByteCollisionEnabled(u8 cMask, u8 cValue)
{
	return (u8)(cValue != 0 && (cMask & (1u << (cValue >> 5))) != 0);
}

static u8 Vbxe_NibbleCollisionEnabled(u8 cMask, u8 cValue)
{
	return (u8)(cValue != 0 && (cMask & (1u << (cValue == 1 ? 0 : cValue >> 1))) != 0);
}

static void Vbxe_RecordByteCollision(Vbxe_t *pVbxe, u8 cSource, u8 cDestination)
{
	if(pVbxe->cBlitCollisionCode == 0 && cSource != 0 &&
	   Vbxe_ByteCollisionEnabled(pVbxe->tBlit.cCollisionMask, cDestination))
		pVbxe->cBlitCollisionCode = cDestination;
}

static void Vbxe_RecordNibbleCollision(Vbxe_t *pVbxe, u8 cSource, u8 cDestination, u8 bHigh)
{
	u8 cSourceNibble = bHigh ? (u8)(cSource >> 4) : (u8)(cSource & 0x0f);
	u8 cDestinationNibble = bHigh ? (u8)(cDestination >> 4) : (u8)(cDestination & 0x0f);

	if(pVbxe->cBlitCollisionCode == 0 && cSourceNibble != 0 &&
	   Vbxe_NibbleCollisionEnabled(pVbxe->tBlit.cCollisionMask, cDestinationNibble))
		pVbxe->cBlitCollisionCode = bHigh ? (u8)(cDestination & 0xf0) : (u8)(cDestination & 0x0f);
}

static u8 Vbxe_ApplyOperation(Vbxe_t *pVbxe, u8 cSource, u8 cDestination)
{
	switch(pVbxe->tBlit.cMode)
	{
	case 0:
		return cSource;
	case 1:
		if(cSource == 0) return cDestination;
		Vbxe_RecordByteCollision(pVbxe, cSource, cDestination);
		return cSource;
	case 2:
		Vbxe_RecordByteCollision(pVbxe, cSource, cDestination);
		return (u8)(cDestination + cSource);
	case 3:
		Vbxe_RecordByteCollision(pVbxe, cSource, cDestination);
		return (u8)(cDestination | cSource);
	case 4:
		Vbxe_RecordByteCollision(pVbxe, cSource, cDestination);
		return (u8)(cDestination & cSource);
	case 5:
		Vbxe_RecordByteCollision(pVbxe, cSource, cDestination);
		return (u8)(cDestination ^ cSource);
	case 6:
		Vbxe_RecordNibbleCollision(pVbxe, cSource, cDestination, 1);
		Vbxe_RecordNibbleCollision(pVbxe, cSource, cDestination, 0);
		return (u8)(((cSource & 0xf0) ? (cSource & 0xf0) : (cDestination & 0xf0)) |
			((cSource & 0x0f) ? (cSource & 0x0f) : (cDestination & 0x0f)));
	default:
		return cDestination;
	}
}

/* AHRM 12.4, table 113: local-VRAM cost of one completed output byte. A
 * skipped source fetch saves one cycle but cannot go below one. */
static u32 Vbxe_ByteCycles(const VbxeBlitter_t *pWork, u8 cSource, u8 bSourceFetchSkipped)
{
	u32 lCycles;

	switch(pWork->cMode)
	{
	case 0: lCycles = 2; break;
	case 1: lCycles = cSource == 0 ? 1 : (pWork->cCollisionMask ? 3 : 2); break;
	case 2:
	case 3:
	case 5:
	case 6: lCycles = cSource == 0 ? 1 : 3; break;
	case 4: lCycles = cSource == 0 ? 2 : 3; break;
	default: lCycles = 3; break;
	}
	if(bSourceFetchSkipped) lCycles--;
	return lCycles < 1 ? 1 : lCycles;
}

static void Vbxe_FinishBlock(Vbxe_t *pVbxe, u8 bDeferIrq)
{
	VbxeBlitter_t *pWork = &pVbxe->tBlit;

	if(pWork->bNext)
	{
		/* Every linked BCB is a new blit with its own collision result. */
		u32 lNext = (pWork->lBlockAddress + VBXE_BCB_SIZE) & VBXE_VRAM_MASK;
		pVbxe->cBlitCollisionCode = 0;
		memset(pWork, 0, sizeof(*pWork));
		pWork->lBlockAddress = lNext;
		pWork->lLoadCyclesRemaining = VBXE_BCB_SIZE;
		pVbxe->cBlitterBusy = 0x01;
		return;
	}
	pVbxe->cBlitterBusy = 0;
	if(pVbxe->cIrqControl & 0x01)
	{
		if(bDeferIrq) pVbxe->bBlitterIrqPending = 1;
		else pVbxe->cIrqStatus = 0x01;
	}
}

/* Advances the blitter by up to lBudget local-bus slots. */
static void Vbxe_Advance(Vbxe_t *pVbxe, u32 lBudget, u8 bDeferIrq)
{
	u32 lRemaining = lBudget;

	if(pVbxe == NULL || !pVbxe->bEnabled) return;
	while(lRemaining > 0 && pVbxe->cBlitterBusy != 0)
	{
		VbxeBlitter_t *pWork = &pVbxe->tBlit;
		u32 lSourceX, lOutputX, lOutputY, lSourceAddress, lDestinationAddress, lCycles;
		u8 cSource, bSourceFetchSkipped;

		if(pVbxe->cBlitterBusy == 0x01)
		{
			u32 lLoad = pWork->lLoadCyclesRemaining;
			if(lRemaining < lLoad)
			{
				pWork->lLoadCyclesRemaining = lLoad - lRemaining;
				break;
			}
			lRemaining -= lLoad;
			Vbxe_LoadBlitterBlock(pVbxe);
			continue;
		}
		/* A constant-source BCB pays one initial source-read cycle; later
		 * output bytes reuse the value at the reduced AHRM cost. */
		if(pWork->bConstantFetchPending)
		{
			lRemaining--;
			pWork->bConstantFetchPending = 0;
			continue;
		}
		lSourceX = pWork->bPatternEnabled ? pWork->lX % pWork->cPatternWidth : pWork->lX;
		lSourceAddress = (u32)((s32)pWork->lSource + (s32)pWork->lY * pWork->lSourceYStep +
			(s32)lSourceX * pWork->lSourceXStep) & VBXE_VRAM_MASK;
		lOutputX = pWork->lX * pWork->cZoomX + pWork->cRepeatX;
		lOutputY = pWork->lY * pWork->cZoomY + pWork->cRepeatY;
		lDestinationAddress = (u32)((s32)pWork->lDestination + (s32)lOutputY * pWork->lDestinationYStep +
			(s32)lOutputX * pWork->lDestinationXStep) & VBXE_VRAM_MASK;
		cSource = (u8)((pVbxe->pVram[lSourceAddress] & pWork->cDataAnd) ^ pWork->cDataXor);
		bSourceFetchSkipped = (u8)(pWork->cDataAnd == 0 || pWork->cRepeatX != 0);
		lCycles = Vbxe_ByteCycles(pWork, cSource, bSourceFetchSkipped);
		if(lRemaining < lCycles) break;
		lRemaining -= lCycles;
		pVbxe->pVram[lDestinationAddress] = Vbxe_ApplyOperation(
			pVbxe, cSource, pVbxe->pVram[lDestinationAddress]);
		if(++pWork->cRepeatX < pWork->cZoomX) continue;
		pWork->cRepeatX = 0;
		if(++pWork->lX < pWork->lWidth) continue;
		pWork->lX = 0;
		if(++pWork->cRepeatY < pWork->cZoomY) continue;
		pWork->cRepeatY = 0;
		if(++pWork->lY < pWork->lHeight) continue;
		Vbxe_FinishBlock(pVbxe, bDeferIrq);
		if(pVbxe->bBlitterIrqPending) pVbxe->lBlitterIrqResidual = lRemaining;
	}
}

/* The line budget is whole-scanline but the completion signal appears part
 * way through it: hand the residue back so the machine can place the IRQ. */
static s32 Vbxe_ScheduleIrq(Vbxe_t *pVbxe)
{
	s32 lResidual;

	if(pVbxe == NULL || !pVbxe->bBlitterIrqPending) return -1;
	lResidual = (s32)pVbxe->lBlitterIrqResidual;
	pVbxe->bBlitterIrqPending = 0;
	pVbxe->bBlitterIrqScheduled = 1;
	pVbxe->lBlitterIrqResidual = 0;
	return lResidual;
}

u8 Vbxe_RaiseScheduledIrq(Vbxe_t *pVbxe)
{
	if(pVbxe == NULL || !pVbxe->bBlitterIrqScheduled) return 0;
	pVbxe->bBlitterIrqScheduled = 0;
	pVbxe->cIrqStatus = 0x01;
	return 1;
}

u8 Vbxe_IrqAsserted(const Vbxe_t *pVbxe)
{
	return (u8)(pVbxe != NULL && pVbxe->bEnabled &&
		(pVbxe->cIrqStatus & pVbxe->cIrqControl & 0x01) != 0);
}

s32 Vbxe_EndOfLine(Vbxe_t *pVbxe)
{
	u32 lBudget;

	if(pVbxe == NULL || !pVbxe->bEnabled) return -1;
	/* The blitter only gets what MEMAC and the display DMA (XDL entry,
	 * overlay fetch, attribute row) leave free on the local bus. */
	lBudget = pVbxe->lMemacSlots + pVbxe->lDmaSlots < VBXE_LOCAL_BUS_SLOTS ?
		VBXE_LOCAL_BUS_SLOTS - pVbxe->lMemacSlots - pVbxe->lDmaSlots : 0;
	pVbxe->lMemacSlots = 0;
	pVbxe->lDmaSlots = 0;
	/* A blit started earlier in this line already ran its share. */
	if(pVbxe->bBlitterEarlyRun) pVbxe->bBlitterEarlyRun = 0;
	else Vbxe_Advance(pVbxe, lBudget, 1);
	return Vbxe_ScheduleIrq(pVbxe);
}

s32 Vbxe_StartBlitterMidLine(Vbxe_t *pVbxe, u32 lSlotsLeftInLine)
{
	if(pVbxe == NULL || pVbxe->cBlitterBusy == 0) return -1;
	/* Altirra runs the rest of the scanline's budget when BLITTER_START is
	 * written, so a program that polls the collision code right away sees
	 * the rows completed in that slice. */
	pVbxe->bBlitterEarlyRun = 1;
	Vbxe_Advance(pVbxe, lSlotsLeftInLine < VBXE_LOCAL_BUS_SLOTS ? lSlotsLeftInLine
		: VBXE_LOCAL_BUS_SLOTS, 1);
	return Vbxe_ScheduleIrq(pVbxe);
}

static void Vbxe_StartBlitter(Vbxe_t *pVbxe)
{
	if(pVbxe->cBlitterBusy != 0) return;
	pVbxe->cBlitCollisionCode = 0;
	memset(&pVbxe->tBlit, 0, sizeof(pVbxe->tBlit));
	pVbxe->tBlit.lBlockAddress = pVbxe->lBlitAddress & VBXE_VRAM_MASK;
	pVbxe->tBlit.lLoadCyclesRemaining = VBXE_BCB_SIZE;
	pVbxe->cBlitterBusy = 0x01;
}

static void Vbxe_StopBlitter(Vbxe_t *pVbxe)
{
	pVbxe->cBlitterBusy = 0;
	/* BLITTER_START=0 cancels a queued completion event but does not
	 * acknowledge an IRQ that already fired; IRQ_CONTROL does that. */
	pVbxe->bBlitterIrqPending = 0;
	pVbxe->bBlitterIrqScheduled = 0;
	pVbxe->lBlitterIrqResidual = 0;
}

/********************************************************************
* Registers ($D640-$D65F, or $D740-$D75F)
********************************************************************/

static u32 Vbxe_PaletteOffset(const Vbxe_t *pVbxe)
{
	return ((u32)(pVbxe->cPaletteSelect & 0x03u) * 256u + pVbxe->cColorSelect) * 3u;
}

static u8 Vbxe_ReadRegister(Vbxe_t *pVbxe, u32 lRegister)
{
	switch(lRegister)
	{
	/* Altirra 4.40 reports $10 for every revision; the $11 in older AHRM
	 * text is not returned by it. */
	case 0x00: return 0x10;
	case 0x01:
		return pVbxe->eProfile == VBXE_PROFILE_FX120 ? 0x20
			: pVbxe->eProfile == VBXE_PROFILE_FX124 ? 0x24 : 0x26;
	case 0x0a: return pVbxe->cCollisionDetect;
	case 0x10: return pVbxe->cBlitCollisionCode;
	/* Bit 0: control-block load, bit 1: data processing; never both. */
	case 0x13: return (u8)(pVbxe->cBlitterBusy & 0x03);
	case 0x14: return (u8)(pVbxe->cIrqStatus & 0x01);
	case 0x1e: return pVbxe->cMemacControl;
	case 0x1f: return pVbxe->cMemacBankSelect;
	default: return 0xff;
	}
}

/* Returns a bit set of what the caller must do afterwards. */
#define VBXE_AFTER_SYNC_WINDOWS 0x01u
#define VBXE_AFTER_RECONCILE_IRQ 0x02u
#define VBXE_AFTER_START_BLIT 0x04u

static u32 Vbxe_WriteRegister(Vbxe_t *pVbxe, u32 lRegister, u8 cValue)
{
	u32 lAfter = 0;

	switch(lRegister)
	{
	case 0x00:
		pVbxe->cVideoControlPending = (u8)(cValue & 0x0f);
		/* D1-D3 apply at once, only the XDL enable waits for VSync. */
		pVbxe->cVideoControlActive = (u8)((pVbxe->cVideoControlActive & 0x01) | (cValue & 0x0e));
		break;
	case 0x01:
		pVbxe->lXdlAddressPending = (pVbxe->lXdlAddressPending & 0x7ff00u) | cValue;
		break;
	case 0x02:
		pVbxe->lXdlAddressPending = (pVbxe->lXdlAddressPending & 0x700ffu) | ((u32)cValue << 8);
		break;
	case 0x03:
		pVbxe->lXdlAddressPending = (pVbxe->lXdlAddressPending & 0x0ffffu) | ((u32)(cValue & 0x07u) << 16);
		break;
	case 0x04:
		pVbxe->cColorSelect = cValue;
		break;
	case 0x05:
		pVbxe->cPaletteSelect = (u8)(cValue & 0x03);
		break;
	case 0x06:
	case 0x07:
	case 0x08:
		/* The FPGA stores seven bits per component; Altirra expands D7 into D0. */
		pVbxe->aPalette[Vbxe_PaletteOffset(pVbxe) + (lRegister - 0x06u)] =
			(u8)((cValue & 0xfe) | (cValue >> 7));
		if(lRegister == 0x08) pVbxe->cColorSelect = (u8)(pVbxe->cColorSelect + 1);
		break;
	case 0x09:
		pVbxe->cCollisionMask = cValue;
		break;
	case 0x0a:
		pVbxe->cCollisionDetect = 0;
		break;
	case 0x10:
	case 0x11:
	case 0x12:
	{
		u32 lShift = (lRegister - 0x10u) * 8u;
		u32 lByte = lRegister == 0x12 ? (u32)(cValue & 0x07u) : cValue;
		pVbxe->lBlitAddress = ((pVbxe->lBlitAddress & ~(0xffu << lShift)) | (lByte << lShift)) &
			VBXE_VRAM_MASK;
		break;
	}
	case 0x13:
		if((cValue & 0x01) == 0)
		{
			Vbxe_StopBlitter(pVbxe);
		}
		else if(pVbxe->cBlitterBusy == 0)
		{
			Vbxe_StartBlitter(pVbxe);
			lAfter |= VBXE_AFTER_START_BLIT;
		}
		break;
	case 0x14:
		pVbxe->cIrqControl = (u8)(cValue & 0x01);
		pVbxe->cIrqStatus = 0;
		pVbxe->bBlitterIrqPending = 0;
		pVbxe->bBlitterIrqScheduled = 0;
		lAfter |= VBXE_AFTER_RECONCILE_IRQ;
		break;
	case 0x15:
	case 0x16:
	case 0x17:
	case 0x18:
		pVbxe->cPriority[lRegister - 0x15u] = cValue;
		break;
	case 0x1d:
		pVbxe->cMemacBControl = cValue;
		lAfter |= VBXE_AFTER_SYNC_WINDOWS;
		break;
	case 0x1e:
		pVbxe->cMemacControl = cValue;
		lAfter |= VBXE_AFTER_SYNC_WINDOWS;
		break;
	case 0x1f:
		pVbxe->cMemacBankSelect = cValue;
		lAfter |= VBXE_AFTER_SYNC_WINDOWS;
		break;
	default:
		break;
	}
	return lAfter;
}

static u8 *Vbxe_RegisterAccess(_6502_Context_t *pContext, u8 *pValue)
{
	Vbxe_t *pVbxe = Vbxe_Of(pContext);
	u32 lAddress = pContext->sAccessAddress;
	u32 lConfigBase = ((u32)pVbxe->sPage & 0xff00u) | 0x00c0u;

	if(lAddress >= lConfigBase && lAddress < lConfigBase + 0x40u)
	{
		/* Configuration serial pins (DATA0/DCLK//CONFIG, D0-D2): a latch
		 * that CONF_DONE never leaves, like Altirra's mConfigLatch. */
		if(pValue) pVbxe->cConfigLatch = (u8)(*pValue & 0x07);
		pVbxe->cRegisterValue = pValue ? 0xff : (u8)(pVbxe->cConfigLatch & 0x07);
		return &pVbxe->cRegisterValue;
	}
	if(pValue == NULL)
	{
		pVbxe->cRegisterValue = Vbxe_ReadRegister(pVbxe, (lAddress - pVbxe->sPage) & 0x1fu);
		return &pVbxe->cRegisterValue;
	}
	{
		u32 lAfter = Vbxe_WriteRegister(pVbxe, (lAddress - pVbxe->sPage) & 0x1fu, *pValue);

		if(lAfter & VBXE_AFTER_SYNC_WINDOWS) Vbxe_SyncWindows(pContext);
		if(lAfter & VBXE_AFTER_START_BLIT) AtariIoVbxeBlitterStarted(pContext);
		if(lAfter & VBXE_AFTER_RECONCILE_IRQ) Pia_ReconcileIrq(pContext);
	}
	pVbxe->cRegisterValue = 0xff;
	return &pVbxe->cRegisterValue;
}

/* Altirra resets the device on a write anywhere in $D080-$D0FF. */
static u8 *Vbxe_ResetStrobe(_6502_Context_t *pContext, u8 *pValue)
{
	Vbxe_t *pVbxe = Vbxe_Of(pContext);

	if(pValue == NULL) return &pContext->pMemory[pContext->sAccessAddress];
	Vbxe_SoftReset(pVbxe);
	Vbxe_SyncWindows(pContext);
	Pia_ReconcileIrq(pContext);
	pVbxe->cRegisterValue = 0xff;
	return &pVbxe->cRegisterValue;
}

void Vbxe_Attach(_6502_Context_t *pContext)
{
	Vbxe_t *pVbxe = Vbxe_Of(pContext);
	u32 lAddress;
	u32 lConfigBase;

	if(pVbxe == NULL) return;
	for(lAddress = pVbxe->sPage; lAddress < (u32)pVbxe->sPage + VBXE_REGISTER_COUNT; lAddress++)
		_6502_SetIo(pContext, (u16)lAddress, Vbxe_RegisterAccess);
	lConfigBase = ((u32)pVbxe->sPage & 0xff00u) | 0x00c0u;
	for(lAddress = lConfigBase; lAddress < lConfigBase + 0x40u; lAddress++)
		_6502_SetIo(pContext, (u16)lAddress, Vbxe_RegisterAccess);
	for(lAddress = 0xd080u; lAddress <= 0xd0ffu; lAddress++)
		_6502_SetIo(pContext, (u16)lAddress, Vbxe_ResetStrobe);
	pContext->pfnFetchStage = Vbxe_StageFetch;
	pContext->pfnFetchRestore = Vbxe_RestoreFetch;
	Vbxe_RebuildWindows(pContext);
}
