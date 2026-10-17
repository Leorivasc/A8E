#include "LibraryImage.h"

#include <string.h>
#include <stdlib.h>
#include <stdio.h>

#define A8E_ATR_HEADER_SIZE 16u
#define A8E_ATR_SECTOR_COUNT 720u
#define A8E_ATR_SECTOR_SIZE 128u
#define A8E_ATR_VTOC_SECTOR 360u
#define A8E_ATR_DIRECTORY_START 361u
#define A8E_ATR_DIRECTORY_SECTORS 8u
#define A8E_ATR_DIRECTORY_ENTRIES_PER_SECTOR 8u
#define A8E_ATR_DIRECTORY_ENTRY_SIZE 16u

static uint32_t A8E_LibraryImage_ReadWord(const uint8_t *pBytes)
{
	return (uint32_t)pBytes[0] | ((uint32_t)pBytes[1] << 8);
}

static uint32_t A8E_LibraryImage_SectorOffset(
	uint32_t lSector,
	uint32_t lSectorSize)
{
	if(lSector < 1u) return UINT32_MAX;
	if(lSector <= 3u) return A8E_ATR_HEADER_SIZE + (lSector - 1u) * 128u;
	return A8E_ATR_HEADER_SIZE + 3u * 128u + (lSector - 4u) * lSectorSize;
}

static const uint8_t *A8E_LibraryImage_GetSector(
	const uint8_t *pBytes,
	uint32_t lSize,
	uint32_t lSector,
	uint32_t lSectorSize)
{
	uint32_t lOffset = A8E_LibraryImage_SectorOffset(lSector, lSectorSize);
	uint32_t lBytes = lSector <= 3u ? 128u : lSectorSize;
	if(lOffset == UINT32_MAX || lOffset > lSize || lBytes > lSize - lOffset) return NULL;
	return pBytes + lOffset;
}

static int A8E_LibraryImage_IsActiveEntry(uint8_t nStatus)
{
	return (nStatus & 0x40u) != 0u && (nStatus & 0x80u) == 0u;
}

static void A8E_LibraryImage_SetDiagnostic(
	char *pTarget,
	const char *pMessage)
{
	if(!pTarget || pTarget[0] || !pMessage) return;
	strncpy(pTarget, pMessage, 127u);
	pTarget[127] = '\0';
}

static void A8E_LibraryImage_AddError(
	A8E_LibraryAtrIntegrityReport *pReport,
	const char *pMessage)
{
	if(!pReport) return;
	pReport->errorCount++;
	A8E_LibraryImage_SetDiagnostic(pReport->firstError, pMessage);
	pReport->valid = 0u;
}

static void A8E_LibraryImage_AddWarning(
	A8E_LibraryAtrIntegrityReport *pReport,
	const char *pMessage)
{
	if(!pReport) return;
	pReport->warningCount++;
	A8E_LibraryImage_SetDiagnostic(pReport->firstWarning, pMessage);
}

static void A8E_LibraryImage_CopyName(
	char *pName,
	const uint8_t *pSource)
{
	uint32_t i;
	for(i = 0; i < 11u; i++) {
		uint8_t nCode = pSource[i] & 0x7Fu;
		if(nCode == 0u) break;
		pName[i] = (nCode >= 0x20u && nCode <= 0x7Eu) ? (char)nCode : '?';
	}
	while(i > 0u && pName[i - 1u] == ' ') i--;
	pName[i] = '\0';
}

