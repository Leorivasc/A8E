#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <direct.h>
#else
#include <unistd.h>
#endif

#include "LibraryRepository.h"
#include "LibraryPackage.h"

#define REQUIRE(condition) \
	do { if(!(condition)) { fprintf(stderr, "requirement failed at line %d\n", __LINE__); return 1; } } while(0)

static const char sRoot[] = "library_repository_probe_tmp";
static const char sDropRoot[] = "library_repository_drop_probe_tmp";
static const char sDropSource[] = "library_repository_drop_source.atr";
static const char sMergeRoot[] = "library_repository_merge_source_tmp";
static const char sMergeSource[] = "library_repository_merge_source.atr";
static const char sLocalSource[] = "library_repository_merge_local.atr";

static void RemoveProbeFiles(void)
{
	remove("library_repository_probe_tmp.a8e");
	remove("library_repository_probe_workspace_tmp.a8e");
	remove("library_repository_probe_progress_tmp.a8e");
	remove("library_repository_probe_canceled_tmp.a8e");
	remove("library_repository_probe_tmp/library.json");
	remove("library_repository_probe_tmp/library.json.tmp");
	remove("library_repository_probe_tmp/blobs/ff5d8507b6a72bee2debce2c0054798deaccdc5d8a1b945b6280ce8aa9cba52e.atr");
	remove("library_repository_probe_tmp/blobs/67586e98fad27da0b9968bc039a1ef34c939b9b8e523a8bef89d478608c5ecf6.atr");
	remove("library_repository_probe_tmp/blobs/74f81fe167d99b4cb41d6d0ccda82278caee9f3e2f25d5e5a3936ff3dcec60d0.atr");
	remove("library_repository_drop_probe_tmp/library.json");
	remove("library_repository_drop_probe_tmp/library.json.tmp");
	remove("library_repository_drop_probe_tmp/blobs/ff5d8507b6a72bee2debce2c0054798deaccdc5d8a1b945b6280ce8aa9cba52e.atr");
	remove(sDropSource);
	remove("library_repository_merge_source.a8e");
	remove("library_repository_merge_source_tmp/library.json");
	remove("library_repository_merge_source_tmp/library.json.tmp");
	remove("library_repository_merge_source_tmp/blobs/ff5d8507b6a72bee2debce2c0054798deaccdc5d8a1b945b6280ce8aa9cba52e.atr");
	remove("library_repository_merge_source_tmp/blobs/74f81fe167d99b4cb41d6d0ccda82278caee9f3e2f25d5e5a3936ff3dcec60d0.atr");
	remove(sMergeSource);
	remove(sLocalSource);
#ifdef _WIN32
	_rmdir("library_repository_probe_tmp/blobs");
	_rmdir("library_repository_probe_tmp");
	_rmdir("library_repository_drop_probe_tmp/blobs");
	_rmdir(sDropRoot);
	_rmdir("library_repository_merge_source_tmp/blobs");
	_rmdir(sMergeRoot);
#else
	rmdir("library_repository_probe_tmp/blobs");
	rmdir("library_repository_probe_tmp");
	rmdir("library_repository_drop_probe_tmp/blobs");
	rmdir(sDropRoot);
	rmdir("library_repository_merge_source_tmp/blobs");
	rmdir(sMergeRoot);
#endif
}

static void RemoveProbeBlob(
	const char *pRoot,
	const uint8_t *pBytes,
	uint32_t lSize,
	const char *pType)
{
	char aHash[65];
	char sPath[512];
	A8E_LibraryPackage_Sha256Hex(pBytes, lSize, aHash);
	snprintf(sPath, sizeof(sPath), "%s/blobs/%s.%s", pRoot, aHash, pType);
	remove(sPath);
}

typedef struct
{
	uint32_t lCalls;
	int bCancel;
} A8E_TestProgress_t;

static int A8E_TestProgressCallback(
	const char *pPhase,
	uint32_t lCompleted,
	uint32_t lTotal,
	const char *pCurrent,
	void *pUserData)
{
	A8E_TestProgress_t *pProgress = (A8E_TestProgress_t *)pUserData;
	(void)pPhase;
	(void)lCompleted;
	(void)lTotal;
	(void)pCurrent;
	if(pProgress) pProgress->lCalls++;
	return pProgress && !pProgress->bCancel;
}

