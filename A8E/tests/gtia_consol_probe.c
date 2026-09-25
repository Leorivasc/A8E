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

int main(void)
{
	if(!TestConsolReadContract())
		return 1;

	printf("gtia_consol_probe passed\n");
	return 0;
}
