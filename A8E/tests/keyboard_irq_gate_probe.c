#include <stdio.h>
#include <string.h>

#include <SDL2/SDL.h>

#include "6502.h"
#include "AtariIo.h"
#include "Pokey.h"

SDL_Window *g_pSdlWindow = NULL;

static int SendKey(_6502_Context_t *pContext, SDL_Keycode sKey)
{
	SDL_KeyboardEvent tEvent;

	memset(&tEvent, 0, sizeof(tEvent));
	tEvent.type = SDL_KEYDOWN;
	tEvent.keysym.sym = sKey;
	AtariIoKeyboardEvent(pContext, &tEvent);
	return 1;
}

int main(void)
{
	_6502_Context_t *pContext = _6502_Open();

	if(!pContext)
	{
		fprintf(stderr, "could not open keyboard probe machine\n");
		return 1;
	}
	AtariIoOpen(pContext, 0, NULL, ATARI_VIDEO_NTSC);

	/* AHRM 5.7/5.8: a masked key still updates KBCODE but IRQST is locked
	 * high, so enabling bit 6 later cannot deliver the old key. */
	pContext->pMemory[IO_IRQEN_IRQST] = 0xff;
	pContext->pShadowMemory[IO_IRQEN_IRQST] = 0x00;
	SendKey(pContext, SDLK_a);
	if(pContext->pMemory[IO_STIMER_KBCODE] == 0xff ||
	   (pContext->pMemory[IO_IRQEN_IRQST] & IRQ_OTHER_KEY_PRESSED) == 0)
	{
		fprintf(stderr, "masked keyboard event incorrectly latched IRQST\n");
		AtariIoClose(pContext);
		_6502_Close(pContext);
		return 1;
	}

	pContext->pMemory[IO_IRQEN_IRQST] = 0xff;
	pContext->pShadowMemory[IO_IRQEN_IRQST] = IRQ_OTHER_KEY_PRESSED;
	((IoData_t *)pContext->pIoData)->llTimer1Cycle = pContext->llCycleCounter;
	AtariIoCycleTimedEventUpdate(pContext);
	_6502_Run(pContext, pContext->llCycleCounter + 8);
	if((pContext->pMemory[IO_IRQEN_IRQST] & IRQ_TIMER_1) == 0)
	{
		fprintf(stderr, "masked timer incorrectly latched IRQST\n");
		AtariIoClose(pContext);
		_6502_Close(pContext);
		return 1;
	}
	SendKey(pContext, SDLK_b);
	if(pContext->pMemory[IO_IRQEN_IRQST] & IRQ_OTHER_KEY_PRESSED)
	{
		fprintf(stderr, "enabled keyboard event did not latch IRQST\n");
		AtariIoClose(pContext);
		_6502_Close(pContext);
		return 1;
	}

	AtariIoClose(pContext);
	_6502_Close(pContext);
	printf("keyboard_irq_gate_probe passed\n");
	return 0;
}
