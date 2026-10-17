#ifndef A8E_LIBRARY_STORE_H
#define A8E_LIBRARY_STORE_H

#include <stdint.h>

#include "LibraryArchive.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct
{
    A8E_LibraryArchiveEntry_t *pEntries;
    uint16_t sEntryCount;
    uint32_t lLibraryVersion;
} A8E_LibraryStore_t;

void A8E_LibraryStore_Init(A8E_LibraryStore_t *pStore);
void A8E_LibraryStore_Free(A8E_LibraryStore_t *pStore);

/* Reads and validates into a temporary snapshot first. The visible store is
 * changed only after the complete package has passed validation. */
int A8E_LibraryStore_ImportPackage(
    A8E_LibraryStore_t *pStore,
    const uint8_t *pArchive,
    uint32_t lArchiveSize,
    char *pError,
    uint32_t lErrorSize);

#ifdef __cplusplus
}
#endif

#endif