int A8E_LibraryImage_CreateBlankAtr(
    uint8_t **ppBytes,
    uint32_t *pSize)
{
    uint32_t lDataSize = A8E_ATR_SECTOR_COUNT * A8E_ATR_SECTOR_SIZE;
    uint32_t lTotalSize = A8E_ATR_HEADER_SIZE + lDataSize;
    uint32_t lParagraphs = lDataSize / 16u;
    uint8_t *pBytes;

    if(!ppBytes || !pSize) return 0;
    *ppBytes = NULL;
    *pSize = 0;
    pBytes = (uint8_t *)calloc(lTotalSize, sizeof(*pBytes));
    if(!pBytes) return 0;

    pBytes[0] = 0x96;
    pBytes[1] = 0x02;
    pBytes[2] = (uint8_t)lParagraphs;
    pBytes[3] = (uint8_t)(lParagraphs >> 8);
    pBytes[4] = (uint8_t)A8E_ATR_SECTOR_SIZE;
    pBytes[5] = 0;
    pBytes[6] = (uint8_t)(lParagraphs >> 16);
    pBytes[7] = (uint8_t)(lParagraphs >> 24);
    *ppBytes = pBytes;
    *pSize = lTotalSize;
    return 1;
}

int A8E_LibraryImage_InspectAtr(
	const uint8_t *pBytes,
	uint32_t lSize,
	A8E_LibraryAtrInfo *pInfo)
{
	uint32_t lParagraphs;
	uint32_t lDataBytes;
	uint32_t lRemaining;
	uint32_t lSectorSize;
	uint32_t lTotalSectors;
	const uint8_t *pVtoc;
	uint32_t i;

	if(!pInfo) return 0;
	memset(pInfo, 0, sizeof(*pInfo));
	if(!pBytes || lSize < A8E_ATR_HEADER_SIZE) return 0;
	if(pBytes[0] != 0x96u || pBytes[1] != 0x02u) return 0;
	lSectorSize = A8E_LibraryImage_ReadWord(pBytes + 4u);
	lParagraphs = (uint32_t)pBytes[2] |
		((uint32_t)pBytes[3] << 8) |
		((uint32_t)pBytes[6] << 16) |
		((uint32_t)pBytes[7] << 24);
	lDataBytes = lParagraphs * 16u;
	if(lSectorSize < 128u || lSectorSize > 4096u ||
		lDataBytes < 3u * 128u) return 0;
	lRemaining = lDataBytes - 3u * 128u;
	if(lRemaining % lSectorSize != 0u || lSize != A8E_ATR_HEADER_SIZE + lDataBytes) return 0;
	lTotalSectors = 3u + lRemaining / lSectorSize;
	pInfo->valid = 1u;
	pInfo->sectorSize = lSectorSize;
	pInfo->totalSectors = lTotalSectors;
	pInfo->dataBytes = lDataBytes;
	pInfo->imageBytes = lSize;
	pInfo->paragraphs = lParagraphs;
	if(lTotalSectors < A8E_ATR_DIRECTORY_START + A8E_ATR_DIRECTORY_SECTORS - 1u) return 1;
	pVtoc = A8E_LibraryImage_GetSector(pBytes, lSize, A8E_ATR_VTOC_SECTOR, lSectorSize);
	if(!pVtoc || pVtoc[0] != 2u) return 1;
	pInfo->initialFreeSectors = A8E_LibraryImage_ReadWord(pVtoc + 1u);
	pInfo->freeSectors = A8E_LibraryImage_ReadWord(pVtoc + 3u);
	if(pInfo->initialFreeSectors > lTotalSectors || pInfo->freeSectors > lTotalSectors) {
		pInfo->initialFreeSectors = 0u;
		pInfo->freeSectors = 0u;
		return 1;
	}
	pInfo->filesystem = A8E_LIBRARY_IMAGE_FILESYSTEM_DOS2_MYDOS;
	for(i = 0; i < A8E_ATR_DIRECTORY_SECTORS * A8E_ATR_DIRECTORY_ENTRIES_PER_SECTOR; i++) {
		A8E_LibraryAtrDirectoryEntry Entry;
		if(A8E_LibraryImage_ReadDirectoryEntry(pBytes, lSize, pInfo, i, &Entry)) {
			pInfo->fileCount++;
		}
	}
	return 1;
}