int main(void)
{
	static const char aJson[] =
		"{\"format\":\"a8e-library-export\",\"schemaVersion\":1,\"libraryVersion\":7,"
		"\"createdAt\":\"2026-10-08T15:00:00Z\",\"folders\":["
		"{\"id\":\"root\",\"name\":\"Library\",\"parentId\":null,"
		"\"createdAt\":\"2026-10-01T00:00:00Z\",\"modifiedAt\":\"2026-10-01T00:00:00Z\"}],"
		"\"library\":[{\"id\":\"disk-demo\","
		"\"name\":\"demo.atr\",\"type\":\"atr\",\"path\":\"blobs/"
		"ff5d8507b6a72bee2debce2c0054798deaccdc5d8a1b945b6280ce8aa9cba52e.atr\","
		"\"size\":5,\"sha256\":\"ff5d8507b6a72bee2debce2c0054798deaccdc5d8a1b945b6280ce8aa9cba52e\","
		"\"mountedSlot\":0},{\"id\":\"disk-unused\","
		"\"name\":\"unused.atr\",\"type\":\"atr\",\"path\":\"blobs/"
		"67586e98fad27da0b9968bc039a1ef34c939b9b8e523a8bef89d478608c5ecf6.atr\","
		"\"size\":1,\"sha256\":\"67586e98fad27da0b9968bc039a1ef34c939b9b8e523a8bef89d478608c5ecf6\","
		"\"mountedSlot\":-1}],"
		"\"workspace\":{\"devices\":{\"D1\":\"disk-demo\"},\"writeProtected\":{\"D1\":true}}}";
	static const uint8_t aAtr[] = { 0, 1, 2, 3, 255 };
	static const uint8_t aNewAtr[] = { 1, 2, 3, 4, 5 };
	A8E_LibraryRepository_t tRepository;
	A8E_LibraryRepository_t tLoaded;
	A8E_LibraryRepository_t tDrop;
	A8E_LibraryRepository_t tMergeSource;
	FILE *pDropSource;
	FILE *pMergeSource;
	FILE *pLocalSource;
	char sMergeEntryId[257];
	const char *apEntryIds[8] = { "disk-demo", NULL, NULL, NULL, NULL, NULL, NULL, NULL };
	uint8_t abWriteProtected[8] = { 0, 0, 0, 0, 0, 0, 0, 0 };
	char sError[128];
	A8E_TestProgress_t tProgress;
	A8E_LibraryPackagePreview_t tPreview;

	RemoveProbeFiles();
	A8E_LibraryRepository_Init(&tRepository);
	A8E_LibraryRepository_Init(&tLoaded);
	A8E_LibraryRepository_Init(&tDrop);
	A8E_LibraryRepository_Init(&tMergeSource);
	tRepository.pManifest = (uint8_t *)malloc(sizeof(aJson) - 1u);
	REQUIRE(tRepository.pManifest != NULL);
	memcpy(tRepository.pManifest, aJson, sizeof(aJson) - 1u);
	tRepository.lManifestSize = (uint32_t)(sizeof(aJson) - 1u);
	tRepository.lLibraryVersion = 7;
	tRepository.pPayloads = (A8E_LibraryArchiveEntry_t *)calloc(2, sizeof(*tRepository.pPayloads));
	REQUIRE(tRepository.pPayloads != NULL);
	tRepository.pPayloads[0].pName = (char *)malloc(79);
	tRepository.pPayloads[0].pBytes = (uint8_t *)malloc(sizeof(aAtr));
	REQUIRE(tRepository.pPayloads[0].pName != NULL && tRepository.pPayloads[0].pBytes != NULL);
	strcpy(tRepository.pPayloads[0].pName, "blobs/ff5d8507b6a72bee2debce2c0054798deaccdc5d8a1b945b6280ce8aa9cba52e.atr");
	memcpy(tRepository.pPayloads[0].pBytes, aAtr, sizeof(aAtr));
	tRepository.pPayloads[0].lSize = sizeof(aAtr);
	tRepository.pPayloads[1].pName = (char *)malloc(79);
	tRepository.pPayloads[1].pBytes = (uint8_t *)malloc(1u);
	REQUIRE(tRepository.pPayloads[1].pName != NULL && tRepository.pPayloads[1].pBytes != NULL);
	strcpy(tRepository.pPayloads[1].pName, "blobs/67586e98fad27da0b9968bc039a1ef34c939b9b8e523a8bef89d478608c5ecf6.atr");
	tRepository.pPayloads[1].pBytes[0] = 6u;
	tRepository.pPayloads[1].lSize = 1u;
	tRepository.sPayloadCount = 2;

	REQUIRE(A8E_LibraryRepository_SaveDirectory(&tRepository, sRoot, sError, sizeof(sError)));
	REQUIRE(A8E_LibraryRepository_LoadDirectory(&tLoaded, sRoot, sError, sizeof(sError)));
	REQUIRE(tLoaded.lLibraryVersion == 7 && tLoaded.sPayloadCount == 2);
	REQUIRE(tLoaded.sRecordCount == 2);
	REQUIRE(tLoaded.sFolderCount == 1);
	REQUIRE(strcmp(tLoaded.pRecords[0].pId, "disk-demo") == 0);
	REQUIRE(strcmp(tLoaded.pRecords[0].pName, "demo.atr") == 0);
	REQUIRE(tLoaded.pRecords[0].lMountedSlot == 0);
	REQUIRE(tLoaded.pRecords[0].sRevisionCount == 0 &&
		tLoaded.pRecords[0].pPreferredRevisionId == NULL);
	REQUIRE(strcmp(A8E_LibraryRepository_GetDeviceEntryId(&tLoaded, 0), "disk-demo") == 0);
	REQUIRE(A8E_LibraryRepository_IsDeviceWriteProtected(&tLoaded, 0));
	REQUIRE(strcmp(tLoaded.pPayloads[0].pName, tRepository.pPayloads[0].pName) == 0);
	REQUIRE(tLoaded.pPayloads[0].lSize == sizeof(aAtr));
	REQUIRE(memcmp(tLoaded.pPayloads[0].pBytes, aAtr, sizeof(aAtr)) == 0);
	pDropSource = fopen(sDropSource, "wb");
	REQUIRE(pDropSource != NULL);
	REQUIRE(fwrite(aAtr, 1u, sizeof(aAtr), pDropSource) == sizeof(aAtr));
	REQUIRE(fclose(pDropSource) == 0);
	REQUIRE(A8E_LibraryRepository_EnsureDirectory(
		&tDrop, sDropRoot, sError, sizeof(sError)));
	REQUIRE(tDrop.lLibraryVersion == 1 && tDrop.sRecordCount == 0);
	REQUIRE(A8E_LibraryRepository_ImportImageFile(
		&tDrop, sDropRoot, "root", sDropSource, sError, sizeof(sError)));
	REQUIRE(tDrop.sRecordCount == 1 && tDrop.sPayloadCount == 1);
	REQUIRE(strcmp(tDrop.pRecords[0].pName, sDropSource) == 0);
	REQUIRE(tDrop.pRecords[0].lSize == sizeof(aAtr));
	REQUIRE(memcmp(A8E_LibraryRepository_GetPayload(
		&tDrop, tDrop.pRecords[0].pPath, NULL), aAtr, sizeof(aAtr)) == 0);
	REQUIRE(!A8E_LibraryRepository_ImportImageFile(
		&tDrop, sDropRoot, "root", sDropSource, sError, sizeof(sError)));
	A8E_LibraryRepository_Free(&tDrop);
	REQUIRE(A8E_LibraryRepository_CreateFolder(
		&tLoaded, sRoot, "root", "Projects", sError, sizeof(sError)));
	REQUIRE(tLoaded.sFolderCount == 2);
	{
		const char *pFolderId = tLoaded.pFolders[1].pId;
		char sFolderId[257];
		strncpy(sFolderId, pFolderId, sizeof(sFolderId) - 1u);
		sFolderId[sizeof(sFolderId) - 1u] = '\0';
		REQUIRE(A8E_LibraryRepository_RenameFolder(
			&tLoaded, sRoot, sFolderId, "Renamed", sError, sizeof(sError)));
		REQUIRE(strcmp(tLoaded.pFolders[1].pName, "Renamed") == 0);
		REQUIRE(A8E_LibraryRepository_MoveEntry(
			&tLoaded, sRoot, "disk-demo", sFolderId, sError, sizeof(sError)));
		REQUIRE(strcmp(tLoaded.pRecords[0].pFolderId, sFolderId) == 0);
		REQUIRE(!A8E_LibraryRepository_DeleteFolder(
			&tLoaded, sRoot, sFolderId, sError, sizeof(sError)));
		REQUIRE(A8E_LibraryRepository_MoveEntry(
			&tLoaded, sRoot, "disk-demo", "root", sError, sizeof(sError)));
		REQUIRE(A8E_LibraryRepository_DeleteFolder(
			&tLoaded, sRoot, sFolderId, sError, sizeof(sError)));
		REQUIRE(tLoaded.sFolderCount == 1);
	}
	REQUIRE(A8E_LibraryRepository_SaveWorkspace(
		&tLoaded, sRoot, apEntryIds, abWriteProtected, sError, sizeof(sError)));
	REQUIRE(tLoaded.lLibraryVersion == 13);
	REQUIRE(!A8E_LibraryRepository_IsDeviceWriteProtected(&tLoaded, 0));
	REQUIRE(A8E_LibraryRepository_ExportPackageFile(
		&tLoaded, "library_repository_probe_tmp.a8e", sError, sizeof(sError)));
	REQUIRE(A8E_LibraryRepository_PreviewPackageFile(
		&tLoaded, "library_repository_probe_tmp.a8e", &tPreview,
		sError, sizeof(sError)));
	REQUIRE(tPreview.sPackageEntryCount == 2 && tPreview.sDuplicateCount == 2 &&
		tPreview.sConflictCount == 0 && tPreview.sNewEntryCount == 0 &&
		tPreview.sPayloadCount == 2);
	{
		A8E_LibraryPackageLimits_t tLimits;
		A8E_LibraryPackage_DefaultLimits(&tLimits);
		tLimits.lMaxPayloadSize = sizeof(aAtr) - 1u;
		REQUIRE(!A8E_LibraryRepository_PreviewPackageFileWithLimits(
			&tLoaded, "library_repository_probe_tmp.a8e", &tLimits,
			&tPreview, sError, sizeof(sError)));
		REQUIRE(strstr(sError, "payload") != NULL);
	}
	memset(&tProgress, 0, sizeof(tProgress));
	REQUIRE(A8E_LibraryRepository_ExportPackageFileWithProgress(
		&tLoaded, "library_repository_probe_progress_tmp.a8e",
		A8E_TestProgressCallback, &tProgress, sError, sizeof(sError)));
	REQUIRE(tProgress.lCalls > 0);
	remove("library_repository_probe_progress_tmp.a8e");
	memset(&tProgress, 0, sizeof(tProgress));
	tProgress.bCancel = 1;
	REQUIRE(!A8E_LibraryRepository_ExportPackageFileWithProgress(
		&tLoaded, "library_repository_probe_canceled_tmp.a8e",
		A8E_TestProgressCallback, &tProgress, sError, sizeof(sError)));
	REQUIRE(strstr(sError, "canceled") != NULL);
	remove("library_repository_probe_canceled_tmp.a8e");
	{
		uint16_t sRecordsBefore = tLoaded.sRecordCount;
		uint32_t lVersionBefore = tLoaded.lLibraryVersion;
		memset(&tProgress, 0, sizeof(tProgress));
		tProgress.bCancel = 1;
		REQUIRE(!A8E_LibraryRepository_ImportPackageFileWithProgress(
			&tLoaded, sRoot, "library_repository_probe_tmp.a8e",
			A8E_TestProgressCallback, &tProgress, sError, sizeof(sError)));
		REQUIRE(tProgress.lCalls > 0 && tLoaded.sRecordCount == sRecordsBefore &&
			tLoaded.lLibraryVersion == lVersionBefore);
		REQUIRE(strstr(sError, "canceled") != NULL);
	}
	REQUIRE(A8E_LibraryRepository_ExportWorkspacePackageFile(
		&tLoaded, "library_repository_probe_workspace_tmp.a8e", sError, sizeof(sError)));
	if(!A8E_LibraryRepository_ImportPackageFile(
		&tLoaded, sRoot, "library_repository_probe_tmp.a8e", sError, sizeof(sError)))
	{
		fprintf(stderr, "package merge failed: %s\n", sError);
		return 1;
	}
	REQUIRE(tLoaded.lLibraryVersion == 13 && tLoaded.sRecordCount == 2);
	REQUIRE(A8E_LibraryRepository_ImportPackageFile(
		&tLoaded, sRoot, "library_repository_probe_workspace_tmp.a8e", sError, sizeof(sError)));
	REQUIRE(tLoaded.lLibraryVersion == 13 && tLoaded.sRecordCount == 2 && tLoaded.sPayloadCount == 2);
	REQUIRE(A8E_LibraryRepository_SaveWorkingCopy(
		&tLoaded, sRoot, "disk-demo", aNewAtr, sizeof(aNewAtr), sError, sizeof(sError)));
	REQUIRE(tLoaded.lLibraryVersion == 14 && tLoaded.sRecordCount == 2);
	REQUIRE(tLoaded.sPayloadCount == 3);
	REQUIRE(tLoaded.pRecords[0].sRevisionCount >= 1);
	REQUIRE(strstr((const char *)tLoaded.pManifest, "\"revisions\"") != NULL);
	{
		const char *pRevision = strstr((const char *)tLoaded.pManifest, "\"id\":\"revision-");
		char sRevisionId[128];
		const char *pEnd;
		REQUIRE(pRevision != NULL);
		pRevision += strlen("\"id\":\"");
		pEnd = strchr(pRevision, '\"');
		REQUIRE(pEnd != NULL && (size_t)(pEnd - pRevision) < sizeof(sRevisionId));
		memcpy(sRevisionId, pRevision, (size_t)(pEnd - pRevision));
		sRevisionId[pEnd - pRevision] = '\0';
		REQUIRE(A8E_LibraryRepository_PromoteRevision(
			&tLoaded, sRoot, "disk-demo", sRevisionId,
			sError, sizeof(sError)));
		REQUIRE(tLoaded.lLibraryVersion == 15 && tLoaded.sRecordCount == 2);
		REQUIRE(tLoaded.pRecords[0].lSize == sizeof(aAtr));
		REQUIRE(memcmp(A8E_LibraryRepository_GetPayload(
			&tLoaded, tLoaded.pRecords[0].pPath, NULL), aAtr, sizeof(aAtr)) == 0);
		REQUIRE(strstr((const char *)tLoaded.pManifest,
			"\"preferredRevisionId\":\"") != NULL);
		REQUIRE(tLoaded.pRecords[0].pPreferredRevisionId != NULL);
	}
	{
		const char *apEmptyIds[8] = { NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL };
		REQUIRE(A8E_LibraryRepository_SaveWorkspace(
			&tLoaded, sRoot, apEmptyIds, abWriteProtected, sError, sizeof(sError)));
	}
	REQUIRE(A8E_LibraryRepository_RemoveEntry(
		&tLoaded, sRoot, "disk-demo", sError, sizeof(sError)));
	REQUIRE(tLoaded.sRecordCount == 1 && tLoaded.sTrashCount == 1 && tLoaded.sPayloadCount == 3);
	REQUIRE(A8E_LibraryRepository_GetDeviceEntryId(&tLoaded, 0) == NULL);
	REQUIRE(A8E_LibraryRepository_GetTrashRecord(&tLoaded, 0) != NULL);
	REQUIRE(A8E_LibraryRepository_ExportPackageFile(
		&tLoaded, "library_repository_probe_tmp.a8e", sError, sizeof(sError)));
	REQUIRE(A8E_LibraryRepository_RestoreTrashEntry(
		&tLoaded, sRoot, "disk-demo", "root", sError, sizeof(sError)));
	REQUIRE(tLoaded.sRecordCount == 2 && tLoaded.sTrashCount == 0);
	REQUIRE(tLoaded.pRecords[0].pDeletedAt == NULL);
	REQUIRE(A8E_LibraryRepository_RemoveEntry(
		&tLoaded, sRoot, "disk-demo", sError, sizeof(sError)));
	REQUIRE(tLoaded.sRecordCount == 1 && tLoaded.sTrashCount == 1);
	{
		uint16_t sPurged = 0;
		REQUIRE(A8E_LibraryRepository_PurgeTrashBefore(
			&tLoaded, sRoot, "2000-01-01T00:00:00Z", &sPurged,
			sError, sizeof(sError)));
		REQUIRE(sPurged == 0 && tLoaded.sTrashCount == 1);
		REQUIRE(A8E_LibraryRepository_PurgeTrashBefore(
			&tLoaded, sRoot, "9999-12-31T23:59:59Z", &sPurged,
			sError, sizeof(sError)));
		REQUIRE(sPurged == 1);
	}
	REQUIRE(tLoaded.sTrashCount == 0 && tLoaded.sPayloadCount == 1);
	REQUIRE(A8E_LibraryRepository_RemoveEntry(
		&tLoaded, sRoot, "disk-unused", sError, sizeof(sError)));
	REQUIRE(A8E_LibraryRepository_PurgeTrashEntry(
		&tLoaded, sRoot, "disk-unused", sError, sizeof(sError)));
	REQUIRE(tLoaded.sRecordCount == 0 && tLoaded.sTrashCount == 0 &&
		tLoaded.sPayloadCount == 0);
	pMergeSource = fopen(sMergeSource, "wb");
	REQUIRE(pMergeSource != NULL);
	REQUIRE(fwrite(aNewAtr, 1u, sizeof(aNewAtr), pMergeSource) == sizeof(aNewAtr));
	REQUIRE(fclose(pMergeSource) == 0);
	REQUIRE(A8E_LibraryRepository_EnsureDirectory(
		&tMergeSource, sMergeRoot, sError, sizeof(sError)));
	REQUIRE(A8E_LibraryRepository_ImportImageFile(
		&tMergeSource, sMergeRoot, "root", sMergeSource,
		sError, sizeof(sError)));
	REQUIRE(A8E_LibraryRepository_CreateFolder(
		&tMergeSource, sMergeRoot, "root", "Projects", sError, sizeof(sError)));
	REQUIRE(A8E_LibraryRepository_CreateFolder(
		&tMergeSource, sMergeRoot, tMergeSource.pFolders[1].pId,
		"Imported", sError, sizeof(sError)));
	{
		char sFolderId[257];
		strncpy(sFolderId, tMergeSource.pFolders[2].pId, sizeof(sFolderId) - 1u);
		sFolderId[sizeof(sFolderId) - 1u] = '\0';
		strncpy(sMergeEntryId, tMergeSource.pRecords[0].pId,
			sizeof(sMergeEntryId) - 1u);
		sMergeEntryId[sizeof(sMergeEntryId) - 1u] = '\0';
		REQUIRE(A8E_LibraryRepository_MoveEntry(
			&tMergeSource, sMergeRoot, sMergeEntryId, sFolderId,
			sError, sizeof(sError)));
	}
	REQUIRE(A8E_LibraryRepository_ExportPackageFile(
		&tMergeSource, "library_repository_merge_source.a8e",
		sError, sizeof(sError)));
	pLocalSource = fopen(sLocalSource, "wb");
	REQUIRE(pLocalSource != NULL);
	REQUIRE(fwrite(aAtr, 1u, sizeof(aAtr), pLocalSource) == sizeof(aAtr));
	REQUIRE(fclose(pLocalSource) == 0);
	REQUIRE(A8E_LibraryRepository_ImportImageFile(
		&tLoaded, sRoot, "root", sLocalSource, sError, sizeof(sError)));
	REQUIRE(tLoaded.sRecordCount == 1);
	REQUIRE(A8E_LibraryRepository_CreateFolder(
		&tLoaded, sRoot, "root", "Projects", sError, sizeof(sError)));
	REQUIRE(A8E_LibraryRepository_CreateFolder(
		&tLoaded, sRoot, tLoaded.pFolders[1].pId,
		"Imported", sError, sizeof(sError)));
	REQUIRE(A8E_LibraryRepository_MoveEntry(
		&tLoaded, sRoot, tLoaded.pRecords[0].pId,
		tLoaded.pFolders[2].pId, sError, sizeof(sError)));
	REQUIRE(A8E_LibraryRepository_RenameEntry(
		&tLoaded, sRoot, tLoaded.pRecords[0].pId, sMergeSource,
		sError, sizeof(sError)));
	{
		A8E_LibraryPackagePreview_t tMergePreview;
		REQUIRE(A8E_LibraryRepository_PreviewPackageFile(
			&tLoaded, "library_repository_merge_source.a8e", &tMergePreview,
			sError, sizeof(sError)));
		/* The package and local folder IDs differ, but their nested paths are
		 * identical; preview must use the mapped hierarchy, not raw IDs. */
		REQUIRE(tMergePreview.sNewFolderCount == 0 &&
			tMergePreview.sNameCollisionCount == 1);
	}
	REQUIRE(A8E_LibraryRepository_ImportPackageFile(
		&tLoaded, sRoot, "library_repository_merge_source.a8e",
		sError, sizeof(sError)));
	REQUIRE(tLoaded.sRecordCount == 2);
	{
		uint16_t sIndex;
		int bImportedFolder = 0;
		int bLocalEntry = 0;
		int bImportedName = 0;
		for(sIndex = 0; sIndex < tLoaded.sRecordCount; sIndex++)
		{
			const uint8_t *pBytes = A8E_LibraryRepository_GetPayload(
				&tLoaded, tLoaded.pRecords[sIndex].pPath, NULL);
			if(pBytes && memcmp(pBytes, aNewAtr, sizeof(aNewAtr)) == 0 &&
				tLoaded.pRecords[sIndex].pFolderId &&
				strcmp(tLoaded.pRecords[sIndex].pFolderId, "root") != 0)
			{
				bImportedFolder = 1;
				if(strcmp(tLoaded.pRecords[sIndex].pName,
					"library_repository_merge_source(1).atr") == 0)
					bImportedName = 1;
			}
			if(pBytes && memcmp(pBytes, aAtr, sizeof(aAtr)) == 0 &&
				strcmp(tLoaded.pRecords[sIndex].pName, sMergeSource) == 0)
				bLocalEntry = 1;
		}
		REQUIRE(bImportedFolder && bImportedName && bLocalEntry);
	}
	while(tLoaded.sRecordCount > 0u)
	{
		char sEntryId[257];
		strncpy(sEntryId, tLoaded.pRecords[0].pId, sizeof(sEntryId) - 1u);
		sEntryId[sizeof(sEntryId) - 1u] = '\0';
		REQUIRE(A8E_LibraryRepository_RemoveEntry(
			&tLoaded, sRoot, sEntryId, sError, sizeof(sError)));
		REQUIRE(A8E_LibraryRepository_PurgeTrashEntry(
			&tLoaded, sRoot, sEntryId, sError, sizeof(sError)));
	}
	while(tMergeSource.sRecordCount > 0u)
	{
		char sEntryId[257];
		strncpy(sEntryId, tMergeSource.pRecords[0].pId, sizeof(sEntryId) - 1u);
		sEntryId[sizeof(sEntryId) - 1u] = '\0';
		REQUIRE(A8E_LibraryRepository_RemoveEntry(
			&tMergeSource, sMergeRoot, sEntryId, sError, sizeof(sError)));
		REQUIRE(A8E_LibraryRepository_PurgeTrashEntry(
			&tMergeSource, sMergeRoot, sEntryId, sError, sizeof(sError)));
	}
	RemoveProbeBlob(sMergeRoot, aNewAtr, sizeof(aNewAtr), "atr");

	A8E_LibraryRepository_Free(&tLoaded);
	A8E_LibraryRepository_Free(&tRepository);
	RemoveProbeFiles();
	printf("library_repository_probe passed\n");
	return 0;
}
