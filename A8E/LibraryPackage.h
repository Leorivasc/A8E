#ifndef A8E_LIBRARY_PACKAGE_H
#define A8E_LIBRARY_PACKAGE_H

#include <stdint.h>

#include "LibraryArchive.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct
{
	uint32_t lMaxArchiveSize;
	uint32_t lMaxManifestSize;
	uint32_t lMaxPayloadSize;
	uint32_t lMaxPayloadTotal;
} A8E_LibraryPackageLimits_t;

/* Zero-valued limit fields use these safe defaults. Callers may override any
 * individual field through the WithLimits APIs. */
#define A8E_LIBRARY_PACKAGE_DEFAULT_MAX_ARCHIVE_SIZE (256u * 1024u * 1024u)
#define A8E_LIBRARY_PACKAGE_DEFAULT_MAX_MANIFEST_SIZE (16u * 1024u * 1024u)
#define A8E_LIBRARY_PACKAGE_DEFAULT_MAX_PAYLOAD_SIZE (64u * 1024u * 1024u)
#define A8E_LIBRARY_PACKAGE_DEFAULT_MAX_PAYLOAD_TOTAL (256u * 1024u * 1024u)

void A8E_LibraryPackage_DefaultLimits(
	A8E_LibraryPackageLimits_t *pLimits);

/* Computes the lowercase hexadecimal SHA-256 identity used by library.json. */
void A8E_LibraryPackage_Sha256Hex(
	const uint8_t *pBytes,
	uint32_t lSize,
	char aHex[65]);

/* The package layer owns the library.json entry and delegates ZIP mechanics
 * to LibraryArchive. Payload names must be relative blob paths. */
int A8E_LibraryPackage_ValidateManifest(
    const uint8_t *pJson,
    uint32_t lJsonSize,
    uint32_t *pLibraryVersion,
    char *pError,
    uint32_t lErrorSize);

int A8E_LibraryPackage_ValidateManifestWithSchema(
	const uint8_t *pJson,
	uint32_t lJsonSize,
	uint32_t *pSchemaVersion,
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

int A8E_LibraryPackage_WriteWithLimits(
	const uint8_t *pManifest,
	uint32_t lManifestSize,
	const A8E_LibraryArchiveInput_t *pPayloads,
	uint16_t sPayloadCount,
	const A8E_LibraryPackageLimits_t *pLimits,
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

int A8E_LibraryPackage_ReadWithLimits(
	const uint8_t *pArchive,
	uint32_t lArchiveSize,
	const A8E_LibraryPackageLimits_t *pLimits,
	A8E_LibraryArchiveEntry_t **ppEntries,
	uint16_t *pEntryCount,
	uint32_t *pLibraryVersion,
	char *pError,
	uint32_t lErrorSize);

#ifdef __cplusplus
}
#endif

#endif