int A8E_LibraryImage_VerifyAtr(
	const uint8_t *pBytes,
	uint32_t lSize,
	A8E_LibraryAtrIntegrityReport *pReport)
{
	A8E_LibraryAtrInfo Info;
	const uint8_t *pVtoc;
	uint8_t *pOwners = NULL;
	uint32_t lDataCapacity;
	uint32_t i;

	if(!pReport) return 0;
	memset(pReport, 0, sizeof(*pReport));
	pReport->valid = 1u;
	if(!A8E_LibraryImage_InspectAtr(pBytes, lSize, &Info)) {
		A8E_LibraryImage_AddError(pReport, "Invalid ATR geometry or header");
		return 1;
	}
	if(Info.totalSectors < A8E_ATR_DIRECTORY_START + A8E_ATR_DIRECTORY_SECTORS - 1u) {
		A8E_LibraryImage_AddWarning(pReport, "ATR is too small for a DOS 2.x/MyDOS directory");
		return 1;
	}
	pVtoc = A8E_LibraryImage_GetSector(pBytes, lSize, A8E_ATR_VTOC_SECTOR, Info.sectorSize);
	if(!pVtoc || pVtoc[0] != 2u) {
		A8E_LibraryImage_AddWarning(pReport, "DOS 2.x/MyDOS filesystem was not detected");
		return 1;
	}
	pReport->filesystemKnown = 1u;
	lDataCapacity = Info.totalSectors - 3u - 1u - A8E_ATR_DIRECTORY_SECTORS;
	if(A8E_LibraryImage_ReadWord(pVtoc + 1u) > Info.totalSectors ||
		A8E_LibraryImage_ReadWord(pVtoc + 3u) > Info.totalSectors) {
		A8E_LibraryImage_AddError(pReport, "VTOC free-sector count exceeds the ATR geometry");
	} else if(A8E_LibraryImage_ReadWord(pVtoc + 1u) > lDataCapacity ||
		A8E_LibraryImage_ReadWord(pVtoc + 3u) > lDataCapacity) {
		A8E_LibraryImage_AddWarning(pReport, "VTOC free-sector count includes reserved or unavailable sectors");
	}
	pOwners = (uint8_t *)calloc(Info.totalSectors + 1u, sizeof(*pOwners));
	if(!pOwners) {
		A8E_LibraryImage_AddError(pReport, "Unable to allocate ATR integrity workspace");
		return 1;
	}
	for(i = 0; i < A8E_ATR_DIRECTORY_SECTORS * A8E_ATR_DIRECTORY_ENTRIES_PER_SECTOR; i++) {
		uint32_t lDirectorySector = A8E_ATR_DIRECTORY_START + i / A8E_ATR_DIRECTORY_ENTRIES_PER_SECTOR;
		uint32_t lSlot = i % A8E_ATR_DIRECTORY_ENTRIES_PER_SECTOR;
		const uint8_t *pDirectory = A8E_LibraryImage_GetSector(pBytes, lSize, lDirectorySector, Info.sectorSize);
		const uint8_t *pRaw;
		uint32_t lSectors;
		uint32_t lSector;
		uint32_t j;
		if(!pDirectory) {
			A8E_LibraryImage_AddError(pReport, "DOS directory sector is outside the ATR image");
			continue;
		}
		pRaw = pDirectory + lSlot * A8E_ATR_DIRECTORY_ENTRY_SIZE;
		if(!A8E_LibraryImage_IsActiveEntry(pRaw[0])) continue;
		pReport->checkedFiles++;
		lSectors = A8E_LibraryImage_ReadWord(pRaw + 1u);
		lSector = A8E_LibraryImage_ReadWord(pRaw + 3u);
		if(!lSectors || lSector < 1u || lSector > Info.totalSectors ||
			!(pRaw[5] & 0x7Fu)) {
			A8E_LibraryImage_AddError(pReport, "DOS directory entry has invalid name, length, or start sector");
			continue;
		}
		for(j = 0; j < lSectors; j++) {
			const uint8_t *pSector;
			uint32_t lNext;
			uint32_t lUsed;
			if(lSector < 4u || lSector > Info.totalSectors || lSector == A8E_ATR_VTOC_SECTOR ||
				(lSector >= A8E_ATR_DIRECTORY_START &&
				 lSector < A8E_ATR_DIRECTORY_START + A8E_ATR_DIRECTORY_SECTORS)) {
				A8E_LibraryImage_AddError(pReport, "DOS directory entry references a reserved or out-of-range sector");
				break;
			}
			if(pOwners[lSector]) {
				A8E_LibraryImage_AddError(pReport, "DOS files share an allocated sector");
				break;
			}
			pOwners[lSector] = 1u;
			pReport->checkedSectors++;
			pSector = A8E_LibraryImage_GetSector(pBytes, lSize, lSector, Info.sectorSize);
			if(!pSector) {
				A8E_LibraryImage_AddError(pReport, "DOS directory entry references a sector outside the ATR image");
				break;
			}
			lNext = ((uint32_t)(pSector[Info.sectorSize - 3u] & 0x03u) << 8) |
				pSector[Info.sectorSize - 2u];
			lUsed = pSector[Info.sectorSize - 1u];
			if(lUsed > Info.sectorSize - 3u) {
				A8E_LibraryImage_AddError(pReport, "DOS sector contains an invalid used-byte count");
			}
			if(j + 1u < lSectors && lNext == 0u) {
				A8E_LibraryImage_AddError(pReport, "DOS sector chain terminates before its directory count");
				break;
			}
			if(j + 1u == lSectors && lNext != 0u) {
				A8E_LibraryImage_AddError(pReport, "DOS sector chain contains more sectors than its directory count");
				break;
			}
			lSector = lNext;
		}
	}
	free(pOwners);
	return 1;
}

