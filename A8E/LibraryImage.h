#ifndef A8E_LIBRARY_IMAGE_H
#define A8E_LIBRARY_IMAGE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define A8E_LIBRARY_IMAGE_FILESYSTEM_UNKNOWN 0u
#define A8E_LIBRARY_IMAGE_FILESYSTEM_DOS2_MYDOS 1u

typedef struct A8E_LibraryAtrInfo {
	uint32_t valid;
	uint32_t sectorSize;
	uint32_t totalSectors;
	uint32_t dataBytes;
	uint32_t imageBytes;
	uint32_t paragraphs;
	uint32_t filesystem;
	uint32_t initialFreeSectors;
	uint32_t freeSectors;
	uint32_t fileCount;
} A8E_LibraryAtrInfo;

typedef struct A8E_LibraryAtrDirectoryEntry {
	uint32_t index;
	uint8_t status;
	uint32_t sectors;
	uint32_t startSector;
	uint32_t locked;
	uint32_t open;
	char name[12];
} A8E_LibraryAtrDirectoryEntry;

/* Creates a standard writable 90 KiB ATR: 720 sectors of 128 bytes. */
int A8E_LibraryImage_CreateBlankAtr(
    uint8_t **ppBytes,
    uint32_t *pSize);

/* Inspects ATR geometry and the read-only DOS 2.x/MyDOS directory layout. */
int A8E_LibraryImage_InspectAtr(
	const uint8_t *pBytes,
	uint32_t lSize,
	A8E_LibraryAtrInfo *pInfo);

/* Reads one active directory entry. Returns zero for unused or invalid slots. */
int A8E_LibraryImage_ReadDirectoryEntry(
    const uint8_t *pBytes,
    uint32_t lSize,
    const A8E_LibraryAtrInfo *pInfo,
    uint32_t lIndex,
    A8E_LibraryAtrDirectoryEntry *pEntry);

/* Extracts one DOS sector chain into a newly allocated buffer. */
int A8E_LibraryImage_ExtractFile(
    const uint8_t *pBytes,
    uint32_t lSize,
    const A8E_LibraryAtrInfo *pInfo,
    uint32_t lIndex,
    uint8_t **ppFile,
    uint32_t *pFileSize);

/* Converts basic ATASCII text to a newly allocated display string. */
int A8E_LibraryImage_DecodeAtascii(
    const uint8_t *pBytes,
    uint32_t lSize,
    char **ppText,
    uint32_t *pTextSize);

#ifdef __cplusplus
}
#endif

#endif
