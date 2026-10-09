#ifndef A8E_LIBRARY_ARCHIVE_H
#define A8E_LIBRARY_ARCHIVE_H

#include <stddef.h>
#include <stdint.h>

typedef struct
{
    const char *pName;
    const uint8_t *pBytes;
    uint32_t lSize;
} A8E_LibraryArchiveInput_t;

typedef struct
{
    char *pName;
    uint8_t *pBytes;
    uint32_t lSize;
} A8E_LibraryArchiveEntry_t;

int A8E_LibraryArchive_Write(
    const A8E_LibraryArchiveInput_t *pEntries,
    uint16_t sEntryCount,
    uint8_t **ppArchive,
    uint32_t *plArchiveSize,
    char *pError,
    size_t lErrorSize);

int A8E_LibraryArchive_Read(
    const uint8_t *pArchive,
    uint32_t lArchiveSize,
    A8E_LibraryArchiveEntry_t **ppEntries,
    uint16_t *psEntryCount,
    char *pError,
    size_t lErrorSize);

void A8E_LibraryArchive_FreeEntries(
    A8E_LibraryArchiveEntry_t *pEntries,
    uint16_t sEntryCount);

uint32_t A8E_LibraryArchive_Crc32(const uint8_t *pBytes, uint32_t lSize);

#endif
