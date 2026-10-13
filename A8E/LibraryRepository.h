#ifndef A8E_LIBRARY_REPOSITORY_H
#define A8E_LIBRARY_REPOSITORY_H

#include <stdint.h>

#include "LibraryArchive.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct
{
	char *pId;
	char *pName;
	char *pType;
	char *pPath;
	char *pFolderId;
	uint32_t lSize;
	int32_t lMountedSlot;
	uint32_t lObjectStart;
	uint32_t lObjectEnd;
} A8E_LibraryRepositoryRecord_t;

/* The native local repository mirrors the portable layout:
 *
 *   <root>/library.json
 *   <root>/blobs/<sha256>.<type>
 *
 * The repository owns all returned buffers. Call Free before reusing it. */
typedef struct
{
	uint8_t *pManifest;
	uint32_t lManifestSize;
	A8E_LibraryArchiveEntry_t *pPayloads;
	uint16_t sPayloadCount;
	uint32_t lLibraryVersion;
	A8E_LibraryRepositoryRecord_t *pRecords;
	uint16_t sRecordCount;
	char acDeviceEntryId[8][257];
	uint8_t abDeviceWriteProtected[8];
} A8E_LibraryRepository_t;

void A8E_LibraryRepository_Init(A8E_LibraryRepository_t *pRepository);
void A8E_LibraryRepository_Free(A8E_LibraryRepository_t *pRepository);

/* Loads and validates the complete directory before replacing the current
 * repository snapshot. Missing or invalid blobs leave the old snapshot intact. */
int A8E_LibraryRepository_LoadDirectory(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	char *pError,
	uint32_t lErrorSize);

/* Persists the complete snapshot. Blobs are written before library.json so a
 * metadata file never points at a newly missing payload. */
int A8E_LibraryRepository_SaveDirectory(
	const A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	char *pError,
	uint32_t lErrorSize);

const A8E_LibraryRepositoryRecord_t *A8E_LibraryRepository_GetRecord(
	const A8E_LibraryRepository_t *pRepository,
	uint16_t sIndex);

const uint8_t *A8E_LibraryRepository_GetPayload(
	const A8E_LibraryRepository_t *pRepository,
	const char *pPath,
	uint32_t *pSize);

const char *A8E_LibraryRepository_GetDeviceEntryId(
	const A8E_LibraryRepository_t *pRepository,
	uint32_t lDrive);

uint8_t A8E_LibraryRepository_IsDeviceWriteProtected(
	const A8E_LibraryRepository_t *pRepository,
	uint32_t lDrive);

/* Replaces one entry's current working bytes, updates its content-addressed
 * path/size/hash and libraryVersion, then persists and reloads atomically. */
int A8E_LibraryRepository_SaveWorkingCopy(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pEntryId,
	const uint8_t *pBytes,
	uint32_t lSize,
	char *pError,
	uint32_t lErrorSize);

/* Removes an unmounted entry and its now-unreferenced payload. */
int A8E_LibraryRepository_RemoveEntry(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pEntryId,
	char *pError,
	uint32_t lErrorSize);

/* Persists the current D1:-D8: assignment and write-protection map. The
 * caller supplies NULL for an empty drive. Only library.json is rewritten;
 * existing ATR/XEX blobs are left untouched. */
int A8E_LibraryRepository_SaveWorkspace(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *apEntryIds[8],
	const uint8_t abWriteProtected[8],
	char *pError,
	uint32_t lErrorSize);

/* Reads/writes the canonical dependency-free `.a8e` package. Import replaces
 * the repository directory only after the complete package validates. */
int A8E_LibraryRepository_ImportPackageFile(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pPackagePath,
	char *pError,
	uint32_t lErrorSize);

int A8E_LibraryRepository_ExportPackageFile(
	const A8E_LibraryRepository_t *pRepository,
	const char *pPackagePath,
	char *pError,
	uint32_t lErrorSize);

/* Creates a writable standard ATR in the repository root. The native window
 * uses this for its dependency-free blank-disk action. */
int A8E_LibraryRepository_CreateBlankAtr(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pName,
	char *pError,
	uint32_t lErrorSize);

#ifdef __cplusplus
}
#endif

#endif
