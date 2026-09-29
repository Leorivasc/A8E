#include <stdio.h>

#include <SDL2/SDL.h>

#include "6502.h"
#include "AtariIo.h"
#include "Pia.h"

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

static void WriteControl(_6502_Context_t *pContext, u16 sAddress, u8 cValue)
{
	pContext->sAccessAddress = sAddress;
	if(sAddress == IO_PACTL)
		Pia_PACTL(pContext, &cValue);
	else
		Pia_PBCTL(pContext, &cValue);
}

static u8 ReadControl(_6502_Context_t *pContext, u16 sAddress)
{
	pContext->sAccessAddress = sAddress;
	return sAddress == IO_PACTL ? *Pia_PACTL(pContext, NULL) : *Pia_PBCTL(pContext, NULL);
}

static int TestPiaControlLines(_6502_Context_t *pContext)
{
	/* CA1: positive edge, interrupt enabled. The status bit must latch even
	 * when it is later masked, and enabling it again must expose the IRQ. */
	WriteControl(pContext, IO_PACTL, 0x03);
	Pia_SetCa1Line(pContext, 0);
	Pia_SetCa1Line(pContext, 1);
	REQUIRE((ReadControl(pContext, IO_PACTL) & 0xc0) == 0x80,
			"CA1 positive edge did not latch IRQA1");
	REQUIRE(Pia_IrqAsserted(pContext), "enabled CA1 status did not assert PIA IRQ");

	WriteControl(pContext, IO_PACTL, 0x02);
	REQUIRE((ReadControl(pContext, IO_PACTL) & 0xc0) == 0x80,
			"masking CA1 cleared the pending status");
	REQUIRE(!Pia_IrqAsserted(pContext), "masked CA1 status still asserted PIA IRQ");

	/* DDRA reads do not acknowledge. Switching to ORA and reading it does. */
	WriteControl(pContext, IO_PACTL, 0x06);
	REQUIRE((ReadControl(pContext, IO_PACTL) & 0xc0) == 0x80,
			"control read unexpectedly acknowledged CA1");
	pContext->sAccessAddress = IO_PORTA;
	Pia_PORTA(pContext, NULL);
	REQUIRE((ReadControl(pContext, IO_PACTL) & 0xc0) == 0,
			"ORA read did not acknowledge both PIA status bits");

	/* CA2 negative input edge is independently latched and acknowledged by
	 * ORA, just like CA1. */
	WriteControl(pContext, IO_PACTL, 0x0d);
	Pia_SetCa2Line(pContext, 1);
	Pia_SetCa2Line(pContext, 0);
	REQUIRE((ReadControl(pContext, IO_PACTL) & 0xc0) == 0x40,
			"CA2 negative edge did not latch IRQA2 (control=%02X level=%u status=%02X)",
			SRAM[IO_PACTL], ((IoData_t *)pContext->pIoData)->cPiaCa2Level,
			((IoData_t *)pContext->pIoData)->cPiaStatusA);
	pContext->sAccessAddress = IO_PORTA;
	Pia_PORTA(pContext, NULL);

	/* AHRM 2.5: CB2 low-to-high output followed by input selection can
	 * generate a spurious IRQB2. */
	WriteControl(pContext, IO_PBCTL, 0x34);
	WriteControl(pContext, IO_PBCTL, 0x3c);
	WriteControl(pContext, IO_PBCTL, 0x04);
	REQUIRE((ReadControl(pContext, IO_PBCTL) & 0xc0) == 0x40,
			"CB2 output-to-input spurious status was not modeled");
	WriteControl(pContext, IO_PBCTL, 0x34);
	REQUIRE((ReadControl(pContext, IO_PBCTL) & 0x40) == 0,
			"CB2 output mode did not clear IRQB2 status");
	return 1;
}

int main(void)
{
	_6502_Context_t *pContext;

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
	if(!TestPiaControlLines(pContext))
	{
		AtariIoClose(pContext);
		_6502_Close(pContext);
		SDL_Quit();
		return 1;
	}
	AtariIoClose(pContext);
	_6502_Close(pContext);
	SDL_Quit();
	printf("pia_control_probe passed\n");
	return 0;
}
