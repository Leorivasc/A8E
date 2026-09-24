#include <stdio.h>
#include <string.h>

#include <SDL2/SDL.h>

#include "6502.h"
#include "Antic.h"
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

typedef struct
{
	AtariMemoryExpansion_t eProfile;
	u8 cBankMask;
	u8 cBankCount;
	u8 bSeparateAnticWindow;
} MemoryProfileTest_t;

static void WritePortB(_6502_Context_t *pContext, u8 cValue)
{
	pContext->sAccessAddress = IO_PORTB;
	Pia_PORTB(pContext, &cValue);
}

static void ConfigurePortBOutputs(_6502_Context_t *pContext)
{
	u8 cValue;

	/* Set the ORB latch high before changing DDRB, so the expansion starts
	 * from a fully driven high PORTB value. */
	pContext->sAccessAddress = IO_PBCTL;
	cValue = 0x04;
	Pia_PBCTL(pContext, &cValue);
	WritePortB(pContext, 0xff);
	cValue = 0x00;
	Pia_PBCTL(pContext, &cValue);
	WritePortB(pContext, 0xff);
	cValue = 0x04;
	Pia_PBCTL(pContext, &cValue);
}

static u8 ReadAnticByte(_6502_Context_t *pContext)
{
	IoData_t *pIoData = (IoData_t *)pContext->pIoData;

	pIoData->llDisplayListFetchCycle = 0;
	pIoData->llCycle = 0;
	pContext->pShadowMemory[IO_DMACTL] = 0x23;
	return AtariIoTimingProbeFetchUnbufferedDisplayByte(pContext, 0x4000, 0);
}

static u8 PortBForBank(u8 cBankMask, u8 cBank)
{
	u8 cPortB = 0;
	u8 cBit;
	u8 cBankBit = 0;

	for(cBit = 0; cBit < 8; cBit++)
	{
		if(cBankMask & (1u << cBit))
		{
			if(cBank & (1u << cBankBit))
				cPortB |= (u8)(1u << cBit);
			cBankBit++;
		}
	}
	return cPortB;
}

static int TestPortBDirectionLatch(void)
{
	_6502_Context_t *pContext = _6502_Open();
	IoData_t *pIoData;
	u8 cValue;
	u8 *pPortB;

	REQUIRE(pContext != NULL, "6502 open failed");
	AtariIoOpenWithMemory(pContext, 0, NULL, ATARI_VIDEO_PAL, ATARI_MEMORY_NONE);
	pIoData = (IoData_t *)pContext->pIoData;
	REQUIRE(pIoData->cOutputPortB == 0x00 && pIoData->cDirectionPortB == 0x00,
			"PIA reset latches are not zero");
	REQUIRE(pContext->pMemory[IO_PORTB] == 0xff &&
			pContext->pShadowMemory[IO_PORTB] == 0xff,
			"PIA reset PORTB pull-ups are not high");

	/* DDRB writes change direction only; with all bits configured as inputs,
	 * the pulled-up pins read high regardless of the ORB latch. */
	cValue = 0x00;
	Pia_PBCTL(pContext, &cValue);
	WritePortB(pContext, 0x00);
	REQUIRE(pIoData->cDirectionPortB == 0x00, "DDRB latch was not written");
	REQUIRE(pContext->pMemory[IO_PORTB] == 0xff,
			"input PORTB did not read high (%02X)", pContext->pMemory[IO_PORTB]);

	/* ORB writes update the output latch without changing DDRB. */
	cValue = 0x04;
	Pia_PBCTL(pContext, &cValue);
	WritePortB(pContext, 0x00);
	REQUIRE(pIoData->cOutputPortB == 0x00, "ORB latch was not written");
	REQUIRE(pIoData->cDirectionPortB == 0x00, "ORB write changed DDRB");
	REQUIRE(pContext->pMemory[IO_PORTB] == 0xff,
			"input PORTB was not pulled high after ORB write");

	/* Output bits use ORB while input bits remain pulled high. */
	cValue = 0x00;
	Pia_PBCTL(pContext, &cValue);
	WritePortB(pContext, 0x03);
	REQUIRE(pContext->pMemory[IO_PORTB] == 0xfc,
			"effective PORTB did not combine ORB and DDRB (%02X)",
			pContext->pMemory[IO_PORTB]);
	pPortB = Pia_PORTB(pContext, NULL);
	REQUIRE(pPortB == &pIoData->cDirectionPortB && *pPortB == 0x03,
			"DDRB read did not return its direction latch");

	/* Changing DDRB must preserve the ORB latch and recompute the pins. */
	cValue = 0x04;
	Pia_PBCTL(pContext, &cValue);
	WritePortB(pContext, 0x00);
	REQUIRE(pContext->pMemory[IO_PORTB] == 0xfc,
			"ORB read did not preserve effective input pins");
	pPortB = Pia_PORTB(pContext, NULL);
	REQUIRE(pPortB == &pContext->pMemory[IO_PORTB] && *pPortB == 0xfc,
			"ORB read did not return effective PORTB");

	cValue = 0x00;
	Pia_PBCTL(pContext, &cValue);
	WritePortB(pContext, 0xf0);
	REQUIRE(pContext->pMemory[IO_PORTB] == 0x0f,
			"DDRB change did not recompute PORTB (%02X)",
			pContext->pMemory[IO_PORTB]);

	AtariIoClose(pContext);
	_6502_Close(pContext);
	return 1;
}

