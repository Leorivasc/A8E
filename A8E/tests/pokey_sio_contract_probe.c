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
    CloseMachine(pContext);
    if(!bPassed)
    {
        return 1;
    }

    printf("pokey_sio_contract_probe passed\n");
    return 0;
}
