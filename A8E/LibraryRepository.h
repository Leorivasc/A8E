#ifndef A8E_LIBRARY_REPOSITORY_H
#define A8E_LIBRARY_REPOSITORY_H

#include <stdint.h>

#include "LibraryPackage.h"

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
	char *pModifiedAt;
	char *pDeletedAt;
	char *pPreferredRevisionId;
	uint16_t sRevisionCount;
	uint32_t lSize;
	int32_t lMountedSlot;
	uint32_t lObjectStart;
	uint32_t lObjectEnd;
} A8E_LibraryRepositoryRecord_t;

typedef struct
{
	char *pId;
	char *pName;
	char *pParentId;
	uint32_t lObjectStart;
	uint32_t lObjectEnd;
} A8E_LibraryRepositoryFolder_t;

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
	A8E_LibraryRepositoryRecord_t *pTrashRecords;
	uint16_t sTrashCount;
	A8E_LibraryRepositoryFolder_t *pFolders;
	uint16_t sFolderCount;
	char acDeviceEntryId[8][257];
	uint8_t abDeviceWriteProtected[8];
} A8E_LibraryRepository_t;

/* Return non-zero to continue. A zero return cancels before the next
 * transaction boundary; the visible repository remains unchanged. */
typedef int (*A8E_LibraryProgressCallback)(
	const char *pPhase,
	uint32_t lCompleted,
	uint32_t lTotal,
	const char *pCurrent,
	void *pUserData);

typedef struct
{
	uint16_t sPackageEntryCount;
	uint16_t sNewEntryCount;
	uint16_t sDuplicateCount;
	uint16_t sConflictCount;
	uint16_t sNameCollisionCount;
	uint16_t sNewerCount;
	uint16_t sOlderCount;
	uint16_t sConcurrentCount;
	uint16_t sNewFolderCount;
	uint16_t sPayloadCount;
	uint8_t sRestoredDeviceCount;
	uint8_t bNewerLibraryVersion;
	uint8_t bNewerSchemaVersion;
	uint32_t lPackageSchemaVersion;
	uint32_t lPackageLibraryVersion;
} A8E_LibraryPackagePreview_t;

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

const A8E_LibraryRepositoryRecord_t *A8E_LibraryRepository_GetTrashRecord(
	const A8E_LibraryRepository_t *pRepository,
	uint16_t sIndex);

int A8E_LibraryRepository_RestoreTrashEntry(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pEntryId,
	const char *pFolderId,
	char *pError,
	uint32_t lErrorSize);

int A8E_LibraryRepository_PurgeTrashEntry(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pEntryId,
	char *pError,
	uint32_t lErrorSize);

/* Purges trash records whose canonical UTC deletedAt is before pBeforeUtc.
 * The cutoff must use the same YYYY-MM-DDTHH:MM:SSZ form written by the
 * repository. pPurgedCount may be NULL when the caller does not need it. */
int A8E_LibraryRepository_PurgeTrashBefore(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pBeforeUtc,
	uint16_t *pPurgedCount,
	char *pError,
	uint32_t lErrorSize);

int A8E_LibraryRepository_PromoteRevision(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pEntryId,
	const char *pRevisionId,
	char *pError,
	uint32_t lErrorSize);

const A8E_LibraryRepositoryFolder_t *A8E_LibraryRepository_GetFolder(
	const A8E_LibraryRepository_t *pRepository,
	uint16_t sIndex);

int A8E_LibraryRepository_CreateFolder(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pParentId,
	const char *pName,
	char *pError,
	uint32_t lErrorSize);

int A8E_LibraryRepository_RenameFolder(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pFolderId,
	const char *pName,
	char *pError,
	uint32_t lErrorSize);

int A8E_LibraryRepository_DeleteFolder(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pFolderId,
	char *pError,
	uint32_t lErrorSize);

int A8E_LibraryRepository_MoveEntry(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pEntryId,
	const char *pFolderId,
	char *pError,
	uint32_t lErrorSize);

int A8E_LibraryRepository_RenameEntry(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pEntryId,
	const char *pName,
	char *pError,
	uint32_t lErrorSize);

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

/* Moves an unmounted entry to recoverable trash; purge removes unreferenced
 * payloads after the trash reference is gone. */
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

/* Reads/writes the canonical dependency-free `.a8e` package. Import validates
 * the complete package first, then installs it for a new repository or merges
 * it into an existing repository without exposing a partial snapshot. */
int A8E_LibraryRepository_ImportPackageFile(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pPackagePath,
	char *pError,
	uint32_t lErrorSize);

int A8E_LibraryRepository_ImportPackageFileWithLimits(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pPackagePath,
	const A8E_LibraryPackageLimits_t *pLimits,
	char *pError,
	uint32_t lErrorSize);

/* Validates a package and calculates a non-mutating import summary against
 * the current repository. */
int A8E_LibraryRepository_PreviewPackageFile(
	const A8E_LibraryRepository_t *pRepository,
	const char *pPackagePath,
	A8E_LibraryPackagePreview_t *pPreview,
	char *pError,
	uint32_t lErrorSize);

int A8E_LibraryRepository_PreviewPackageFileWithLimits(
	const A8E_LibraryRepository_t *pRepository,
	const char *pPackagePath,
	const A8E_LibraryPackageLimits_t *pLimits,
	A8E_LibraryPackagePreview_t *pPreview,
	char *pError,
	uint32_t lErrorSize);

int A8E_LibraryRepository_ImportPackageFileWithProgress(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pPackagePath,
	A8E_LibraryProgressCallback pProgress,
	void *pUserData,
	char *pError,
	uint32_t lErrorSize);

int A8E_LibraryRepository_ImportPackageFileWithProgressAndLimits(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pPackagePath,
	A8E_LibraryProgressCallback pProgress,
	void *pUserData,
	const A8E_LibraryPackageLimits_t *pLimits,
	char *pError,
	uint32_t lErrorSize);

int A8E_LibraryRepository_ExportPackageFile(
	const A8E_LibraryRepository_t *pRepository,
	const char *pPackagePath,
	char *pError,
	uint32_t lErrorSize);

int A8E_LibraryRepository_ExportPackageFileWithProgress(
	const A8E_LibraryRepository_t *pRepository,
	const char *pPackagePath,
	A8E_LibraryProgressCallback pProgress,
	void *pUserData,
	char *pError,
	uint32_t lErrorSize);

/* Exports only entries currently assigned to D1:-D8: and their payloads. */
int A8E_LibraryRepository_ExportWorkspacePackageFile(
	const A8E_LibraryRepository_t *pRepository,
	const char *pPackagePath,
	char *pError,
	uint32_t lErrorSize);

int A8E_LibraryRepository_ExportWorkspacePackageFileWithProgress(
	const A8E_LibraryRepository_t *pRepository,
	const char *pPackagePath,
	A8E_LibraryProgressCallback pProgress,
	void *pUserData,
	char *pError,
	uint32_t lErrorSize);

/* Imports one local ATR/XEX file into the requested folder. The source file is
 * copied into a content-addressed blob before library.json is committed. */
int A8E_LibraryRepository_ImportImageFile(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
	const char *pFolderId,
	const char *pSourcePath,
	char *pError,
	uint32_t lErrorSize);

/* Creates an empty schema-v1 directory when the application has no library
 * yet, preserving an existing manifest or its validation error. */
int A8E_LibraryRepository_EnsureDirectory(
	A8E_LibraryRepository_t *pRepository,
	const char *pRootPath,
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