static int TestMemoryProfile(const MemoryProfileTest_t *pTest)
{
	_6502_Context_t *pContext = _6502_Open();
	IoData_t *pIoData;
	u8 cValue;

	REQUIRE(pContext != NULL, "6502 open failed");
	AtariIoOpenWithMemory(pContext, 0, NULL, ATARI_VIDEO_PAL, pTest->eProfile);
	pIoData = (IoData_t *)pContext->pIoData;

	/* Configure PORTB as output, then establish the motherboard view before
	 * opening the expanded CPU window. */
	ConfigurePortBOutputs(pContext);
	pContext->pMemory[0x4000] = 0xa5;
	WritePortB(pContext, 0x10);
	WritePortB(pContext, 0x00);
	REQUIRE(pIoData->bCpuExtendedWindow, "CPU window did not open");

	/* CPU writes are the live source for ANTIC while both views are active. */
	pContext->pMemory[0x4000] = 0x40;
	cValue = ReadAnticByte(pContext);
	REQUIRE(cValue == 0x40, "live CPU/ANTIC value was %02X", cValue);

	/* Every bank must retain its own value, including the high bank bits. */
	for(u8 cBank = 0; cBank < pTest->cBankCount; cBank++)
	{
		WritePortB(pContext, PortBForBank(pTest->cBankMask, cBank));
		pContext->pMemory[0x4000] = (u8)(0x40 + cBank);
	}
	for(u8 cBank = pTest->cBankCount; cBank-- > 0;)
	{
		WritePortB(pContext, PortBForBank(pTest->cBankMask, cBank));
		REQUIRE(pContext->pMemory[0x4000] == (u8)(0x40 + cBank),
				"bank %u was not retained (%02X)", cBank, pContext->pMemory[0x4000]);
	}
	WritePortB(pContext, PortBForBank(pTest->cBankMask, 0));

	/* Closing the CPU window restores motherboard RAM. COMPY/130XE keep
	 * ANTIC's independent bank view; shared profiles return motherboard RAM. */
	WritePortB(pContext, 0x10);
	REQUIRE(pContext->pMemory[0x4000] == 0xa5,
			"motherboard RAM was not restored (%02X)", pContext->pMemory[0x4000]);
	cValue = ReadAnticByte(pContext);
	REQUIRE(cValue == (pTest->bSeparateAnticWindow ? 0x40 : 0xa5),
			"ANTIC window returned %02X", cValue);

	AtariIoClose(pContext);
	_6502_Close(pContext);
	return 1;
}

static int TestUltimate1mbModes(void)
{
	_6502_Context_t *pContext = _6502_Open();
	IoData_t *pIoData;
	u8 cValue;

	REQUIRE(pContext != NULL, "6502 open failed");
	AtariIoOpenWithMemory(pContext, 0, NULL, ATARI_VIDEO_PAL, ATARI_MEMORY_ULTIMATE1MB);
	pIoData = (IoData_t *)pContext->pIoData;
	ConfigurePortBOutputs(pContext);
	WritePortB(pContext, 0x00);

	pContext->sAccessAddress = IO_U1MB_UCTL;
	cValue = 0x01;
	Pia_U1mbRegister(pContext, &cValue);
	REQUIRE(pIoData->bCpuExtendedWindow && pIoData->bAnticExtendedWindow,
			"U1MB mode 01 window matrix is wrong");

	cValue = 0x02;
	Pia_U1mbRegister(pContext, &cValue);
	REQUIRE(pIoData->bCpuExtendedWindow && pIoData->bAnticExtendedWindow,
			"U1MB mode 10 window matrix is wrong");
	REQUIRE(pIoData->cU1mbUctl == 0x02, "UCTL mode was not retained");

	cValue = 0x00;
	Pia_U1mbRegister(pContext, &cValue);
	REQUIRE(!pIoData->bCpuExtendedWindow && !pIoData->bAnticExtendedWindow,
			"U1MB mode 00 did not disable expansion");

	AtariIoClose(pContext);
	_6502_Close(pContext);
	return 1;
}

int main(int argc, char *argv[])
{
	static const MemoryProfileTest_t aTests[] =
	{
		{ATARI_MEMORY_130XE_128K, 0x0c, 4, 1},
		{ATARI_MEMORY_RAMBO_192K, 0x4c, 8, 0},
		{ATARI_MEMORY_RAMBO_320K, 0x6c, 16, 0},
		{ATARI_MEMORY_COMPY_320K, 0xcc, 16, 1},
		{ATARI_MEMORY_RAMBO_576K, 0x6e, 32, 0},
		{ATARI_MEMORY_COMPY_576K, 0xce, 32, 1},
		{ATARI_MEMORY_RAMBO_1088K, 0xee, 64, 0},
		{ATARI_MEMORY_ULTIMATE1MB, 0xee, 64, 0}
	};
	unsigned int lIndex;
	(void)argc;
	(void)argv;

	if(!TestPortBDirectionLatch())
		return 1;
	for(lIndex = 0; lIndex < sizeof(aTests) / sizeof(aTests[0]); lIndex++)
		if(!TestMemoryProfile(&aTests[lIndex]))
			return 1;
	if(!TestUltimate1mbModes())
		return 1;

	printf("memory_expansion_probe passed\n");
	return 0;
}
