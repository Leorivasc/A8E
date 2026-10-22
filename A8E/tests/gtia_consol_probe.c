#include <stdio.h>

#include <SDL2/SDL.h>

#include "6502.h"
#include "AtariIo.h"
#include "Gtia.h"

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

static u8 ReadConsol(_6502_Context_t *pContext)
{
	pContext->sAccessAddress = IO_CONSOL;
	return *Gtia_CONSOL(pContext, NULL);
}

static int TestConsolReadContract(void)
{
	_6502_Context_t *pContext = _6502_Open();
	u8 cValue;

	REQUIRE(pContext != NULL, "6502 open failed");
	AtariIoOpenWithMemory(pContext, 0, NULL, ATARI_VIDEO_PAL, ATARI_MEMORY_NONE);

	pContext->tCpu.pc = 0xc49d;
	cValue = ReadConsol(pContext);
	REQUIRE(cValue == 0x07, "normal CONSOL read was overridden (%02X)", cValue);
	pContext->tCpu.pc = 0xc49e;
	REQUIRE(ReadConsol(pContext) == 0x07,
			"normal CONSOL read changed away from the boot address");

	AtariIoClose(pContext);
	_6502_Close(pContext);

	pContext = _6502_Open();
	REQUIRE(pContext != NULL, "6502 open failed for option mode");
	AtariIoOpenWithMemory(pContext, ATARI_MODE_OPTION_ON_START, NULL,
			ATARI_VIDEO_PAL, ATARI_MEMORY_NONE);
	pContext->tCpu.pc = 0xc49d;
	cValue = ReadConsol(pContext);
	REQUIRE(cValue == 0x03, "Option-on-Start did not assert OPTION (%02X)", cValue);
	pContext->tCpu.pc = 0xc49e;
	REQUIRE(ReadConsol(pContext) == 0x07,
			"Option-on-Start leaked outside the OS boot check");

	AtariIoClose(pContext);
	_6502_Close(pContext);
	return 1;
}

static int TestOptionBootPath(void)
{
	_6502_Context_t *pNormal = _6502_Open();
	_6502_Context_t *pOption = _6502_Open();
	IoData_t *pNormalIo;
	IoData_t *pOptionIo;

	REQUIRE(pNormal != NULL && pOption != NULL, "6502 open failed for boot path");
	AtariIoOpenWithMemory(pNormal, 0, NULL, ATARI_VIDEO_PAL, ATARI_MEMORY_NONE);
	AtariIoOpenWithMemory(pOption, ATARI_MODE_OPTION_ON_START, NULL,
			ATARI_VIDEO_PAL, ATARI_MEMORY_NONE);
	pNormalIo = (IoData_t *)pNormal->pIoData;
	pOptionIo = (IoData_t *)pOption->pIoData;
	_6502_Reset(pNormal);
	_6502_Reset(pOption);
	for(unsigned lInstruction = 0; lInstruction < 1000; lInstruction++)
	{
		_6502_Execute(pNormal);
		_6502_Execute(pOption);
	}
	REQUIRE(pNormalIo->bBasicRomEnabled,
			"normal boot did not leave BASIC enabled (PC=%04X)",
			pNormal->tCpu.pc);
	REQUIRE(!pOptionIo->bBasicRomEnabled,
			"Option-on-Start boot left BASIC enabled (PC=%04X)",
			pOption->tCpu.pc);

	AtariIoClose(pNormal);
	AtariIoClose(pOption);
	_6502_Close(pNormal);
	_6502_Close(pOption);
	return 1;
}

int main(void)
{
	if(!TestConsolReadContract())
		return 1;
	if(!TestOptionBootPath())
		return 1;

	printf("gtia_consol_probe passed\n");
	return 0;
}
