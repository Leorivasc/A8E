#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "LibraryPackage.h"
#include "LibraryStore.h"

#define REQUIRE(condition) \
	do { if(!(condition)) { fprintf(stderr, "requirement failed at line %d\n", __LINE__); return 1; } } while(0)

int main(void)
{
	static const char aJson[] =
		"{\"format\":\"a8e-library-export\",\"schemaVersion\":1,\"libraryVersion\":7,"
		"\"createdAt\":\"2026-10-08T15:00:00Z\",\"folders\":[{\"id\":\"root\",\"name\":\"Library\",\"parentId\":null,\"createdAt\":\"2026-10-01T00:00:00Z\",\"modifiedAt\":\"2026-10-01T00:00:00Z\"},{\"id\":\"folder-projects\",\"name\":\"Projects\",\"parentId\":\"root\",\"createdAt\":\"2026-10-01T00:00:00Z\",\"modifiedAt\":\"2026-10-08T14:00:00Z\"}],\"library\":[{\"id\":\"disk-demo\","
		"\"name\":\"demo.atr\",\"type\":\"atr\",\"path\":\"blobs/"
		"ff5d8507b6a72bee2debce2c0054798deaccdc5d8a1b945b6280ce8aa9cba52e.atr\","
		"\"size\":5,\"sha256\":\"ff5d8507b6a72bee2debce2c0054798deaccdc5d8a1b945b6280ce8aa9cba52e\","
		"\"createdAt\":\"2026-10-01T12:00:00Z\",\"modifiedAt\":\"2026-10-08T14:45:12Z\",\"folderId\":\"folder-projects\"}],"
		"\"workspace\":{\"devices\":{\"D1\":\"disk-demo\"},\"writeProtected\":{\"D1\":false}}}";
	static const uint8_t aAtr[] = { 0, 1, 2, 3, 255 };
	static const A8E_LibraryArchiveInput_t aPayloads[] = {
		{ "blobs/ff5d8507b6a72bee2debce2c0054798deaccdc5d8a1b945b6280ce8aa9cba52e.atr", aAtr, sizeof(aAtr) },
	};
	A8E_LibraryArchiveEntry_t *pEntries = NULL;
	uint8_t *pArchive = NULL;
	uint8_t *pCorrupted = NULL;
	uint32_t lArchiveSize = 0;
	uint32_t lLibraryVersion = 0;
	uint16_t sEntryCount = 0;
	char sError[128];
	A8E_LibraryStore_t tStore;
	A8E_LibraryStore_Init(&tStore);

	REQUIRE(A8E_LibraryPackage_ValidateManifest(
		(const uint8_t *)aJson, (uint32_t)(sizeof(aJson) - 1),
		&lLibraryVersion, sError, sizeof(sError)));
	REQUIRE(lLibraryVersion == 7);
	REQUIRE(A8E_LibraryPackage_Write(
		(const uint8_t *)aJson, (uint32_t)(sizeof(aJson) - 1),
		aPayloads, 1, &pArchive, &lArchiveSize, sError, sizeof(sError)));
	REQUIRE(pArchive != NULL && lArchiveSize > 0);
	REQUIRE(A8E_LibraryPackage_Read(
		pArchive, lArchiveSize, &pEntries, &sEntryCount,
		&lLibraryVersion, sError, sizeof(sError)));
	REQUIRE(lLibraryVersion == 7);
	REQUIRE(sEntryCount == 2);
	REQUIRE(strcmp(pEntries[0].pName, "library.json") == 0);
	REQUIRE(pEntries[0].lSize == sizeof(aJson) - 1);
	REQUIRE(memcmp(pEntries[0].pBytes, aJson, sizeof(aJson) - 1) == 0);
	REQUIRE(strcmp(pEntries[1].pName, aPayloads[0].pName) == 0);
	REQUIRE(pEntries[1].lSize == sizeof(aAtr));
	REQUIRE(memcmp(pEntries[1].pBytes, aAtr, sizeof(aAtr)) == 0);
	REQUIRE(A8E_LibraryStore_ImportPackage(
		&tStore, pArchive, lArchiveSize, sError, sizeof(sError)));
	REQUIRE(tStore.sEntryCount == 2 && tStore.lLibraryVersion == 7);

	A8E_LibraryArchive_FreeEntries(pEntries, sEntryCount);

	pCorrupted = (uint8_t *)malloc(lArchiveSize);
	REQUIRE(pCorrupted != NULL);
	memcpy(pCorrupted, pArchive, lArchiveSize);
	{
		uint32_t i;
		int lChanged = 0;
		for(i = 0; i < lArchiveSize; i++)
		{
			if(pCorrupted[i] == 255)
			{
				pCorrupted[i] ^= 1;
				lChanged = 1;
				break;
			}
		}
		REQUIRE(lChanged);
	}
	REQUIRE(!A8E_LibraryPackage_Read(
		pCorrupted, lArchiveSize, &pEntries, &sEntryCount,
		&lLibraryVersion, sError, sizeof(sError)));
	REQUIRE(!A8E_LibraryStore_ImportPackage(
		&tStore, pCorrupted, lArchiveSize, sError, sizeof(sError)));
	REQUIRE(tStore.sEntryCount == 2 && tStore.lLibraryVersion == 7);
	free(pCorrupted);
	free(pArchive);
	A8E_LibraryStore_Free(&tStore);

	{
		static const char aBadJson[] =
			"{\"format\":\"a8e-library-export\",\"schemaVersion\":2,"
			"\"libraryVersion\":7,\"createdAt\":\"2026-10-08T15:00:00Z\",\"library\":[]}";
		REQUIRE(!A8E_LibraryPackage_ValidateManifest(
			(const uint8_t *)aBadJson, (uint32_t)(sizeof(aBadJson) - 1),
			NULL, sError, sizeof(sError)));
	}
	printf("library_package_probe passed\n");
	return 0;
}
