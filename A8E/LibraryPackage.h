#ifndef A8E_LIBRARY_PACKAGE_H
#define A8E_LIBRARY_PACKAGE_H

#include <stdint.h>

#include "LibraryArchive.h"

#ifdef __cplusplus
extern "C" {
#endif

/* The package layer owns the library.json entry and delegates ZIP mechanics
 * to LibraryArchive. Payload names must be relative blob paths. */
int A8E_LibraryPackage_ValidateManifest(
    const uint8_t *pJson,
    uint32_t lJsonSize,
    uint32_t *pLibraryVersion,
    char *pError,
    uint32_t lErrorSize);

int A8E_LibraryPackage_Write(
    const uint8_t *pManifest,
    uint32_t lManifestSize,
    const A8E_LibraryArchiveInput_t *pPayloads,
    uint16_t sPayloadCount,
    uint8_t **ppArchive,
    uint32_t *pArchiveSize,
    char *pError,
    uint32_t lErrorSize);

int A8E_LibraryPackage_Read(
    const uint8_t *pArchive,
    uint32_t lArchiveSize,
    A8E_LibraryArchiveEntry_t **ppEntries,
    uint16_t *pEntryCount,
    uint32_t *pLibraryVersion,
    char *pError,
    uint32_t lErrorSize);

#ifdef __cplusplus
}
#endif

#endif
