#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <direct.h>
#else
#include <unistd.h>
#endif

#include "LibraryRepository.h"

#define REQUIRE(condition) \
	do { if(!(condition)) { fprintf(stderr, "requirement failed at line %d\n", __LINE__); return 1; } } while(0)

static const char sRoot[] = "library_repository_probe_tmp";

static void RemoveProbeFiles(void)
{
	remove("library_repository_probe_tmp.a8e");
	remove("library_repository_probe_tmp/library.json");
	remove("library_repository_probe_tmp/library.json.tmp");
	remove("library_repository_probe_tmp/blobs/ff5d8507b6a72bee2debce2c0054798deaccdc5d8a1b945b6280ce8aa9cba52e.atr");
#ifdef _WIN32
	_rmdir("library_repository_probe_tmp/blobs");
	_rmdir("library_repository_probe_tmp");
#else
	rmdir("library_repository_probe_tmp/blobs");
	rmdir("library_repository_probe_tmp");
#endif
}

int main(void)
{
	static const char aJson[] =
		"{\"format\":\"a8e-library-export\",\"schemaVersion\":1,\"libraryVersion\":7,"
		"\"createdAt\":\"2026-10-08T15:00:00Z\",\"library\":[{\"id\":\"disk-demo\","
		"\"name\":\"demo.atr\",\"type\":\"atr\",\"path\":\"blobs/"
		"ff5d8507b6a72bee2debce2c0054798deaccdc5d8a1b945b6280ce8aa9cba52e.atr\","
		"\"size\":5,\"sha256\":\"ff5d8507b6a72bee2debce2c0054798deaccdc5d8a1b945b6280ce8aa9cba52e\","
		"\"mountedSlot\":0}],"
		"\"workspace\":{\"devices\":{\"D1\":\"disk-demo\"},\"writeProtected\":{\"D1\":true}}}";
	static const uint8_t aAtr[] = { 0, 1, 2, 3, 255 };
	A8E_LibraryRepository_t tRepository;
	A8E_LibraryRepository_t tLoaded;
	const char *apEntryIds[8] = { "disk-demo", NULL, NULL, NULL, NULL, NULL, NULL, NULL };
	uint8_t abWriteProtected[8] = { 0, 0, 0, 0, 0, 0, 0, 0 };
	char sError[128];

	RemoveProbeFiles();
	A8E_LibraryRepository_Init(&tRepository);
	A8E_LibraryRepository_Init(&tLoaded);
	tRepository.pManifest = (uint8_t *)malloc(sizeof(aJson) - 1u);
	REQUIRE(tRepository.pManifest != NULL);
	memcpy(tRepository.pManifest, aJson, sizeof(aJson) - 1u);
	tRepository.lManifestSize = (uint32_t)(sizeof(aJson) - 1u);
	tRepository.lLibraryVersion = 7;
	tRepository.pPayloads = (A8E_LibraryArchiveEntry_t *)calloc(1, sizeof(*tRepository.pPayloads));
	REQUIRE(tRepository.pPayloads != NULL);
	tRepository.pPayloads[0].pName = (char *)malloc(79);
	tRepository.pPayloads[0].pBytes = (uint8_t *)malloc(sizeof(aAtr));
	REQUIRE(tRepository.pPayloads[0].pName != NULL && tRepository.pPayloads[0].pBytes != NULL);
	strcpy(tRepository.pPayloads[0].pName, "blobs/ff5d8507b6a72bee2debce2c0054798deaccdc5d8a1b945b6280ce8aa9cba52e.atr");
	memcpy(tRepository.pPayloads[0].pBytes, aAtr, sizeof(aAtr));
	tRepository.pPayloads[0].lSize = sizeof(aAtr);
	tRepository.sPayloadCount = 1;

	REQUIRE(A8E_LibraryRepository_SaveDirectory(&tRepository, sRoot, sError, sizeof(sError)));
	REQUIRE(A8E_LibraryRepository_LoadDirectory(&tLoaded, sRoot, sError, sizeof(sError)));
	REQUIRE(tLoaded.lLibraryVersion == 7 && tLoaded.sPayloadCount == 1);
	REQUIRE(tLoaded.sRecordCount == 1);
	REQUIRE(strcmp(tLoaded.pRecords[0].pId, "disk-demo") == 0);
	REQUIRE(strcmp(tLoaded.pRecords[0].pName, "demo.atr") == 0);
	REQUIRE(tLoaded.pRecords[0].lMountedSlot == 0);
	REQUIRE(strcmp(A8E_LibraryRepository_GetDeviceEntryId(&tLoaded, 0), "disk-demo") == 0);
	REQUIRE(A8E_LibraryRepository_IsDeviceWriteProtected(&tLoaded, 0));
	REQUIRE(strcmp(tLoaded.pPayloads[0].pName, tRepository.pPayloads[0].pName) == 0);
	REQUIRE(tLoaded.pPayloads[0].lSize == sizeof(aAtr));
	REQUIRE(memcmp(tLoaded.pPayloads[0].pBytes, aAtr, sizeof(aAtr)) == 0);
	REQUIRE(A8E_LibraryRepository_SaveWorkspace(
		&tLoaded, sRoot, apEntryIds, abWriteProtected, sError, sizeof(sError)));
	REQUIRE(tLoaded.lLibraryVersion == 8);
	REQUIRE(!A8E_LibraryRepository_IsDeviceWriteProtected(&tLoaded, 0));
	REQUIRE(A8E_LibraryRepository_ExportPackageFile(
		&tLoaded, "library_repository_probe_tmp.a8e", sError, sizeof(sError)));
	REQUIRE(A8E_LibraryRepository_ImportPackageFile(
		&tLoaded, sRoot, "library_repository_probe_tmp.a8e", sError, sizeof(sError)));
	REQUIRE(tLoaded.lLibraryVersion == 8 && tLoaded.sRecordCount == 1);
	REQUIRE(A8E_LibraryRepository_SaveWorkingCopy(
		&tLoaded, sRoot, "disk-demo", aAtr, sizeof(aAtr), sError, sizeof(sError)));
	REQUIRE(tLoaded.lLibraryVersion == 9 && tLoaded.sRecordCount == 1);
	REQUIRE(A8E_LibraryRepository_RemoveEntry(
		&tLoaded, sRoot, "disk-demo", sError, sizeof(sError)));
	REQUIRE(tLoaded.sRecordCount == 0 && tLoaded.sPayloadCount == 0);
	REQUIRE(A8E_LibraryRepository_GetDeviceEntryId(&tLoaded, 0) == NULL);

	A8E_LibraryRepository_Free(&tLoaded);
	A8E_LibraryRepository_Free(&tRepository);
	RemoveProbeFiles();
	printf("library_repository_probe passed\n");
	return 0;
}
