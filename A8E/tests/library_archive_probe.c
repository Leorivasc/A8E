#include <stdio.h>
#include <ctype.h>
#include <stdlib.h>
#include <string.h>

#include "LibraryArchive.h"

#define REQUIRE(condition, format, ...)                                  \
    do                                                                   \
    {                                                                    \
        if(!(condition))                                                 \
        {                                                                \
            fprintf(stderr, "%s: " format "\n", __func__, ##__VA_ARGS__); \
            return 0;                                                    \
        }                                                                \
    } while(0)

static int CheckEntries(
    const A8E_LibraryArchiveEntry_t *pEntries,
    uint16_t sEntryCount,
    const A8E_LibraryArchiveInput_t *pExpected,
    uint16_t sExpectedCount)
{
    uint16_t i;
    REQUIRE(sEntryCount == sExpectedCount, "entry count %u, expected %u", sEntryCount, sExpectedCount);
    for(i = 0; i < sExpectedCount; i++)
    {
        REQUIRE(strcmp(pEntries[i].pName, pExpected[i].pName) == 0,
            "entry %u name mismatch", i);
        REQUIRE(pEntries[i].lSize == pExpected[i].lSize,
            "entry %u size mismatch", i);
        REQUIRE(memcmp(pEntries[i].pBytes, pExpected[i].pBytes, pExpected[i].lSize) == 0,
            "entry %u bytes mismatch", i);
    }
    return 1;
}

static int HexValue(int c)
{
    if(c >= '0' && c <= '9') return c - '0';
    if(c >= 'a' && c <= 'f') return c - 'a' + 10;
    if(c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

static uint8_t *ReadHexFixture(const char *pPath, uint32_t *plSize)
{
    FILE *pFile = fopen(pPath, "r");
    uint8_t *pBytes = NULL;
    uint32_t lSize = 0;
    int cHigh;

    if(!pFile) return NULL;
    while((cHigh = fgetc(pFile)) != EOF)
    {
        int cLow;
        int lHigh;
        int lLow;
        if(isspace((unsigned char)cHigh)) continue;
        cLow = fgetc(pFile);
        if(cLow == EOF || isspace((unsigned char)cLow))
        {
            free(pBytes);
            fclose(pFile);
            return NULL;
        }
        lHigh = HexValue(cHigh);
        lLow = HexValue(cLow);
        if(lHigh < 0 || lLow < 0)
        {
            free(pBytes);
            fclose(pFile);
            return NULL;
        }
        pBytes = (uint8_t *)realloc(pBytes, lSize + 1u);
        if(!pBytes)
        {
            fclose(pFile);
            return NULL;
        }
        pBytes[lSize++] = (uint8_t)((lHigh << 4) | lLow);
    }
    fclose(pFile);
    *plSize = lSize;
    return pBytes;
}

int main(void)
{
    static const char sUtf8Name[] = "blobs/\xc3\xa1.atr";
    static const uint8_t aJson[] =
        "{\"format\":\"a8e-library-export\",\"schemaVersion\":1,\"libraryVersion\":1,"
        "\"createdAt\":\"2026-10-08T15:00:00Z\",\"library\":[{\"id\":\"disk-demo\","
        "\"name\":\"demo.atr\",\"type\":\"atr\",\"path\":\"blobs/demo.atr\",\"size\":5,"
        "\"sha256\":\"ff5d8507b6a72bee2debce2c0054798deaccdc5d8a1b945b6280ce8aa9cba52e\","
        "\"createdAt\":\"2026-10-08T15:00:00Z\",\"modifiedAt\":\"2026-10-08T15:00:00Z\"}],"
        "\"workspace\":{\"devices\":{\"D1\":\"disk-demo\"},\"writeProtected\":{\"D1\":false}}}";
    static const uint8_t aAtr[] = { 0, 1, 2, 3, 0xff };
    static const uint8_t aUtf8[] = { 9, 8, 7 };
    static const A8E_LibraryArchiveInput_t aEntries[] = {
        { "library.json", aJson, (uint32_t)(sizeof(aJson) - 1) },
        { "blobs/demo.atr", aAtr, (uint32_t)sizeof(aAtr) },
        { sUtf8Name, aUtf8, (uint32_t)sizeof(aUtf8) },
    };
    A8E_LibraryArchiveEntry_t *pDecoded = NULL;
    uint8_t *pArchive = NULL;
    uint8_t *pCorrupted = NULL;
    uint8_t *pFixture = NULL;
    uint32_t lArchiveSize = 0;
    uint32_t lFixtureSize = 0;
    uint16_t sDecodedCount = 0;
    char aError[128];

    REQUIRE(A8E_LibraryArchive_Crc32(
        (const uint8_t *)"123456789", 9) == 0xcbf43926u,
        "CRC-32 vector mismatch");

    REQUIRE(A8E_LibraryArchive_Write(
        aEntries,
        (uint16_t)(sizeof(aEntries) / sizeof(aEntries[0])),
        &pArchive,
        &lArchiveSize,
        aError,
        sizeof(aError)),
        "write failed: %s", aError);
    REQUIRE(lArchiveSize > 22 && pArchive[0] == 0x50 && pArchive[1] == 0x4b,
        "invalid ZIP output");
    pFixture = ReadHexFixture("implementation/traces/library_archive_contract.hex", &lFixtureSize);
    REQUIRE(pFixture != NULL && lFixtureSize == lArchiveSize &&
        memcmp(pFixture, pArchive, lArchiveSize) == 0,
        "writer output differs from shared archive fixture");
    REQUIRE(A8E_LibraryArchive_Read(
        pFixture,
        lFixtureSize,
        &pDecoded,
        &sDecodedCount,
        aError,
        sizeof(aError)),
        "shared fixture read failed: %s", aError);
    REQUIRE(CheckEntries(
        pDecoded,
        sDecodedCount,
        aEntries,
        (uint16_t)(sizeof(aEntries) / sizeof(aEntries[0]))),
        "shared fixture contents mismatch");
    A8E_LibraryArchive_FreeEntries(pDecoded, sDecodedCount);
    pDecoded = NULL;
    free(pFixture);
    pFixture = NULL;

    REQUIRE(A8E_LibraryArchive_Read(
        pArchive,
        lArchiveSize,
        &pDecoded,
        &sDecodedCount,
        aError,
        sizeof(aError)),
        "read failed: %s", aError);
    REQUIRE(CheckEntries(
        pDecoded,
        sDecodedCount,
        aEntries,
        (uint16_t)(sizeof(aEntries) / sizeof(aEntries[0]))),
        "round trip mismatch");
    A8E_LibraryArchive_FreeEntries(pDecoded, sDecodedCount);
    pDecoded = NULL;

    pCorrupted = (uint8_t *)malloc(lArchiveSize);
    REQUIRE(pCorrupted != NULL, "out of memory");
    memcpy(pCorrupted, pArchive, lArchiveSize);
    pCorrupted[30 + strlen(aEntries[0].pName)] ^= 1;
    REQUIRE(!A8E_LibraryArchive_Read(
        pCorrupted,
        lArchiveSize,
        &pDecoded,
        &sDecodedCount,
        aError,
        sizeof(aError)),
        "corrupted archive was accepted");
    free(pCorrupted);
    pCorrupted = NULL;

    {
        static const A8E_LibraryArchiveInput_t invalid = { "../outside", aAtr, 1 };
        uint8_t *pInvalidArchive = NULL;
        REQUIRE(!A8E_LibraryArchive_Write(
            &invalid, 1, &pInvalidArchive, &lArchiveSize, aError, sizeof(aError)),
            "unsafe path was accepted");
        free(pInvalidArchive);
    }

    {
        static const char sInvalidName[] = { 'b', 'l', 'o', 'b', 's', '/', (char)0xc3, '\0' };
        static const A8E_LibraryArchiveInput_t invalid = { sInvalidName, aAtr, 1 };
        uint8_t *pInvalidArchive = NULL;
        REQUIRE(!A8E_LibraryArchive_Write(
            &invalid, 1, &pInvalidArchive, &lArchiveSize, aError, sizeof(aError)),
            "invalid UTF-8 path was accepted");
        free(pInvalidArchive);
    }

    free(pArchive);
    free(pFixture);
    printf("library_archive_probe passed\n");
    return 0;
}