int A8E_LibraryImage_ReadDirectoryEntry(
	const uint8_t *pBytes,
	uint32_t lSize,
	const A8E_LibraryAtrInfo *pInfo,
	uint32_t lIndex,
	A8E_LibraryAtrDirectoryEntry *pEntry)
{
	uint32_t lSector;
	uint32_t lSlot;
	const uint8_t *pDirectory;
	const uint8_t *pRaw;

	if(!pBytes || !pInfo || !pEntry || !pInfo->valid ||
		pInfo->filesystem != A8E_LIBRARY_IMAGE_FILESYSTEM_DOS2_MYDOS ||
		lIndex >= A8E_ATR_DIRECTORY_SECTORS * A8E_ATR_DIRECTORY_ENTRIES_PER_SECTOR) return 0;
	lSector = A8E_ATR_DIRECTORY_START + lIndex / A8E_ATR_DIRECTORY_ENTRIES_PER_SECTOR;
	lSlot = lIndex % A8E_ATR_DIRECTORY_ENTRIES_PER_SECTOR;
	pDirectory = A8E_LibraryImage_GetSector(pBytes, lSize, lSector, pInfo->sectorSize);
	if(!pDirectory) return 0;
	pRaw = pDirectory + lSlot * A8E_ATR_DIRECTORY_ENTRY_SIZE;
	if(!A8E_LibraryImage_IsActiveEntry(pRaw[0])) return 0;
	memset(pEntry, 0, sizeof(*pEntry));
	pEntry->index = lIndex;
	pEntry->status = pRaw[0];
	pEntry->locked = (pRaw[0] & 0x20u) != 0u;
	pEntry->open = (pRaw[0] & 0x01u) != 0u;
	pEntry->sectors = A8E_LibraryImage_ReadWord(pRaw + 1u);
	pEntry->startSector = A8E_LibraryImage_ReadWord(pRaw + 3u);
	if(!pEntry->sectors || pEntry->startSector < 1u || pEntry->startSector > pInfo->totalSectors) return 0;
	A8E_LibraryImage_CopyName(pEntry->name, pRaw + 5u);
	if(!pEntry->name[0]) return 0;
	return 1;
}

