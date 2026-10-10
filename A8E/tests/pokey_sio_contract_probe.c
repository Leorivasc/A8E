#include <stdio.h>
#include <string.h>

#include <SDL2/SDL.h>

#include "6502.h"
#include "AtariIo.h"
#include "Pokey.h"

SDL_Window *g_pSdlWindow = NULL;

#ifndef A8E_TRACE_FIXTURE_PATH
#define A8E_TRACE_FIXTURE_PATH "implementation/traces/pokey_sio_contract.jsonl"
#endif

#define REQUIRE(condition, format, ...)                                  \
    do                                                                   \
    {                                                                    \
        if(!(condition))                                                 \
        {                                                                \
            fprintf(stderr, "%s: " format "\n", __func__, ##__VA_ARGS__); \
            return 0;                                                    \
        }                                                                \
    } while(0)

static _6502_Context_t *OpenMachine(void)
{
    _6502_Context_t *pContext = _6502_Open();

    if(pContext == NULL)
    {
        return NULL;
    }

    AtariIoOpen(pContext, 0, NULL, ATARI_VIDEO_PAL);
    return pContext;
}

static void CloseMachine(_6502_Context_t *pContext)
{
    if(pContext)
    {
        AtariIoClose(pContext);
        _6502_Close(pContext);
    }
}

static int RunTrace(_6502_Context_t *pContext, FILE *pFixture)
{
    char aLine[512];
    unsigned uEvent = 0;

    while(fgets(aLine, sizeof(aLine), pFixture))
    {
        char aStep[96];
        unsigned uSkctl;
        unsigned uAudctl;
        unsigned uAudf2;
        unsigned uAudf4;
        unsigned uTimer;
        unsigned uPeriod;
        int nFields;

        aLine[strcspn(aLine, "\r\n")] = '\0';
        nFields = sscanf(aLine,
            "{\"step\":\"%95[^\"]\",\"skctl\":%u,\"audctl\":%u,"
            "\"audf2\":%u,\"audf4\":%u,\"timer\":%u,\"period\":%u}",
            aStep, &uSkctl, &uAudctl, &uAudf2, &uAudf4, &uTimer, &uPeriod);
        REQUIRE(nFields == 7, "invalid SIO fixture line %u", uEvent);
        REQUIRE(uTimer == 0 || uTimer == 2 || uTimer == 4,
            "invalid timer %u in fixture line %u", uTimer, uEvent);

        pContext->pShadowMemory[IO_SKCTL_SKSTAT] = (u8)uSkctl;
        pContext->pShadowMemory[IO_AUDCTL_ALLPOT] = (u8)uAudctl;
        pContext->pShadowMemory[IO_AUDF2_POT2] = (u8)uAudf2;
        pContext->pShadowMemory[IO_AUDF4_POT6] = (u8)uAudf4;

        REQUIRE(Pokey_SerialOutputClockTimer(pContext) == (u8)uTimer,
            "SIO fixture %s selected timer %u, expected %u",
            aStep, Pokey_SerialOutputClockTimer(pContext), uTimer);
        if(uTimer != 0)
        {
            REQUIRE(Pokey_TimerPeriodCpuCycles(pContext, (u8)uTimer) == (u64)uPeriod,
                "SIO fixture %s expected %u CPU cycles", aStep, uPeriod);
        }
        uEvent++;
    }

    REQUIRE(uEvent > 0, "SIO fixture is empty");
	return 1;
}

static void SendSioFrame(_6502_Context_t *pContext, const u8 *pFrame)
{
	u32 lIndex;
	for(lIndex = 0; lIndex < 5u; lIndex++)
	{
		u8 cValue = pFrame[lIndex];
		Pokey_SEROUT_SERIN(pContext, &cValue);
	}
}

static u8 ReceiveSioByte(_6502_Context_t *pContext)
{
	return *Pokey_SEROUT_SERIN(pContext, NULL);
}

static int RunStatusLatchContract(_6502_Context_t *pContext)
{
	u8 aDisk[16 + 128 * 4];
	const u8 aStatusFrame[5] = { 0x31, 0x53, 0x00, 0x00, 0x84 };
	const u8 aReadFrame[5] = { 0x31, 0x52, 0x01, 0x00, 0x84 };
	u32 lIndex;

	memset(aDisk, 0, sizeof(aDisk));
	aDisk[0] = 0x96;
	aDisk[1] = 0x02;
	aDisk[4] = 128;
	REQUIRE(AtariIoMountDisk(pContext, 0u, aDisk, sizeof(aDisk),
		"status-contract.atr", 1u), "cannot mount status contract disk");

	/* AHRM 10.2: prior to a sector operation, STATUS reflects the reset
	 * FDC latch rather than a fabricated all-clear state. */
	SendSioFrame(pContext, aStatusFrame);
	REQUIRE(ReceiveSioByte(pContext) == 'A', "initial STATUS missing ACK");
	REQUIRE(ReceiveSioByte(pContext) == 'C', "initial STATUS missing Complete");
	REQUIRE(ReceiveSioByte(pContext) == 0x10, "initial STATUS drive flags");
	REQUIRE(ReceiveSioByte(pContext) == 0x00, "initial STATUS FDC latch");
	REQUIRE(ReceiveSioByte(pContext) == 0xE0, "initial STATUS format timeout");
	REQUIRE(ReceiveSioByte(pContext) == 0x00, "initial STATUS reserved byte");
	REQUIRE(ReceiveSioByte(pContext) == 0xF0, "initial STATUS checksum");

	SendSioFrame(pContext, aReadFrame);
	REQUIRE(ReceiveSioByte(pContext) == 'A', "READ missing ACK");
	for(lIndex = 0; lIndex < 130u; lIndex++) ReceiveSioByte(pContext);

	SendSioFrame(pContext, aStatusFrame);
	REQUIRE(ReceiveSioByte(pContext) == 'A', "post-read STATUS missing ACK");
	REQUIRE(ReceiveSioByte(pContext) == 'C', "post-read STATUS missing Complete");
	REQUIRE(ReceiveSioByte(pContext) == 0x10, "post-read STATUS drive flags");
	REQUIRE(ReceiveSioByte(pContext) == 0xFF, "post-read STATUS FDC latch");
	REQUIRE(ReceiveSioByte(pContext) == 0xE0, "post-read STATUS format timeout");
	REQUIRE(ReceiveSioByte(pContext) == 0x00, "post-read STATUS reserved byte");
	REQUIRE(ReceiveSioByte(pContext) == 0xF0, "post-read STATUS checksum");
	return 1;
}

int main(void)
{
    _6502_Context_t *pContext = OpenMachine();
    FILE *pFixture;
    int bPassed;

    if(!pContext)
    {
        return 1;
    }

    pFixture = fopen(A8E_TRACE_FIXTURE_PATH, "r");
    if(!pFixture)
    {
        fprintf(stderr, "cannot open SIO fixture: %s\n", A8E_TRACE_FIXTURE_PATH);
        CloseMachine(pContext);
        return 1;
    }

	bPassed = RunTrace(pContext, pFixture);
	fclose(pFixture);
	if(bPassed) bPassed = RunStatusLatchContract(pContext);
    CloseMachine(pContext);
    if(!bPassed)
    {
        return 1;
    }

    printf("pokey_sio_contract_probe passed\n");
    return 0;
}
