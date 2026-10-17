#include "LibraryStore.h"

#include <stdio.h>
#include <string.h>

#include "LibraryPackage.h"

void A8E_LibraryStore_Init(A8E_LibraryStore_t *pStore)
{
    if(!pStore) return;
    memset(pStore, 0, sizeof(*pStore));
}

void A8E_LibraryStore_Free(A8E_LibraryStore_t *pStore)
{
    if(!pStore) return;
    A8E_LibraryArchive_FreeEntries(pStore->pEntries, pStore->sEntryCount);
    memset(pStore, 0, sizeof(*pStore));
}

int A8E_LibraryStore_ImportPackage(
    A8E_LibraryStore_t *pStore,
    const uint8_t *pArchive,
    uint32_t lArchiveSize,
    char *pError,
    uint32_t lErrorSize)
{
    A8E_LibraryArchiveEntry_t *pStagedEntries = NULL;
    uint16_t sStagedCount = 0;
    uint32_t lStagedVersion = 0;

    if(!pStore)
    {
        if(pError && lErrorSize) snprintf(pError, lErrorSize, "%s", "store is missing");
        return 0;
    }
    if(!A8E_LibraryPackage_Read(
        pArchive, lArchiveSize, &pStagedEntries, &sStagedCount,
        &lStagedVersion, pError, lErrorSize)) return 0;

    /* The old snapshot is released only after the new one is completely
     * decoded and verified. No caller can observe a partial replacement. */
    A8E_LibraryArchive_FreeEntries(pStore->pEntries, pStore->sEntryCount);
    pStore->pEntries = pStagedEntries;
    pStore->sEntryCount = sStagedCount;
    pStore->lLibraryVersion = lStagedVersion;
    return 1;
}
