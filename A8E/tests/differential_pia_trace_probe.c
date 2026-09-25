#include <stdio.h>
#include <string.h>

#include <SDL2/SDL.h>

#include "6502.h"
#include "AtariIo.h"
#include "Pia.h"

SDL_Window *g_pSdlWindow = NULL;

#ifndef A8E_TRACE_FIXTURE_PATH
#define A8E_TRACE_FIXTURE_PATH "implementation/traces/pia_portb_contract.jsonl"
#endif

#define REQUIRE(condition, format, ...)                                  \
	do                                                                     \
	{                                                                      \
		if(!(condition))                                                     \
		{                                                                   \
			fprintf(stderr, "%s: " format "\n", __func__, ##__VA_ARGS__); \
			return 0;                                                         \
		}                                                                   \
	} while(0)

static void WriteControl(_6502_Context_t *pContext, u16 sAddress, u8 cValue)
{
	pContext->sAccessAddress = sAddress;
	if(sAddress == IO_PACTL)
		Pia_PACTL(pContext, &cValue);
	else
		Pia_PBCTL(pContext, &cValue);
}

static void WritePortB(_6502_Context_t *pContext, u8 cValue)
{
	pContext->sAccessAddress = IO_PORTB;
	Pia_PORTB(pContext, &cValue);
}

static int CompareTraceLine(
	FILE *pFixture,
	_6502_Context_t *pContext,
	const char *pStep,
	u32 lEvent)
{
	IoData_t *pIoData = (IoData_t *)pContext->pIoData;
	char aExpected[512];
	char aActual[512];

	if(!fgets(aExpected, sizeof(aExpected), pFixture))
	{
		fprintf(stderr, "trace fixture ended before event %u (%s)\n", (unsigned)lEvent, pStep);
		return 0;
	}
	aExpected[strcspn(aExpected, "\r\n")] = '\0';
	snprintf(aActual, sizeof(aActual),
		"{\"step\":\"%s\",\"event\":%u,\"cycle\":%llu,"
		"\"pactl\":%u,\"pbctl\":%u,\"portb\":%u,\"ddrb\":%u,"
		"\"orb\":%u,\"irq\":%u}",
		pStep,
		(unsigned)lEvent,
		(unsigned long long)pContext->llCycleCounter,
		(unsigned)RAM[IO_PACTL],
		(unsigned)RAM[IO_PBCTL],
		(unsigned)SRAM[IO_PORTB],
		(unsigned)pIoData->cDirectionPortB,
		(unsigned)pIoData->cOutputPortB,
		(unsigned)Pia_IrqAsserted(pContext));
	if(strcmp(aExpected, aActual) != 0)
	{
		fprintf(stderr, "trace mismatch at event %u (%s)\nexpected: %s\nactual:   %s\n",
			(unsigned)lEvent, pStep, aExpected, aActual);
		return 0;
	}
	return 1;
}

static int RunTrace(_6502_Context_t *pContext, FILE *pFixture)
{
	static const struct
	{
		const char *pStep;
		u8 cAddress;
		u8 cValue;
	} aOperations[] = {
		{"select-ddrb", 0, 0x00},
		{"write-ddrb-zero", 1, 0x00},
		{"select-orb", 0, 0x04},
		{"write-orb-zero", 1, 0x00},
		{"select-ddrb-again", 0, 0x00},
		{"write-ddrb-03", 1, 0x03},
		{"select-orb-again", 0, 0x04},
		{"write-orb-ff", 1, 0xff},
		{"write-orb-final-zero", 1, 0x00},
		{"select-ddrb-final", 0, 0x00},
		{"write-ddrb-f0", 1, 0xf0},
	};
	u32 i;

	REQUIRE(CompareTraceLine(pFixture, pContext, "reset", 0), "reset trace mismatch");
	for(i = 0; i < sizeof(aOperations) / sizeof(aOperations[0]); i++)
	{
		pContext->llCycleCounter = (u64)i + 1;
		if(aOperations[i].cAddress == 0)
			WriteControl(pContext, IO_PBCTL, aOperations[i].cValue);
		else
			WritePortB(pContext, aOperations[i].cValue);
		REQUIRE(CompareTraceLine(pFixture, pContext, aOperations[i].pStep, i + 1),
			"event %u trace mismatch", (unsigned)(i + 1));
	}
	return 1;
}

int main(void)
{
	_6502_Context_t *pContext;
	FILE *pFixture;
	int bPassed;

	if(SDL_Init(SDL_INIT_AUDIO) != 0)
	{
		fprintf(stderr, "SDL_Init failed: %s\n", SDL_GetError());
		return 1;
	}
	pContext = _6502_Open();
	if(!pContext)
	{
		SDL_Quit();
		return 1;
	}
	AtariIoOpenWithMemory(pContext, 0, NULL, ATARI_VIDEO_PAL, ATARI_MEMORY_NONE);
	pFixture = fopen(A8E_TRACE_FIXTURE_PATH, "r");
	if(!pFixture)
	{
		fprintf(stderr, "cannot open trace fixture: %s\n", A8E_TRACE_FIXTURE_PATH);
		AtariIoClose(pContext);
		_6502_Close(pContext);
		SDL_Quit();
		return 1;
	}
	bPassed = RunTrace(pContext, pFixture);
	if(bPassed)
	{
		char cExtra;
		if(fscanf(pFixture, " %c", &cExtra) == 1)
		{
			fprintf(stderr, "trace fixture contains an unexpected extra event\n");
			bPassed = 0;
		}
	}
	fclose(pFixture);
	AtariIoClose(pContext);
	_6502_Close(pContext);
	SDL_Quit();
	if(!bPassed)
		return 1;
	printf("differential_pia_trace_probe passed\n");
	return 0;
}
