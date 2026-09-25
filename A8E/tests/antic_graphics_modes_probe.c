#include <stdio.h>
#include <string.h>

#include <SDL2/SDL.h>

#include "6502.h"
#include "Antic.h"
#include "Gtia.h"
#include "AtariIo.h"

SDL_Window *g_pSdlWindow = NULL;

void AtariIoDrawLine(_6502_Context_t *pContext);

typedef struct
{
	_6502_Context_t *pContext;
	IoData_t *pIoData;
} ProbeMachine_t;

#define REQUIRE(condition, format, ...)                                  \
	do                                                                   \
	{                                                                    \
		if(!(condition))                                                 \
		{                                                                \
			fprintf(stderr, "%s: " format "\n", __func__, ##__VA_ARGS__); \
			return 0;                                                    \
		}                                                                \
	} while(0)

static ProbeMachine_t ProbeMachine_Open(void)
{
	ProbeMachine_t tMachine;

	memset(&tMachine, 0, sizeof(tMachine));

	tMachine.pContext = _6502_Open();
	if(tMachine.pContext == NULL)
	{
		fprintf(stderr, "ProbeMachine_Open: _6502_Open failed\n");
		return tMachine;
	}

	AtariIoOpen(tMachine.pContext, 0, NULL, ATARI_VIDEO_PAL);
	tMachine.pIoData = (IoData_t *)tMachine.pContext->pIoData;

	return tMachine;
}

static void ProbeMachine_Close(ProbeMachine_t *pMachine)
{
	if(pMachine->pContext)
	{
		AtariIoClose(pMachine->pContext);
		_6502_Close(pMachine->pContext);
	}

	memset(pMachine, 0, sizeof(*pMachine));
}

static void ProbeMachine_ResetVideo(ProbeMachine_t *pMachine)
{
	_6502_Context_t *pContext = pMachine->pContext;
	IoData_t *pIoData = pMachine->pIoData;

	pContext->llCycleCounter = 100000;
	pContext->llStallCycleCounter = 0;
	pContext->cNmiPendingFlag = 0;
	pContext->cNmiActiveFlag = 0;
	pContext->cIrqPendingFlag = 0;
	pContext->AccessFunction = NULL;
	pContext->sAccessAddress = 0;
	pContext->llIoCycleTimedEventCycle = CYCLE_NEVER;
	pContext->llIoMasterTimedEventCycle = CYCLE_NEVER;
	pContext->llIoBeamTimedEventCycle = CYCLE_NEVER;

	memset(pContext->pMemory, 0, _6502_MEMORY_SIZE);
	memset(pContext->pShadowMemory, 0, _6502_MEMORY_SIZE);
	memset(pIoData->tVideoData.pSdlAtariSurface->pixels, 0, PIXELS_PER_LINE * LINES_PER_SCREEN_PAL);
	memset(pIoData->tVideoData.pPriorityData, 0, PIXELS_PER_LINE * LINES_PER_SCREEN_PAL);
	memset(&pIoData->tDrawLineData, 0, sizeof(pIoData->tDrawLineData));

	pIoData->llCycle = 0;
	pIoData->llDisplayListFetchCycle = 0;
	pIoData->llDliCycle = CYCLE_NEVER;
	pIoData->llVbiCycle = CYCLE_NEVER;
	pIoData->llSerialOutputNeedDataCycle = CYCLE_NEVER;
	pIoData->llSerialOutputTransmissionDoneCycle = CYCLE_NEVER;
	pIoData->llSerialInputDataReadyCycle = CYCLE_NEVER;
	pIoData->llTimer1Cycle = CYCLE_NEVER;
	pIoData->llTimer2Cycle = CYCLE_NEVER;
	pIoData->llTimer4Cycle = CYCLE_NEVER;
	pIoData->bInDrawLine = 0;
	pIoData->cCurrentDisplayListCommand = 0;
	pIoData->lNextDisplayListLine = 8;
	pIoData->sDisplayListAddress = 0;
	pIoData->sRowDisplayMemoryAddress = 0x2000;
	pIoData->sDisplayMemoryAddress = 0x2000;
	pIoData->bFirstRowScanline = 0;
	pIoData->tVideoData.lCurrentDisplayLine = 8;
	pIoData->cModeLineRowCounter = 0;
	pIoData->cModeLineEndRow = 0;
	pIoData->bModeLineScrollExit = 0;
	pIoData->bModeLineExitDli = 0;
	pIoData->bModeLineEndsThisLine = 0;
}

static void ProbeMachine_PrepareModeLine(
	ProbeMachine_t *pMachine,
	u8 cMode,
	u32 lCurrentLine,
	u32 lNextLine,
	u8 bFirstRowScanline)
{
	_6502_Context_t *pContext = pMachine->pContext;
	IoData_t *pIoData = pMachine->pIoData;

	pIoData->llCycle = 0;
	pIoData->llDisplayListFetchCycle = 0;
	pIoData->cCurrentDisplayListCommand = cMode;
	pIoData->lNextDisplayListLine = lNextLine;
	pIoData->sRowDisplayMemoryAddress = 0x2000;
	pIoData->sDisplayMemoryAddress = 0x2000;
	pIoData->bFirstRowScanline = bFirstRowScanline;
	pIoData->tVideoData.lCurrentDisplayLine = lCurrentLine;
	pIoData->cModeLineRowCounter = 0;
	pIoData->bModeLineScrollExit = 0;
	pIoData->bModeLineExitDli = 0;
	pIoData->bModeLineEndsThisLine = 0;

	SRAM[IO_DMACTL] = 0x22;
	SRAM[IO_HSCROL] = 0x00;
	SRAM[IO_COLBK] = 0x00;
	SRAM[IO_COLPF0] = 0x22;
	SRAM[IO_COLPF1] = 0x0b;
	SRAM[IO_COLPF2] = 0xa0;
	SRAM[IO_COLPF3] = 0x44;
	SRAM[IO_PRIOR] = 0x00;
}

static u8 ProbeMachine_PixelAt(ProbeMachine_t *pMachine, u32 lLine, u32 lX)
{
	u8 *pPixels = (u8 *)pMachine->pIoData->tVideoData.pSdlAtariSurface->pixels;
	return pPixels[lLine * PIXELS_PER_LINE + lX];
}

static u32 ProbeMachine_ScheduledPlayfieldDmaCount(ProbeMachine_t *pMachine)
{
	u32 lCount = 0;
	u32 i;

	for(i = 0; i < CYCLES_PER_LINE; i++)
	{
		lCount += pMachine->pIoData->tDrawLineData.aScheduledPlayfieldDma[i];
	}

	return lCount;
}

static int TestCharacterModeOriginsUseGtiaClock30(void)
{
	static const struct
	{
		u8 cMode;
		u32 lModeLines;
		u8 cGlyphData;
		u8 cExpectedColor;
	} aCases[] =
		{
			{0x02, 8, 0xff, 0xab},
			{0x03, 10, 0xff, 0xab},
			{0x04, 8, 0xc0, 0xa0},
			{0x05, 16, 0xc0, 0xa0},
			{0x06, 8, 0x80, 0x22},
			{0x07, 16, 0x80, 0x22},
	};
	u32 i;

	for(i = 0; i < sizeof(aCases) / sizeof(aCases[0]); i++)
	{
		ProbeMachine_t tMachine = ProbeMachine_Open();
		_6502_Context_t *pContext = tMachine.pContext;
		IoData_t *pIoData = tMachine.pIoData;

		REQUIRE(pContext != NULL, "machine open failed");

		ProbeMachine_ResetVideo(&tMachine);
		ProbeMachine_PrepareModeLine(
			&tMachine,
			aCases[i].cMode,
			8,
			8 + aCases[i].lModeLines,
			0);

		SRAM[IO_CHACTL] = 0x00;
		SRAM[IO_CHBASE] = 0x20;
		pIoData->tDrawLineData.aPlayfieldLineBuffer[0] = 0x00;
		RAM[0x2000] = aCases[i].cGlyphData;

		AtariIoDrawLine(pContext);

		REQUIRE(
			ProbeMachine_PixelAt(&tMachine, 8, 95) == SRAM[IO_COLBK],
			"mode %X drew before GTIA clock $30; x95 was $%02X",
			aCases[i].cMode,
			ProbeMachine_PixelAt(&tMachine, 8, 95));
		REQUIRE(
			ProbeMachine_PixelAt(&tMachine, 8, 96) == aCases[i].cExpectedColor,
			"mode %X started at $%02X instead of expected $%02X at x96",
			aCases[i].cMode,
			ProbeMachine_PixelAt(&tMachine, 8, 96),
			aCases[i].cExpectedColor);

		ProbeMachine_Close(&tMachine);
	}

	return 1;
}

static int TestMode2BlankAndInvertProducesInvertedSpace(void)
{
	ProbeMachine_t tMachine = ProbeMachine_Open();
	_6502_Context_t *pContext = tMachine.pContext;
	IoData_t *pIoData = tMachine.pIoData;

	REQUIRE(pContext != NULL, "machine open failed");

	ProbeMachine_ResetVideo(&tMachine);
	ProbeMachine_PrepareModeLine(&tMachine, 0x02, 8, 16, 0);

	SRAM[IO_CHACTL] = 0x03;
	SRAM[IO_CHBASE] = 0x20;
	pIoData->tDrawLineData.aPlayfieldLineBuffer[0] = 0x80;
	RAM[0x2000] = 0xff;

	AtariIoDrawLine(pContext);

	REQUIRE(
		ProbeMachine_PixelAt(&tMachine, 8, 96) == 0xab,
		"mode 2 CHACTL blank+invert pixel was $%02X instead of inverted-space $AB",
		ProbeMachine_PixelAt(&tMachine, 8, 96));

	ProbeMachine_Close(&tMachine);
	return 1;
}

static int TestMode23FetchesBlankExtendedRows(void)
{
	static const struct
	{
		u8 cMode;
		u8 cRow;
		u8 cCharacter;
	} aCases[] =
		{
			{0x02, 8, 0x00}, /* mode 2 non-descender blank row */
			{0x03, 0, 0x60}, /* mode 3 descender blank row */
		};
	u32 i;

	for(i = 0; i < sizeof(aCases) / sizeof(aCases[0]); i++)
	{
		ProbeMachine_t tMachine = ProbeMachine_Open();
		_6502_Context_t *pContext = tMachine.pContext;
		IoData_t *pIoData = tMachine.pIoData;
		u32 lFetchCount;

		REQUIRE(pContext != NULL, "machine open failed");

		ProbeMachine_ResetVideo(&tMachine);
		ProbeMachine_PrepareModeLine(
			&tMachine,
			aCases[i].cMode,
			8,
			8 + (aCases[i].cMode == 0x02 ? 8 : 10),
			0);
		pIoData->cModeLineRowCounter = aCases[i].cRow;
		SRAM[IO_CHACTL] = 0x00;
		SRAM[IO_CHBASE] = 0x20;
		pIoData->tDrawLineData.lBytesPerLine = 40;
		memset(
			pIoData->tDrawLineData.aPlayfieldLineBuffer,
			aCases[i].cCharacter,
			40);

		AtariIoDrawLine(pContext);
		lFetchCount = ProbeMachine_ScheduledPlayfieldDmaCount(&tMachine);

		REQUIRE(
			lFetchCount == 40,
			"mode %X blank row scheduled %lu character fetches instead of 40",
			aCases[i].cMode,
			(unsigned long)lFetchCount);
		REQUIRE(
			ProbeMachine_PixelAt(&tMachine, 8, 96) == SRAM[IO_COLPF2],
			"mode %X blank row displayed non-background data $%02X",
			aCases[i].cMode,
			ProbeMachine_PixelAt(&tMachine, 8, 96));

		ProbeMachine_Close(&tMachine);
	}

	return 1;
}

static int TestMode2MidScanlineChbaseLatchSwitchesCharacterSet(void)
{
	ProbeMachine_t tMachine = ProbeMachine_Open();
	_6502_Context_t *pContext = tMachine.pContext;
	IoData_t *pIoData = tMachine.pIoData;

	REQUIRE(pContext != NULL, "machine open failed");

	ProbeMachine_ResetVideo(&tMachine);
	ProbeMachine_PrepareModeLine(&tMachine, 0x02, 8, 16, 0);

	SRAM[IO_CHACTL] = 0x00;
	SRAM[IO_CHBASE] = 0x24;
	RAM[0x2000] = 0xff; /* old charset: char 0 row 0 solid */
	RAM[0x2400] = 0x00; /* new charset: char 0 row 0 empty */

	/* Prime a pending CHBASE switch ($20 -> $24) that matures at beam
	 * cycle 58 - the fetch cycle of character cell 20 on this line
	 * (playfield starts at cycle 18, one character per two cycles).
	 */
	pIoData->bChbaseTimingInitialized = 1;
	pIoData->cChbaseRawValue = 0x24;
	pIoData->cChbaseActiveValue = 0x20;
	pIoData->cChbasePendingValue = 0x24;
	pIoData->llChbasePendingCycle = 58;

	AtariIoDrawLine(pContext);

	REQUIRE(
		ProbeMachine_PixelAt(&tMachine, 8, 248) == 0xab,
		"character 19 used the pending CHBASE too early; x248 was $%02X",
		ProbeMachine_PixelAt(&tMachine, 8, 248));
	REQUIRE(
		ProbeMachine_PixelAt(&tMachine, 8, 256) == SRAM[IO_COLPF2],
		"character 20 kept the stale CHBASE; x256 was $%02X instead of $%02X",
		ProbeMachine_PixelAt(&tMachine, 8, 256),
		SRAM[IO_COLPF2]);
	REQUIRE(
		pIoData->cChbaseActiveValue == 0x24,
		"pending CHBASE value $24 was not latched (active is $%02X)",
		pIoData->cChbaseActiveValue);
	REQUIRE(
		pIoData->llChbasePendingCycle == CYCLE_NEVER,
		"CHBASE pending cycle was not cleared after latching");

	ProbeMachine_Close(&tMachine);
	return 1;
}

static int TestWideMode2UsesWideFetchWindow(void)
{
	ProbeMachine_t tMachine = ProbeMachine_Open();
	_6502_Context_t *pContext = tMachine.pContext;
	IoData_t *pIoData = tMachine.pIoData;

	REQUIRE(pContext != NULL, "machine open failed");

	ProbeMachine_ResetVideo(&tMachine);
	ProbeMachine_PrepareModeLine(&tMachine, 0x02, 8, 16, 0);
	SRAM[IO_DMACTL] = 0x23; /* playfield DMA enabled, wide width */
	SRAM[IO_CHBASE] = 0x20;
	RAM[0x2000] = 0xff;

	AtariIoDrawLine(pContext);

	REQUIRE(pIoData->tDrawLineData.lBytesPerLine == 48,
			"wide mode 2 used %lu bytes instead of 48",
			(unsigned long)pIoData->tDrawLineData.lBytesPerLine);
	REQUIRE(
		ProbeMachine_PixelAt(&tMachine, 8, 64) == 0xab,
		"wide mode 2 did not begin at the wide playfield origin (pixel $%02X)",
		ProbeMachine_PixelAt(&tMachine, 8, 64));
	REQUIRE(
		ProbeMachine_PixelAt(&tMachine, 8, 63) == SRAM[IO_COLBK],
		"wide mode 2 drew before its playfield origin");

	ProbeMachine_Close(&tMachine);
	return 1;
}

static int TestMode5UsesOneKilobyteChbaseAlignment(void)
{
	ProbeMachine_t tMachine = ProbeMachine_Open();
	_6502_Context_t *pContext = tMachine.pContext;
	IoData_t *pIoData = tMachine.pIoData;

	REQUIRE(pContext != NULL, "machine open failed");

	ProbeMachine_ResetVideo(&tMachine);
	ProbeMachine_PrepareModeLine(&tMachine, 0x05, 8, 24, 0);

	SRAM[IO_CHBASE] = 0xff;
	pIoData->tDrawLineData.aPlayfieldLineBuffer[0] = 0x00;
	RAM[0xfc00] = 0xc0;
	RAM[0xfe00] = 0x00;

	AtariIoDrawLine(pContext);

	REQUIRE(
		ProbeMachine_PixelAt(&tMachine, 8, 96) == SRAM[IO_COLPF2],
		"mode 5 read $%02X; expected 1K CHBASE-aligned PF2 color $%02X",
		ProbeMachine_PixelAt(&tMachine, 8, 96),
		SRAM[IO_COLPF2]);

	ProbeMachine_Close(&tMachine);
	return 1;
}

static int TestMode5FetchesCharacterDataOnOddRepeatedScanlines(void)
{
	ProbeMachine_t tMachine = ProbeMachine_Open();
	_6502_Context_t *pContext = tMachine.pContext;
	IoData_t *pIoData = tMachine.pIoData;

	REQUIRE(pContext != NULL, "machine open failed");

	ProbeMachine_ResetVideo(&tMachine);
	ProbeMachine_PrepareModeLine(&tMachine, 0x05, 8, 23, 0);
	pIoData->cModeLineRowCounter = 1;

	SRAM[IO_CHBASE] = 0x20;
	pIoData->tDrawLineData.aPlayfieldLineBuffer[0] = 0x00;

	AtariIoDrawLine(pContext);

	REQUIRE(
		ProbeMachine_ScheduledPlayfieldDmaCount(&tMachine) == 40,
		"mode 5 odd repeated scanline scheduled %lu character DMA fetches instead of 40",
		(unsigned long)ProbeMachine_ScheduledPlayfieldDmaCount(&tMachine));

	ProbeMachine_Close(&tMachine);
	return 1;
}

static int TestMode7FetchesCharacterDataOnOddRepeatedScanlines(void)
{
	ProbeMachine_t tMachine = ProbeMachine_Open();
	_6502_Context_t *pContext = tMachine.pContext;
	IoData_t *pIoData = tMachine.pIoData;

	REQUIRE(pContext != NULL, "machine open failed");

	ProbeMachine_ResetVideo(&tMachine);
	ProbeMachine_PrepareModeLine(&tMachine, 0x07, 8, 23, 0);
	pIoData->cModeLineRowCounter = 1;

	SRAM[IO_CHBASE] = 0x20;
	pIoData->tDrawLineData.aPlayfieldLineBuffer[0] = 0x00;

	AtariIoDrawLine(pContext);

	REQUIRE(
		ProbeMachine_ScheduledPlayfieldDmaCount(&tMachine) == 20,
		"mode 7 odd repeated scanline scheduled %lu character DMA fetches instead of 20",
		(unsigned long)ProbeMachine_ScheduledPlayfieldDmaCount(&tMachine));

	ProbeMachine_Close(&tMachine);
	return 1;
}

static int TestPmgHiddenPrefixReplaysMidLineHposHistory(void)
{
	ProbeMachine_t tMachine = ProbeMachine_Open();
	_6502_Context_t *pContext = tMachine.pContext;
	IoData_t *pIoData = tMachine.pIoData;
	DrawLineData_t *pDrawLine = &pIoData->tDrawLineData;

	REQUIRE(pContext != NULL, "machine open failed");

	ProbeMachine_ResetVideo(&tMachine);
	pIoData->llCycle = 10;
	pIoData->llDisplayListFetchCycle = 0;
	pIoData->tVideoData.lCurrentDisplayLine = 8;
	pIoData->cCurrentDisplayListCommand = 0x02;
	pIoData->bInDrawLine = 1;
	pContext->cCurrentInstructionCycles = 1;
	pContext->llCycleCounter = 10;
	pContext->llIoBeamTimedEventCycle = CYCLE_NEVER;
	pContext->llIoMasterTimedEventCycle = CYCLE_NEVER;
	pContext->llIoCycleTimedEventCycle = CYCLE_NEVER;

	SRAM[IO_PRIOR] = 0x00;
	SRAM[IO_GRAFP0_P1PL] = 0xff;
	SRAM[IO_HPOSP0_M0PF] = 24;
	SRAM[IO_SIZEP0_M0PL] = 0x03;
	SRAM[IO_COLPM0_TRIG2] = 0x66;
	pDrawLine->cPmgFirstVisibleSpan = 1;
	pDrawLine->aPmgInitialRegisters[0] = 60;
	pDrawLine->aPmgInitialRegisters[8] = 0x03;
	pDrawLine->aPmgInitialRegisters[13] = 0xff;

	AtariIo_RecordPmgRegisterWrite(pContext, IO_HPOSP0_M0PF, 24);
	REQUIRE(pDrawLine->cPmgEventCount == 1,
			"mid-line HPOS write was not recorded");
	REQUIRE(pDrawLine->aPmgEventCycles[0] == 10,
			"HPOS write was recorded at cycle %u instead of 10",
			pDrawLine->aPmgEventCycles[0]);

	pIoData->llCycle = 18;
	pContext->llCycleCounter = 18;
	AtariIoTimingProbeStepClock(pContext);

	REQUIRE(
		ProbeMachine_PixelAt(&tMachine, 8, 96) == 0x00,
		"PMG appeared at x96 after a late HPOS write; history was not replayed");

	ProbeMachine_Close(&tMachine);
	return 1;
}

static int TestPmgPmbaseChangeKeepsMixedLineDmaHistory(void)
{
	ProbeMachine_t tMachine = ProbeMachine_Open();
	_6502_Context_t *pContext = tMachine.pContext;
	IoData_t *pIoData = tMachine.pIoData;
	DrawLineData_t *pDrawLine = &pIoData->tDrawLineData;

	REQUIRE(pContext != NULL, "machine open failed");

	ProbeMachine_ResetVideo(&tMachine);
	pIoData->llDisplayListFetchCycle = 0;
	pIoData->tVideoData.lCurrentDisplayLine = 8;
	pIoData->bInDrawLine = 1;
	pContext->llIoBeamTimedEventCycle = CYCLE_NEVER;
	pContext->llIoMasterTimedEventCycle = CYCLE_NEVER;
	pContext->llIoCycleTimedEventCycle = CYCLE_NEVER;

	SRAM[IO_DMACTL] = 0x08;
	SRAM[IO_GRACTL] = 0x02;
	SRAM[IO_PMBASE] = 0x20;
	RAM[0x2204] = 0x11;
	RAM[0x2684] = 0x22;

	pIoData->llCycle = 2;
	pContext->llCycleCounter = 2;
	AtariIoTimingProbeStepClock(pContext);

	SRAM[IO_PMBASE] = 0x24;
	pIoData->llCycle = 3;
	pContext->llCycleCounter = 3;
	AtariIoTimingProbeStepClock(pContext);

	REQUIRE(SRAM[IO_GRAFP0_P1PL] == 0x11,
			"player 0 did not use the old PMBASE in mixed-line DMA");
	REQUIRE(SRAM[IO_GRAFP1_P2PL] == 0x22,
			"player 1 did not use the new PMBASE in mixed-line DMA");
	REQUIRE(pDrawLine->cPmgEventCount == 2,
			"mixed-line PMG DMA events were not recorded");
	REQUIRE(pDrawLine->aPmgEventCycles[0] == 2 &&
			pDrawLine->aPmgEventCycles[1] == 3,
			"mixed-line PMG DMA cycles were recorded incorrectly");

	ProbeMachine_Close(&tMachine);
	return 1;
}

static int TestPmgMidLinePriorWriteAffectsLaterPixels(void)
{
	ProbeMachine_t tMachine = ProbeMachine_Open();
	_6502_Context_t *pContext = tMachine.pContext;
	IoData_t *pIoData = tMachine.pIoData;
	DrawLineData_t *pDrawLine = &pIoData->tDrawLineData;

	REQUIRE(pContext != NULL, "machine open failed");

	ProbeMachine_ResetVideo(&tMachine);
	pIoData->llDisplayListFetchCycle = 0;
	pIoData->tVideoData.lCurrentDisplayLine = 8;
	pIoData->bInDrawLine = 1;
	pIoData->llCycle = 18;
	pContext->llCycleCounter = 18;
	pContext->llIoBeamTimedEventCycle = CYCLE_NEVER;
	pContext->llIoMasterTimedEventCycle = CYCLE_NEVER;
	pContext->llIoCycleTimedEventCycle = CYCLE_NEVER;

	SRAM[IO_PRIOR] = 0x04;
	SRAM[IO_GRAFP0_P1PL] = 0xff;
	SRAM[IO_HPOSP0_M0PF] = 0x30;
	SRAM[IO_SIZEP0_M0PL] = 0x03;
	SRAM[IO_COLPM0_TRIG2] = 0x66;
	pIoData->tVideoData.pPriorityData[8 * PIXELS_PER_LINE + 96] = 0x01;
	pIoData->tVideoData.pPriorityData[8 * PIXELS_PER_LINE + 97] = 0x01;
	pDrawLine->cPmgFirstVisibleSpan = 1;
	pDrawLine->aPmgInitialRegisters[0] = 0x30;
	pDrawLine->aPmgInitialRegisters[8] = 0x03;
	pDrawLine->aPmgInitialRegisters[13] = 0xff;

	AtariIoTimingProbeStepClock(pContext);
	SRAM[IO_PRIOR] = 0x00;
	pIoData->llCycle = 19;
	pContext->llCycleCounter = 19;
	AtariIoTimingProbeStepClock(pContext);

	REQUIRE(
		ProbeMachine_PixelAt(&tMachine, 8, 96) == 0x00,
		"PRIOR change rewrote a pixel from the earlier span");
	REQUIRE(
		ProbeMachine_PixelAt(&tMachine, 8, 100) == 0x66,
		"PRIOR change did not affect the later span");

	ProbeMachine_Close(&tMachine);
	return 1;
}

static int TestPmgPlayerCollisionSetsBothPlayerLatches(void)
{
	ProbeMachine_t tMachine = ProbeMachine_Open();
	_6502_Context_t *pContext = tMachine.pContext;
	IoData_t *pIoData = tMachine.pIoData;
	DrawLineData_t *pDrawLine = &pIoData->tDrawLineData;

	REQUIRE(pContext != NULL, "machine open failed");

	ProbeMachine_ResetVideo(&tMachine);
	pIoData->llDisplayListFetchCycle = 0;
	pIoData->tVideoData.lCurrentDisplayLine = 8;
	pIoData->bInDrawLine = 1;
	pIoData->llCycle = 18;
	pContext->llCycleCounter = 18;
	pContext->llIoBeamTimedEventCycle = CYCLE_NEVER;
	pContext->llIoMasterTimedEventCycle = CYCLE_NEVER;
	pContext->llIoCycleTimedEventCycle = CYCLE_NEVER;

	SRAM[IO_PRIOR] = 0x00;
	SRAM[IO_GRAFP0_P1PL] = 0xff;
	SRAM[IO_GRAFP1_P2PL] = 0xff;
	SRAM[IO_HPOSP0_M0PF] = 0x30;
	SRAM[IO_HPOSP1_M1PF] = 0x30;
	SRAM[IO_SIZEP0_M0PL] = 0x00;
	SRAM[IO_SIZEP1_M1PL] = 0x00;
	SRAM[IO_COLPM0_TRIG2] = 0x66;
	SRAM[IO_COLPM1_TRIG3] = 0x77;
	pDrawLine->cPmgFirstVisibleSpan = 1;
	pDrawLine->aPmgInitialRegisters[0] = 0x30;
	pDrawLine->aPmgInitialRegisters[1] = 0x30;
	pDrawLine->aPmgInitialRegisters[8] = 0x00;
	pDrawLine->aPmgInitialRegisters[9] = 0x00;
	pDrawLine->aPmgInitialRegisters[13] = 0xff;
	pDrawLine->aPmgInitialRegisters[14] = 0xff;

	AtariIoTimingProbeStepClock(pContext);

	REQUIRE((RAM[IO_SIZEM_P0PL] & 0x02) != 0,
			"P0PL did not latch the P0/P1 player collision");
	REQUIRE((RAM[IO_GRAFP0_P1PL] & 0x01) != 0,
			"P1PL did not latch the P0/P1 player collision");

	ProbeMachine_Close(&tMachine);
	return 1;
}

int main(int argc, char *argv[])
{
	int bOk = 1;

	(void)argc;
	(void)argv;

	SDL_setenv("SDL_AUDIODRIVER", "dummy", 1);
	SDL_setenv("SDL_VIDEODRIVER", "dummy", 1);
	if(SDL_Init(SDL_INIT_AUDIO | SDL_INIT_VIDEO) != 0)
	{
		fprintf(stderr, "SDL_Init failed: %s\n", SDL_GetError());
		return 1;
	}

	bOk &= TestCharacterModeOriginsUseGtiaClock30();
	bOk &= TestMode2BlankAndInvertProducesInvertedSpace();
	bOk &= TestMode23FetchesBlankExtendedRows();
	bOk &= TestMode2MidScanlineChbaseLatchSwitchesCharacterSet();
	bOk &= TestWideMode2UsesWideFetchWindow();
	bOk &= TestMode5UsesOneKilobyteChbaseAlignment();
	bOk &= TestMode5FetchesCharacterDataOnOddRepeatedScanlines();
	bOk &= TestMode7FetchesCharacterDataOnOddRepeatedScanlines();
	bOk &= TestPmgHiddenPrefixReplaysMidLineHposHistory();
	bOk &= TestPmgPmbaseChangeKeepsMixedLineDmaHistory();
	bOk &= TestPmgMidLinePriorWriteAffectsLaterPixels();
	bOk &= TestPmgPlayerCollisionSetsBothPlayerLatches();

	SDL_Quit();

	if(!bOk)
	{
		return 1;
	}

	printf("antic_graphics_modes_probe passed\n");
	return 0;
}
