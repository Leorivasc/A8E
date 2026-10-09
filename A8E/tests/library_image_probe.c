#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "LibraryImage.h"

#define REQUIRE(condition) \
	do { if(!(condition)) { fprintf(stderr, "requirement failed at line %d\n", __LINE__); return 1; } } while(0)

int main(void)
{
	uint8_t *pBytes = NULL;
	uint32_t lSize = 0;
	A8E_LibraryAtrInfo Info;
	A8E_LibraryAtrDirectoryEntry Entry;
	uint8_t *pFile = NULL;
	uint32_t lFileSize = 0;
	char *pText = NULL;
	uint32_t lTextSize = 0;
	REQUIRE(A8E_LibraryImage_CreateBlankAtr(&pBytes, &lSize));
	REQUIRE(pBytes != NULL);
	REQUIRE(lSize == 16u + 720u * 128u);
	REQUIRE(pBytes[0] == 0x96 && pBytes[1] == 0x02);
	REQUIRE(pBytes[4] == 128u && pBytes[5] == 0);
	REQUIRE(pBytes[2] == 0x80 && pBytes[3] == 0x16);
	REQUIRE(A8E_LibraryImage_InspectAtr(pBytes, lSize, &Info));
	REQUIRE(Info.valid && Info.totalSectors == 720u);
	REQUIRE(Info.filesystem == A8E_LIBRARY_IMAGE_FILESYSTEM_UNKNOWN);
	free(pBytes);

	pBytes = NULL;
	lSize = 0;
	REQUIRE(A8E_LibraryImage_CreateBlankAtr(&pBytes, &lSize));
	pBytes[16u + (360u - 1u) * 128u] = 2u;
	pBytes[16u + (360u - 1u) * 128u + 1u] = 707u & 0xffu;
	pBytes[16u + (360u - 1u) * 128u + 2u] = 707u >> 8;
	pBytes[16u + (360u - 1u) * 128u + 3u] = 707u & 0xffu;
	pBytes[16u + (360u - 1u) * 128u + 4u] = 707u >> 8;
	pBytes[16u + (361u - 1u) * 128u] = 0x42u;
	pBytes[16u + (361u - 1u) * 128u + 1u] = 1u;
	pBytes[16u + (361u - 1u) * 128u + 3u] = 4u;
	memcpy(pBytes + 16u + (361u - 1u) * 128u + 5u, "HELLO   TXT", 11u);
	memcpy(pBytes + 16u + (4u - 1u) * 128u, "Hello\n", 6u);
	pBytes[16u + (4u - 1u) * 128u + 127u] = 6u;
	REQUIRE(A8E_LibraryImage_InspectAtr(pBytes, lSize, &Info));
	REQUIRE(Info.filesystem == A8E_LIBRARY_IMAGE_FILESYSTEM_DOS2_MYDOS);
	REQUIRE(Info.fileCount == 1u);
	REQUIRE(A8E_LibraryImage_ReadDirectoryEntry(pBytes, lSize, &Info, 0u, &Entry));
	REQUIRE(strcmp(Entry.name, "HELLO   TXT") == 0);
	REQUIRE(A8E_LibraryImage_ExtractFile(pBytes, lSize, &Info, 0u, &pFile, &lFileSize));
	REQUIRE(lFileSize == 6u && memcmp(pFile, "Hello\n", 6u) == 0);
	free(pFile);
	REQUIRE(A8E_LibraryImage_DecodeAtascii((const uint8_t *)"A\233B", 3u, &pText, &lTextSize));
	REQUIRE(lTextSize == 3u && strcmp(pText, "A\nB") == 0);
	free(pText);
	free(pBytes);
	printf("library_image_probe passed\n");
	return 0;
}
