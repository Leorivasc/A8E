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
		TestSoftResetStrobe,
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