int A8E_LibraryImage_ExtractFile(
	const uint8_t *pBytes,
	uint32_t lSize,
	const A8E_LibraryAtrInfo *pInfo,
	uint32_t lIndex,
	uint8_t **ppFile,
	uint32_t *pFileSize)
{
	A8E_LibraryAtrDirectoryEntry Entry;
	uint8_t *pVisited = NULL;
	uint8_t *pOutput = NULL;
	uint32_t lPayloadSize;
	uint32_t lMaxSize;
	uint32_t lOutputSize = 0;
	uint32_t lSector;
	uint32_t i;

	if(!ppFile || !pFileSize) return 0;
	*ppFile = NULL;
	*pFileSize = 0;
	if(!A8E_LibraryImage_ReadDirectoryEntry(pBytes, lSize, pInfo, lIndex, &Entry)) return 0;
	lPayloadSize = pInfo->sectorSize - 3u;
	if(Entry.sectors > UINT32_MAX / lPayloadSize) return 0;
	lMaxSize = Entry.sectors * lPayloadSize;
	pOutput = (uint8_t *)malloc(lMaxSize ? lMaxSize : 1u);
	pVisited = (uint8_t *)calloc(pInfo->totalSectors + 1u, sizeof(*pVisited));
	if(!pOutput || !pVisited) {
		free(pOutput);
		free(pVisited);
		return 0;
	}
	lSector = Entry.startSector;
	for(i = 0; i < Entry.sectors; i++) {
		const uint8_t *pSector;
		uint32_t lNext;
		uint32_t lUsed;
		uint32_t lLength;
		if(lSector < 1u || lSector > pInfo->totalSectors || pVisited[lSector]) {
			free(pOutput);
			free(pVisited);
			return 0;
		}
		pVisited[lSector] = 1u;
		pSector = A8E_LibraryImage_GetSector(pBytes, lSize, lSector, pInfo->sectorSize);
		if(!pSector) {
			free(pOutput);
			free(pVisited);
			return 0;
		}
		lNext = ((uint32_t)(pSector[pInfo->sectorSize - 3u] & 0x03u) << 8) |
			pSector[pInfo->sectorSize - 2u];
		lUsed = pSector[pInfo->sectorSize - 1u];
		if(lUsed > lPayloadSize) lUsed = lPayloadSize;
		lLength = lNext == 0u || i + 1u == Entry.sectors ? lUsed : lPayloadSize;
		memcpy(pOutput + lOutputSize, pSector, lLength);
		lOutputSize += lLength;
		if(lNext == 0u) break;
		lSector = lNext;
	}
	free(pVisited);
	*ppFile = pOutput;
	*pFileSize = lOutputSize;
	return 1;
}

int A8E_LibraryImage_DecodeAtascii(
	const uint8_t *pBytes,
	uint32_t lSize,
	char **ppText,
	uint32_t *pTextSize)
{
	char *pText;
	uint32_t i;

	if(!ppText || !pTextSize) return 0;
	*ppText = NULL;
	*pTextSize = 0;
	if(!pBytes && lSize) return 0;
	pText = (char *)malloc(lSize + 1u);
	if(!pText) return 0;
	for(i = 0; i < lSize; i++) {
		uint8_t nRaw = pBytes[i];
		uint8_t nCode = nRaw & 0x7Fu;
		if(nRaw == 0x9Bu) pText[i] = '\n';
		else if(nCode == 0x09u) pText[i] = '\t';
		else if(nCode >= 0x20u && nCode <= 0x7Eu) pText[i] = (char)nCode;
		else pText[i] = '.';
	}
	pText[lSize] = '\0';
	*ppText = pText;
	*pTextSize = lSize;
	return 1;
}
