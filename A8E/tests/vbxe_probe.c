#include <stdio.h>
#include <string.h>

#include <SDL2/SDL.h>

#include "6502.h"
#include "Antic.h"
#include "AtariIo.h"
#include "Pia.h"
#include "Vbxe.h"

SDL_Window *g_pSdlWindow = NULL;

#define REQUIRE(condition, format, ...)                                  \
	do                                                                     \
	{                                                                      \
		if(!(condition))                                                     \
		{                                                                   \
			fprintf(stderr, "%s: " format "\n", __func__, ##__VA_ARGS__); \
			return 0;                                                         \
		}                                                                   \
	} while(0)

static u8 BusRead(_6502_Context_t *pContext, u16 sAddress)
{
	pContext->sAccessAddress = sAddress;
	return *pContext->pAccessFunctionList[sAddress](pContext, NULL);
}

static void BusWrite(_6502_Context_t *pContext, u16 sAddress, u8 cValue)
{
	pContext->sAccessAddress = sAddress;
	pContext->pAccessFunctionList[sAddress](pContext, &cValue);
}

static _6502_Context_t *OpenMachine(VbxeProfile_t eProfile, u16 sPage)
{
	_6502_Context_t *pContext = _6502_Open();

	if(pContext == NULL) return NULL;
	AtariIoOpenWithMemory(pContext, 0, NULL, ATARI_VIDEO_PAL, ATARI_MEMORY_NONE);
	AtariIoEnableVbxe(pContext, eProfile, sPage);
	/* The CPU is not running: charge instructions one cycle and start the
	 * line at cycle 0 so START sees a whole scanline of budget unless a test
	 * moves the beam. */
	((IoData_t *)pContext->pIoData)->llDisplayListFetchCycle = 0;
	((IoData_t *)pContext->pIoData)->llCycle = 0;
	pContext->cCurrentInstructionCycles = 1;
	return pContext;
}

static void CloseMachine(_6502_Context_t *pContext)
{
	AtariIoClose(pContext);
	_6502_Close(pContext);
}

static void WriteBcb(
	Vbxe_t *pVbxe, u32 lAddress, u32 lSource, u32 lDestination,
	u32 lWidth, u32 lHeight, u8 cAnd, u8 cXor, u8 cCollisionMask, u8 cMode)
{
	u8 *pBlock = &pVbxe->pVram[lAddress];

	memset(pBlock, 0, 21);
	pBlock[0] = (u8)lSource; pBlock[1] = (u8)(lSource >> 8); pBlock[2] = (u8)(lSource >> 16);
	pBlock[3] = (u8)lWidth; /* source Y step */
	pBlock[5] = 1;          /* source X step */
	pBlock[6] = (u8)lDestination; pBlock[7] = (u8)(lDestination >> 8); pBlock[8] = (u8)(lDestination >> 16);
	pBlock[9] = (u8)lWidth; /* destination Y step */
	pBlock[11] = 1;         /* destination X step */
	pBlock[12] = (u8)(lWidth - 1u);
	pBlock[14] = (u8)(lHeight - 1u);
	pBlock[15] = cAnd;
	pBlock[16] = cXor;
	pBlock[17] = cCollisionMask;
	pBlock[18] = 0;
	pBlock[20] = cMode;
}

static void SetBlitAddress(_6502_Context_t *pContext, u32 lAddress)
{
	u16 sPage = ((IoData_t *)pContext->pIoData)->pVbxe->sPage;

	BusWrite(pContext, (u16)(sPage + 0x10), (u8)lAddress);
	BusWrite(pContext, (u16)(sPage + 0x11), (u8)(lAddress >> 8));
	BusWrite(pContext, (u16)(sPage + 0x12), (u8)(lAddress >> 16));
}

static int TestRegisterRevisions(void)
{
	static const struct { VbxeProfile_t eProfile; u8 cMinor; } aCases[] = {
		{VBXE_PROFILE_FX120, 0x20}, {VBXE_PROFILE_FX124, 0x24}, {VBXE_PROFILE_FX126, 0x26}};
	u32 lIndex;

	for(lIndex = 0; lIndex < 3; lIndex++)
	{
		_6502_Context_t *pContext = OpenMachine(aCases[lIndex].eProfile, VBXE_PAGE_D6);
		REQUIRE(pContext != NULL, "machine open failed");
		REQUIRE(BusRead(pContext, 0xd640) == 0x10, "CORE_REVISION is not $10");
		REQUIRE(BusRead(pContext, 0xd641) == aCases[lIndex].cMinor,
				"MINOR_REVISION is %02X, expected %02X", BusRead(pContext, 0xd641), aCases[lIndex].cMinor);
		REQUIRE(BusRead(pContext, 0xd642) == 0xff, "unassigned register does not read $FF");
		CloseMachine(pContext);
	}
	{
		_6502_Context_t *pContext = OpenMachine(VBXE_PROFILE_FX126, VBXE_PAGE_D7);
		REQUIRE(pContext != NULL, "machine open failed");
		REQUIRE(BusRead(pContext, 0xd740) == 0x10, "$D740 page does not answer");
		CloseMachine(pContext);
	}
	return 1;
}

static int TestPaletteLatch(void)
{
	_6502_Context_t *pContext = OpenMachine(VBXE_PROFILE_FX126, VBXE_PAGE_D6);
	Vbxe_t *pVbxe;

	REQUIRE(pContext != NULL, "machine open failed");
	pVbxe = ((IoData_t *)pContext->pIoData)->pVbxe;
	BusWrite(pContext, 0xd644, 0x10);
	BusWrite(pContext, 0xd645, 0x02);
	BusWrite(pContext, 0xd646, 0xff);
	BusWrite(pContext, 0xd647, 0x80);
	BusWrite(pContext, 0xd648, 0x7e);
	/* Seven stored bits: D7 is copied into D0. CSEL advances after blue. */
	REQUIRE(pVbxe->aPalette[(2 * 256 + 0x10) * 3 + 0] == 0xff, "red D7 not expanded");
	REQUIRE(pVbxe->aPalette[(2 * 256 + 0x10) * 3 + 1] == 0x81, "green D7 not expanded");
	REQUIRE(pVbxe->aPalette[(2 * 256 + 0x10) * 3 + 2] == 0x7e, "blue changed");
	REQUIRE(pVbxe->cColorSelect == 0x11, "CSEL did not advance after blue");
	CloseMachine(pContext);
	return 1;
}

static int TestMemacWindows(void)
{
	_6502_Context_t *pContext = OpenMachine(VBXE_PROFILE_FX126, VBXE_PAGE_D6);
	Vbxe_t *pVbxe;

	REQUIRE(pContext != NULL, "machine open failed");
	pVbxe = ((IoData_t *)pContext->pIoData)->pVbxe;
	pContext->pMemory[0x9000] = 0x11;

	/* MEMAC A: 4 KiB at $9000, CPU access, bank 3 (VRAM $3000). */
	BusWrite(pContext, 0xd65e, 0x98);
	BusWrite(pContext, 0xd65f, 0x83);
	BusWrite(pContext, 0x9004, 0xa5);
	REQUIRE(pVbxe->pVram[0x3004] == 0xa5, "write through MEMAC A did not reach VRAM");
	REQUIRE(pContext->pMemory[0x9004] == 0x00, "write through MEMAC A also changed RAM");
	pVbxe->pVram[0x3000] = 0x5a;
	REQUIRE(BusRead(pContext, 0x9000) == 0x5a, "read through MEMAC A did not come from VRAM");
	REQUIRE(BusRead(pContext, 0x9fff) == pVbxe->pVram[0x3fff], "window end does not reach VRAM");
	REQUIRE(BusRead(pContext, 0xa000) == pContext->pMemory[0xa000],
			"address above the window is claimed");

	/* A window address that is turned off returns to the RAM underneath. */
	BusWrite(pContext, 0xd65f, 0x03);
	REQUIRE(BusRead(pContext, 0x9000) == 0x11, "closed window did not return to RAM");
	BusWrite(pContext, 0x9000, 0x22);
	REQUIRE(pContext->pMemory[0x9000] == 0x22, "write after closing the window missed RAM");

	/* MEMAC B: bit 7 is CPU access, 16 KiB at $4000, bank 2 (VRAM $8000). */
	BusWrite(pContext, 0xd65d, 0x82);
	BusWrite(pContext, 0x4001, 0x77);
	REQUIRE(pVbxe->pVram[0x8001] == 0x77, "write through MEMAC B did not reach VRAM");
	/* Bit 6 alone is ANTIC access; the CPU still sees RAM. */
	BusWrite(pContext, 0xd65d, 0x42);
	pContext->pMemory[0x4001] = 0x33;
	REQUIRE(BusRead(pContext, 0x4001) == 0x33, "ANTIC-only MEMAC B captured a CPU read");
	BusWrite(pContext, 0xd65d, 0x00);

	/* ROM keeps priority over a window: the OS ROM stays visible at $C000. */
	BusWrite(pContext, 0xd65e, 0xc8);
	BusWrite(pContext, 0xd65f, 0x80);
	pVbxe->pVram[0x0000] = 0xee;
	REQUIRE(BusRead(pContext, 0xc000) == pContext->pMemory[0xc000] &&
			pContext->pMemory[0xc000] != 0xee, "a window replaced ROM");
	/* The hardware pages keep priority too. */
	BusWrite(pContext, 0xd65e, 0xd8);
	REQUIRE(BusRead(pContext, 0xd640) == 0x10, "a window replaced the VBXE registers");
	CloseMachine(pContext);
	return 1;
}

static int TestInstructionFetchFromWindow(void)
{
	_6502_Context_t *pContext = OpenMachine(VBXE_PROFILE_FX126, VBXE_PAGE_D6);
	Vbxe_t *pVbxe;
	static const u8 aProgram[] = {0xa9, 0x42, 0x8d, 0x00, 0x06}; /* LDA #$42 / STA $0600 */

	REQUIRE(pContext != NULL, "machine open failed");
	pVbxe = ((IoData_t *)pContext->pIoData)->pVbxe;
	memcpy(&pVbxe->pVram[0x3000], aProgram, sizeof(aProgram));
	pContext->pMemory[0x9000] = 0xea;
	pContext->pMemory[0x9001] = 0xea;
	BusWrite(pContext, 0xd65e, 0x98);
	BusWrite(pContext, 0xd65f, 0x83);
	pContext->tCpu.pc = 0x9000;
	pContext->llStallCycleCounter = 0;
	_6502_Execute(pContext);
	_6502_Execute(pContext);
	REQUIRE(pContext->pMemory[0x0600] == 0x42,
			"program in VRAM window did not run (got %02X)", pContext->pMemory[0x0600]);
	REQUIRE(pContext->pMemory[0x9000] == 0xea && pContext->pMemory[0x9001] == 0xea,
			"fetch staging left the RAM under the window modified");
	CloseMachine(pContext);
	return 1;
}

static int TestAnticReadsThroughWindow(void)
{
	_6502_Context_t *pContext = OpenMachine(VBXE_PROFILE_FX126, VBXE_PAGE_D6);
	IoData_t *pIoData;
	Vbxe_t *pVbxe;

	REQUIRE(pContext != NULL, "machine open failed");
	pIoData = (IoData_t *)pContext->pIoData;
	pVbxe = pIoData->pVbxe;
	pContext->pShadowMemory[IO_DMACTL] = 0x23;
	pContext->pMemory[0x9000] = 0x11;
	pVbxe->pVram[0x3000] = 0x99;
	/* ANTIC-only MEMAC A (bit 2): ANTIC sees VRAM, the CPU keeps RAM. */
	BusWrite(pContext, 0xd65e, 0x94);
	BusWrite(pContext, 0xd65f, 0x83);
	pIoData->llDisplayListFetchCycle = 0;
	pIoData->llCycle = 0;
	REQUIRE(AtariIoTimingProbeFetchUnbufferedDisplayByte(pContext, 0x9000, 0) == 0x99,
			"ANTIC did not read VRAM through MEMAC A");
	REQUIRE(BusRead(pContext, 0x9000) == 0x11, "ANTIC-only window changed what the CPU reads");
	/* CPU-only (bit 3): ANTIC keeps seeing RAM. */
	BusWrite(pContext, 0xd65e, 0x98);
	REQUIRE(AtariIoTimingProbeFetchUnbufferedDisplayByte(pContext, 0x9000, 0) == 0x11,
			"CPU-only window leaked into ANTIC reads");
	CloseMachine(pContext);
	return 1;
}

static void RunLines(Vbxe_t *pVbxe, u32 lLines)
{
	u32 lLine;

	for(lLine = 0; lLine < lLines && pVbxe->cBlitterBusy; lLine++)
		Vbxe_EndOfLine(pVbxe);
}

static int TestBlitterCopyAndIrq(void)
{
	_6502_Context_t *pContext = OpenMachine(VBXE_PROFILE_FX126, VBXE_PAGE_D6);
	Vbxe_t *pVbxe;
	u32 lIndex;

	REQUIRE(pContext != NULL, "machine open failed");
	pVbxe = ((IoData_t *)pContext->pIoData)->pVbxe;
	for(lIndex = 0; lIndex < 16 * 4; lIndex++)
		pVbxe->pVram[0x2000 + lIndex] = (u8)(lIndex + 1);
	/* 16x4 copy, mode 0, source $2000 -> destination $4000, BCB at $1000. */
	WriteBcb(pVbxe, 0x1000, 0x2000, 0x4000, 16, 4, 0xff, 0x00, 0x00, 0);
	SetBlitAddress(pContext, 0x1000);
	BusWrite(pContext, 0xd654, 0x01); /* IRQ_CONTROL: enable completion IRQ */
	BusWrite(pContext, 0xd653, 0x01); /* BLITTER_START */
	/* START already ran this scanline's budget: 21-cycle load + 64 bytes * 2. */
	REQUIRE(BusRead(pContext, 0xd653) == 0, "blit did not finish within one scanline");
	for(lIndex = 0; lIndex < 16 * 4; lIndex++)
		REQUIRE(pVbxe->pVram[0x4000 + lIndex] == (u8)(lIndex + 1), "copied byte %u is wrong", (unsigned)lIndex);
	REQUIRE(pVbxe->cBlitCollisionCode == 0, "collision code set by a plain copy");
	/* The completion lands inside the line; the IRQ is level-sensitive. */
	REQUIRE(((IoData_t *)pContext->pIoData)->llVbxeIrqCycle != CYCLE_NEVER,
			"completion IRQ was not placed inside the line");
	REQUIRE(!Pia_IrqAsserted(pContext), "IRQ asserted before its cycle");
	REQUIRE(Vbxe_RaiseScheduledIrq(pVbxe), "no scheduled IRQ to raise");
	REQUIRE(Pia_IrqAsserted(pContext), "completion did not assert the CPU IRQ line");
	REQUIRE((BusRead(pContext, 0xd654) & 1) == 1, "IRQ_STATUS not set");
	BusWrite(pContext, 0xd654, 0x01); /* acknowledge */
	REQUIRE(!Pia_IrqAsserted(pContext), "IRQ_CONTROL write did not acknowledge");
	CloseMachine(pContext);
	return 1;
}

static int TestBlitterBudgetAcrossLines(void)
{
	_6502_Context_t *pContext = OpenMachine(VBXE_PROFILE_FX126, VBXE_PAGE_D6);
	Vbxe_t *pVbxe;
	u32 lLines = 0;

	REQUIRE(pContext != NULL, "machine open failed");
	pVbxe = ((IoData_t *)pContext->pIoData)->pVbxe;
	/* 512 bytes * 2 cycles + 21 load = 1045 slots: more than one scanline. */
	WriteBcb(pVbxe, 0x1000, 0x2000, 0x8000, 256, 2, 0xff, 0x00, 0x00, 0);
	SetBlitAddress(pContext, 0x1000);
	pVbxe->pVram[0x2000] = 0x11;
	BusWrite(pContext, 0xd653, 0x01);
	REQUIRE(BusRead(pContext, 0xd653) != 0, "a 1045-slot blit finished inside one scanline");
	while(pVbxe->cBlitterBusy && lLines < 10)
	{
		Vbxe_EndOfLine(pVbxe);
		lLines++;
	}
	REQUIRE(!pVbxe->cBlitterBusy && lLines >= 1, "blit never completed (%u lines)", (unsigned)lLines);
	REQUIRE(pVbxe->pVram[0x8000] == 0x11, "data missing after a multi-line blit");
	CloseMachine(pContext);
	return 1;
}

/* AHRM 12.4: bit n of the mask covers destination values $20n-$20n+1F. */
static int TestBlitterCollisionGroups(void)
{
	_6502_Context_t *pContext = OpenMachine(VBXE_PROFILE_FX126, VBXE_PAGE_D6);
	Vbxe_t *pVbxe;

	REQUIRE(pContext != NULL, "machine open failed");
	pVbxe = ((IoData_t *)pContext->pIoData)->pVbxe;
	pVbxe->pVram[0x2000] = 0x05;
	pVbxe->pVram[0x4000] = 0x20;
	WriteBcb(pVbxe, 0x1000, 0x2000, 0x4000, 1, 1, 0xff, 0x00, 0x01, 1);
	SetBlitAddress(pContext, 0x1000);
	BusWrite(pContext, 0xd653, 0x01);
	RunLines(pVbxe, 4);
	REQUIRE(pVbxe->cBlitCollisionCode == 0, "$20 collided with mask bit 0 (covers $01-1F)");
	pVbxe->pVram[0x4000] = 0x20;
	WriteBcb(pVbxe, 0x1000, 0x2000, 0x4000, 1, 1, 0xff, 0x00, 0x02, 1);
	BusWrite(pContext, 0xd653, 0x01);
	RunLines(pVbxe, 4);
	REQUIRE(pVbxe->cBlitCollisionCode == 0x20, "$20 did not collide with mask bit 1 (got %02X)",
			pVbxe->cBlitCollisionCode);
	CloseMachine(pContext);
	return 1;
}

/* Altirra runs the rest of the scanline's budget when BLITTER_START is
 * written, so a program polling the collision code right away sees it. */
static int TestBlitterStartMidLine(void)
{
	_6502_Context_t *pContext = OpenMachine(VBXE_PROFILE_FX126, VBXE_PAGE_D6);
	IoData_t *pIoData;
	Vbxe_t *pVbxe;

	REQUIRE(pContext != NULL, "machine open failed");
	pIoData = (IoData_t *)pContext->pIoData;
	pVbxe = pIoData->pVbxe;
	pVbxe->pVram[0x2000] = 0x05;
	pVbxe->pVram[0x4000] = 0x20;
	WriteBcb(pVbxe, 0x1000, 0x2000, 0x4000, 1, 1, 0xff, 0x00, 0x02, 1);
	SetBlitAddress(pContext, 0x1000);

	/* Plenty of line left: the collision is visible right after START. */
	pIoData->llCycle = 10;
	BusWrite(pContext, 0xd653, 0x01);
	REQUIRE(BusRead(pContext, 0xd650) == 0x20, "collision not visible right after START");
	REQUIRE(pVbxe->bBlitterEarlyRun, "the early run was not recorded");
	/* The line-end budget of that line is not spent a second time. */
	Vbxe_EndOfLine(pVbxe);
	REQUIRE(!pVbxe->bBlitterEarlyRun, "early-run flag survived the end of the line");

	/* Almost no line left: START cannot even load the BCB yet. */
	pVbxe->pVram[0x4000] = 0x20;
	pIoData->llCycle = 113;
	BusWrite(pContext, 0xd653, 0x01);
	REQUIRE(BusRead(pContext, 0xd650) == 0x00, "collision visible with 8 slots of budget");
	REQUIRE(BusRead(pContext, 0xd653) != 0, "blitter finished with 8 slots of budget");
	CloseMachine(pContext);
	return 1;
}

static int TestBlitterStartLatchesBcb(void)
{
	_6502_Context_t *pContext = OpenMachine(VBXE_PROFILE_FX126, VBXE_PAGE_D6);
	IoData_t *pIoData;
	Vbxe_t *pVbxe;

	REQUIRE(pContext != NULL, "machine open failed");
	pIoData = (IoData_t *)pContext->pIoData;
	pVbxe = pIoData->pVbxe;
	pVbxe->pVram[0x2000] = 0x05;
	pVbxe->pVram[0x2100] = 0x07;
	WriteBcb(pVbxe, 0x1000, 0x2000, 0x4000, 1, 1, 0xff, 0x00, 0x00, 0);
	SetBlitAddress(pContext, 0x1000);

	/* Almost no line left, so the BCB load cannot finish inside START. The
	 * program then reuses the block for its next sprite (Gacek does). */
	pIoData->llCycle = 113;
	BusWrite(pContext, 0xd653, 0x01);
	pVbxe->pVram[0x1001] = 0x21; /* source becomes $2100 */
	Vbxe_EndOfLine(pVbxe);
	Vbxe_EndOfLine(pVbxe);
	REQUIRE(BusRead(pContext, 0xd653) == 0, "the blit did not finish");
	REQUIRE(pVbxe->pVram[0x4000] == 0x05, "the blit used the rewritten BCB (%02X)", pVbxe->pVram[0x4000]);
	CloseMachine(pContext);
	return 1;
}

static int TestSoftResetStrobe(void)
{
	_6502_Context_t *pContext = OpenMachine(VBXE_PROFILE_FX126, VBXE_PAGE_D6);
	Vbxe_t *pVbxe;

	REQUIRE(pContext != NULL, "machine open failed");
	pVbxe = ((IoData_t *)pContext->pIoData)->pVbxe;
	BusWrite(pContext, 0xd65e, 0x98);
	BusWrite(pContext, 0xd65f, 0x83);
	BusWrite(pContext, 0xd654, 0x01);
	BusWrite(pContext, 0xd0a0, 0x00); /* any write in $D080-$D0FF */
	REQUIRE((pVbxe->cMemacBankSelect & 0x80) == 0, "MEMAC A stayed enabled after the reset strobe");
	REQUIRE(pVbxe->cIrqControl == 0, "IRQ_CONTROL survived the reset strobe");
	REQUIRE((pVbxe->cMemacBankSelect & 0x7f) == 0x03, "bank latch was not preserved");
	pContext->pMemory[0x9000] = 0x44;
	REQUIRE(BusRead(pContext, 0x9000) == 0x44, "window still routes to VRAM after the strobe");
	CloseMachine(pContext);
	return 1;
}


/* --- Stage 2: XDL, overlay, attribute map ------------------------------ */

static u8 m_aPixels[VBXE_LINE_PIXELS];
static u16 m_aPriority[VBXE_LINE_PIXELS];

static uint32_t PaletteArgb(u8 cR, u8 cG, u8 cB)
{
	return 0xff000000u | ((uint32_t)cR << 16) | ((uint32_t)cG << 8) | cB;
}

static void SetPalette(Vbxe_t *pVbxe, u32 lPalette, u32 lColor, u8 cR, u8 cG, u8 cB)
{
	u8 *pRgb = &pVbxe->aPalette[(lPalette * 256u + lColor) * 3u];

	pRgb[0] = cR;
	pRgb[1] = cG;
	pRgb[2] = cB;
}

static void StartXdl(Vbxe_t *pVbxe, u32 lXdlAddress)
{
	pVbxe->cVideoControlPending = 0x01;
	pVbxe->lXdlAddressPending = lXdlAddress;
	Vbxe_VerticalSync(pVbxe);
	memset(m_aPixels, 0, sizeof(m_aPixels));
	memset(m_aPriority, 0, sizeof(m_aPriority));
}

static const uint32_t *Compose(Vbxe_t *pVbxe, u32 lScanline)
{
	Vbxe_ComposeLine(pVbxe, lScanline, m_aPixels, m_aPriority, 0x0f, 0, 0);
	return Vbxe_OverlayLine(pVbxe, lScanline);
}

static int TestXdlStandardOverlay(void)
{
	_6502_Context_t *pContext = OpenMachine(VBXE_PROFILE_FX126, VBXE_PAGE_D6);
	Vbxe_t *pVbxe;
	static const u8 aXdl[] = {
		0x62, 0x88,             /* graphics, repeat, OVADR | END, MISC */
		0x01,                   /* repeat: one more line */
		0x00, 0x20, 0x00,       /* overlay address $002000 */
		0x10, 0x00,             /* stride 16 */
		0x11,                   /* normal width, overlay palette 1 */
		0xff};                  /* priority: overlay everywhere */
	const uint32_t *pRow;

	REQUIRE(pContext != NULL, "machine open failed");
	pVbxe = ((IoData_t *)pContext->pIoData)->pVbxe;
	memcpy(&pVbxe->pVram[0x100], aXdl, sizeof(aXdl));
	pVbxe->pVram[0x2000] = 5;
	pVbxe->pVram[0x2001] = 0;
	pVbxe->pVram[0x2010] = 6;
	SetPalette(pVbxe, 1, 5, 0x10, 0x20, 0x30);
	SetPalette(pVbxe, 1, 6, 0x40, 0x50, 0x60);
	StartXdl(pVbxe, 0x100);

	REQUIRE(Compose(pVbxe, 7) == NULL || Vbxe_OverlayLine(pVbxe, 7) == NULL ||
			Vbxe_OverlayLine(pVbxe, 7)[96] == 0, "overlay drawn above the first visible line");
	pRow = Compose(pVbxe, 8);
	REQUIRE(pRow != NULL, "no overlay row");
	REQUIRE(pRow[96] == PaletteArgb(0x10, 0x20, 0x30), "pixel 0 is %08X", pRow[96]);
	REQUIRE(pRow[97] == 0, "color 0 is not transparent");
	REQUIRE(pVbxe->lDmaSlots == 22u + 80u * 4u, "DMA slots %lu, expected 342", (unsigned long)pVbxe->lDmaSlots);
	pVbxe->lDmaSlots = 0;
	pRow = Compose(pVbxe, 9);
	REQUIRE(pRow[96] == PaletteArgb(0x40, 0x50, 0x60), "repeated line did not advance by the stride");
	REQUIRE(pVbxe->lDmaSlots == 80u * 4u, "repeated line paid an XDL update (%lu)", (unsigned long)pVbxe->lDmaSlots);
	pRow = Compose(pVbxe, 10);
	REQUIRE(pRow[96] == 0, "overlay survived the END entry");

	/* Priority: PF0 beats an overlay whose mask lacks the PF0 bit. */
	pVbxe->pVram[0x101] = 0x88;
	pVbxe->pVram[0x109] = 0xef;
	StartXdl(pVbxe, 0x100);
	m_aPriority[96] = 0x01;
	pRow = Compose(pVbxe, 8);
	REQUIRE(pRow[96] == 0, "overlay won against PF0 despite the mask");
	m_aPriority[96] = 0x02;
	pRow = Compose(pVbxe, 9);
	REQUIRE(pRow[96] != 0, "overlay lost against PF1 though the mask allows it");

	/* Collisions: COLMASK selects the source-byte range, PF1 maps to $20. */
	pVbxe->cCollisionDetect = 0;
	pVbxe->cCollisionMask = 0x01;
	StartXdl(pVbxe, 0x100);
	m_aPriority[96] = 0x02;
	Compose(pVbxe, 8);
	/* The test line is ANTIC mode F: without extended color hires set pixels
	 * reach the priority logic as PF2 (Altirra RenderMode8). */
	REQUIRE(pVbxe->cCollisionDetect == 0x40, "COLDETECT is %02X, expected 40", pVbxe->cCollisionDetect);
	/* FX 1.26 with extended color keeps PF1 for set pixels. */
	pVbxe->cCollisionDetect = 0;
	pVbxe->cVideoControlPending |= 0x02;
	pVbxe->cVideoControlActive |= 0x02;
	StartXdl(pVbxe, 0x100);
	pVbxe->cVideoControlActive |= 0x02;
	m_aPriority[96] = 0x02;
	Compose(pVbxe, 8);
	REQUIRE(pVbxe->cCollisionDetect == 0x20, "extended color COLDETECT is %02X, expected 20", pVbxe->cCollisionDetect);
	CloseMachine(pContext);
	return 1;
}

static int TestXdlTextOverlay(void)
{
	_6502_Context_t *pContext = OpenMachine(VBXE_PROFILE_FX126, VBXE_PAGE_D6);
	Vbxe_t *pVbxe;
	static const u8 aXdl[] = {
		0x41, 0x89,             /* text, OVADR | END, CHBASE | MISC */
		0x00, 0x30, 0x00,       /* overlay address $003000 */
		0x20, 0x00,             /* stride 32 */
		0x04,                   /* character base $2000 */
		0x11,                   /* normal width, overlay palette 1 */
		0xff};
	const uint32_t *pRow;

	REQUIRE(pContext != NULL, "machine open failed");
	pVbxe = ((IoData_t *)pContext->pIoData)->pVbxe;
	memcpy(&pVbxe->pVram[0x100], aXdl, sizeof(aXdl));
	pVbxe->pVram[0x3000] = 1;      /* character */
	pVbxe->pVram[0x3001] = 0x05;   /* foreground color 5 */
	pVbxe->pVram[0x2008] = 0x80;   /* glyph 1, row 0: leftmost pixel */
	SetPalette(pVbxe, 1, 5, 0x11, 0x22, 0x33);
	StartXdl(pVbxe, 0x100);

	pRow = Compose(pVbxe, 8);
	REQUIRE(pRow != NULL && pRow[96] == PaletteArgb(0x11, 0x22, 0x33), "glyph pixel missing");
	REQUIRE(pRow[97] == 0, "background of a text cell is not transparent");
	REQUIRE(pVbxe->lDmaSlots == 22u + 243u, "text DMA slots %lu", (unsigned long)pVbxe->lDmaSlots);
	CloseMachine(pContext);
	return 1;
}

static int TestTextVerticalScrollStartsAtLatchedRow(void)
{
	_6502_Context_t *pContext = OpenMachine(VBXE_PROFILE_FX126, VBXE_PAGE_D6);
	Vbxe_t *pVbxe;
	static const u8 aXdl[] = {
		0xc1, 0x89,             /* text, OVADR | OVSCRL, CHBASE | MISC | END */
		0x00, 0x30, 0x00,       /* overlay address $003000 */
		0x20, 0x00,             /* stride 32 */
		0x00, 0x01,             /* scroll X 0, scroll Y 1 */
		0x04,                   /* character base $2000 */
		0x11,                   /* normal width, overlay palette 1 */
		0xff};
	const uint32_t *pRow;

	REQUIRE(pContext != NULL, "machine open failed");
	pVbxe = ((IoData_t *)pContext->pIoData)->pVbxe;
	memcpy(&pVbxe->pVram[0x100], aXdl, sizeof(aXdl));
	pVbxe->pVram[0x3000] = 1;
	pVbxe->pVram[0x3001] = 0x05;
	pVbxe->pVram[0x2008] = 0x00;   /* glyph 1 row 0 */
	pVbxe->pVram[0x2009] = 0x80;   /* glyph 1 row 1: first line shown */
	pVbxe->pVram[0x200a] = 0x00;   /* glyph 1 row 2 */
	SetPalette(pVbxe, 1, 5, 0x11, 0x22, 0x33);
	StartXdl(pVbxe, 0x100);
	pRow = Compose(pVbxe, 8);
	REQUIRE(pRow != NULL && pRow[96] == PaletteArgb(0x11, 0x22, 0x33),
			"the first line does not show glyph row 1");
	pRow = Compose(pVbxe, 9);
	REQUIRE(pRow[96] == 0, "the second line shows glyph row 1 again");
	CloseMachine(pContext);
	return 1;
}

static int TestAttributeMapAndPlayfieldPalette(void)
{
	_6502_Context_t *pContext = OpenMachine(VBXE_PROFILE_FX126, VBXE_PAGE_D6);
	Vbxe_t *pVbxe;
	static const u8 aMapXdl[] = {
		0x08, 0x82,             /* map on, ATT address + END */
		0x00, 0x40, 0x00,       /* map address $004000 */
		0x00, 0x00};            /* stride 0 */
	static const u8 aPaletteXdl[] = {
		0x02, 0x88,             /* transparent overlay, MISC + END */
		0x01 | (2u << 6),       /* normal width, playfield palette 2 */
		0xff};
	const uint32_t *pRow;
	u32 lCell;

	REQUIRE(pContext != NULL, "machine open failed");
	pVbxe = ((IoData_t *)pContext->pIoData)->pVbxe;
	memcpy(&pVbxe->pVram[0x100], aMapXdl, sizeof(aMapXdl));
	for(lCell = 0; lCell < 43; lCell++)
	{
		u8 *pCell = &pVbxe->pVram[0x4000 + lCell * 4];

		pCell[0] = 0x10; pCell[1] = 0x22; pCell[2] = 0x33; pCell[3] = 0x40; /* palette 1 */
	}
	SetPalette(pVbxe, 1, 0x22, 1, 2, 3);
	SetPalette(pVbxe, 1, 0x10, 4, 5, 6);
	StartXdl(pVbxe, 0x100);
	m_aPriority[96] = 0x02;  /* PF1 */
	m_aPriority[97] = 0x01;  /* PF0 */
	m_aPriority[98] = 0x00;  /* background keeps the GTIA color */
	pRow = Compose(pVbxe, 8);
	REQUIRE(pRow != NULL && pRow[96] == PaletteArgb(1, 2, 3), "PF1 cell color is %08X", pRow[96]);
	REQUIRE(pRow[97] == PaletteArgb(4, 5, 6), "PF0 cell color is %08X", pRow[97]);
	REQUIRE(pRow[98] == 0, "background was recolored by the map");
	REQUIRE(pVbxe->lDmaSlots == 22u + 172u, "map DMA slots %lu", (unsigned long)pVbxe->lDmaSlots);

	/* Without a map, XDL MISC selects the playfield palette; players keep
	 * their GTIA color and the low bit is dropped without extended color. */
	memcpy(&pVbxe->pVram[0x100], aPaletteXdl, sizeof(aPaletteXdl));
	SetPalette(pVbxe, 2, 0x34, 9, 8, 7);
	StartXdl(pVbxe, 0x100);
	m_aPixels[96] = 0x35; m_aPriority[96] = 0x01;
	m_aPixels[97] = 0x35; m_aPriority[97] = 0x10;
	pRow = Compose(pVbxe, 8);
	REQUIRE(pRow != NULL && pRow[96] == PaletteArgb(9, 8, 7), "playfield not recolored (%08X)", pRow[96]);
	REQUIRE(pRow[97] == 0, "a player was recolored");
	CloseMachine(pContext);
	return 1;
}

static int TestHiresPairIsAveraged(void)
{
	_6502_Context_t *pContext = OpenMachine(VBXE_PROFILE_FX126, VBXE_PAGE_D6);
	Vbxe_t *pVbxe;
	static const u8 aXdl[] = {
		0x42, 0x98, 0x00, 0x20, 0x00, 0x10, 0x00, 0x11, 0xff};
	const uint32_t *pRow;

	REQUIRE(pContext != NULL, "machine open failed");
	pVbxe = ((IoData_t *)pContext->pIoData)->pVbxe;
	memcpy(&pVbxe->pVram[0x100], aXdl, sizeof(aXdl));
	pVbxe->pVram[0x2000] = 0x12;   /* two hires pixels: colors 1 and 2 */
	pVbxe->pVram[0x2001] = 0x03;   /* color 0 is transparent: only 3 shows */
	SetPalette(pVbxe, 1, 1, 100, 0, 200);
	SetPalette(pVbxe, 1, 2, 50, 100, 0);
	SetPalette(pVbxe, 1, 3, 9, 8, 7);
	StartXdl(pVbxe, 0x100);
	pRow = Compose(pVbxe, 8);
	REQUIRE(pRow != NULL && pRow[96] == PaletteArgb(75, 50, 100), "pair not averaged (%08X)", pRow[96]);
	REQUIRE(pRow[97] == PaletteArgb(9, 8, 7), "half-transparent pair is %08X", pRow[97]);
	CloseMachine(pContext);
	return 1;
}

static int TestOverlayReachesScreen(void)
{
	_6502_Context_t *pContext = OpenMachine(VBXE_PROFILE_FX126, VBXE_PAGE_D6);
	Vbxe_t *pVbxe;
	SDL_Surface *pScreen;
	static const u8 aXdl[] = {
		0x42, 0x88, 0x00, 0x20, 0x00, 0x10, 0x00, 0x11, 0xff};

	REQUIRE(pContext != NULL, "machine open failed");
	pVbxe = ((IoData_t *)pContext->pIoData)->pVbxe;
	memcpy(&pVbxe->pVram[0x100], aXdl, sizeof(aXdl));
	pVbxe->pVram[0x2000] = 5;
	pVbxe->pVram[0x2001] = 6;
	pVbxe->pVram[0x2002] = 5;
	SetPalette(pVbxe, 1, 5, 0x10, 0x20, 0x30);
	SetPalette(pVbxe, 1, 6, 0x40, 0x50, 0x60);
	StartXdl(pVbxe, 0x100);
	Compose(pVbxe, 8);
	pScreen = SDL_CreateRGBSurface(0, 336, 240, 32, 0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000);
	REQUIRE(pScreen != NULL, "surface failed");
	AtariIoDrawScreen(pContext, pScreen, 336, 240);
	/* The normal playfield starts at pixel 96 of the line; the view at 88. */
	REQUIRE(((uint32_t *)pScreen->pixels)[8] == PaletteArgb(0x10, 0x20, 0x30),
			"screen pixel is %08X", ((uint32_t *)pScreen->pixels)[8]);
	REQUIRE(((uint32_t *)pScreen->pixels)[9] == PaletteArgb(0x40, 0x50, 0x60),
			"neighbor pixel is %08X", ((uint32_t *)pScreen->pixels)[9]);
	REQUIRE(((uint32_t *)pScreen->pixels)[10] == PaletteArgb(0x10, 0x20, 0x30),
			"third pixel is %08X", ((uint32_t *)pScreen->pixels)[10]);
	SDL_FreeSurface(pScreen);
	CloseMachine(pContext);
	return 1;
}

static int TestAbsentDeviceIsInert(void)
{
	_6502_Context_t *pContext = _6502_Open();

	REQUIRE(pContext != NULL, "6502 open failed");
	AtariIoOpenWithMemory(pContext, 0, NULL, ATARI_VIDEO_PAL, ATARI_MEMORY_NONE);
	REQUIRE(((IoData_t *)pContext->pIoData)->pVbxe == NULL, "VBXE exists without being enabled");
	REQUIRE(!Pia_IrqAsserted(pContext), "IRQ asserted on a machine without VBXE");
	REQUIRE(pContext->pfnFetchStage == NULL, "fetch hook installed without VBXE");
	_6502_Close(pContext);
	return 1;
}

int main(void)
{
	static int (*const aTests[])(void) = {
		TestRegisterRevisions,
		TestPaletteLatch,
		TestMemacWindows,
		TestInstructionFetchFromWindow,
		TestAnticReadsThroughWindow,
		TestBlitterCopyAndIrq,
		TestBlitterBudgetAcrossLines,
		TestBlitterCollisionGroups,
		TestBlitterStartMidLine,
		TestBlitterStartLatchesBcb,
		TestSoftResetStrobe,
		TestXdlStandardOverlay,
		TestXdlTextOverlay,
		TestTextVerticalScrollStartsAtLatchedRow,
		TestAttributeMapAndPlayfieldPalette,
		TestHiresPairIsAveraged,
		TestOverlayReachesScreen,
		TestAbsentDeviceIsInert,
	};
	u32 lIndex;

	_6502_Init();
	for(lIndex = 0; lIndex < sizeof(aTests) / sizeof(aTests[0]); lIndex++)
	{
		if(!aTests[lIndex]()) return 1;
	}
	printf("vbxe_probe: ok\n");
	return 0;
}
