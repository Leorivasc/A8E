#include "LibraryWindow.h"

#include <ctype.h>
#include <stdio.h>
#include <string.h>

#include "AtariIo.h"
#include "LibraryImage.h"

#define A8E_LIBRARY_WINDOW_WIDTH 920
#define A8E_LIBRARY_WINDOW_HEIGHT 560
#define A8E_LIBRARY_ROW_HEIGHT 24
#define A8E_LIBRARY_LIST_TOP 68
#define A8E_LIBRARY_NAME_X 14
#define A8E_LIBRARY_TYPE_X 270
#define A8E_LIBRARY_DRIVE_X 330
#define A8E_LIBRARY_DRIVE_WIDTH 68
#define A8E_LIBRARY_CHAR_WIDTH 12
#define A8E_LIBRARY_NAME_MAX_CHARS \
	((A8E_LIBRARY_TYPE_X - A8E_LIBRARY_NAME_X) / A8E_LIBRARY_CHAR_WIDTH - 1)
#define A8E_LIBRARY_MAX_VISIBLE_ROWS 19
#define A8E_LIBRARY_ATR_LIST_TOP 104
#define A8E_LIBRARY_ATR_ROW_HEIGHT 22
#define A8E_LIBRARY_ATR_MAX_VISIBLE_ROWS 15
#define A8E_LIBRARY_ATR_DIRECTORY_ENTRIES 64
#define A8E_LIBRARY_ATR_SECT_X 152
#define A8E_LIBRARY_ATR_START_X 212
#define A8E_LIBRARY_ATR_STATE_X 284
#define A8E_LIBRARY_ATR_ACTION_X 368

typedef struct
{
	char cCharacter;
	uint8_t aRows[5];
} A8E_LibraryGlyph_t;

static const A8E_LibraryGlyph_t aGlyphs[] = {
	{ 'A', { 0x1e, 0x11, 0x1f, 0x11, 0x11 } }, { 'B', { 0x1e, 0x11, 0x1e, 0x11, 0x1e } },
	{ 'C', { 0x0f, 0x10, 0x10, 0x10, 0x0f } }, { 'D', { 0x1e, 0x11, 0x11, 0x11, 0x1e } },
	{ 'E', { 0x1f, 0x10, 0x1e, 0x10, 0x1f } }, { 'F', { 0x1f, 0x10, 0x1e, 0x10, 0x10 } },
	{ 'G', { 0x0f, 0x10, 0x17, 0x11, 0x0f } }, { 'H', { 0x11, 0x11, 0x1f, 0x11, 0x11 } },
	{ 'I', { 0x1f, 0x04, 0x04, 0x04, 0x1f } }, { 'J', { 0x01, 0x01, 0x01, 0x11, 0x0e } },
	{ 'K', { 0x11, 0x12, 0x1c, 0x12, 0x11 } }, { 'L', { 0x10, 0x10, 0x10, 0x10, 0x1f } },
	{ 'M', { 0x11, 0x1b, 0x15, 0x11, 0x11 } }, { 'N', { 0x11, 0x19, 0x15, 0x13, 0x11 } },
	{ 'O', { 0x0e, 0x11, 0x11, 0x11, 0x0e } }, { 'P', { 0x1e, 0x11, 0x1e, 0x10, 0x10 } },
	{ 'Q', { 0x0e, 0x11, 0x11, 0x15, 0x0f } }, { 'R', { 0x1e, 0x11, 0x1e, 0x12, 0x11 } },
	{ 'S', { 0x0f, 0x10, 0x0e, 0x01, 0x1e } }, { 'T', { 0x1f, 0x04, 0x04, 0x04, 0x04 } },
	{ 'U', { 0x11, 0x11, 0x11, 0x11, 0x0e } }, { 'V', { 0x11, 0x11, 0x11, 0x0a, 0x04 } },
	{ 'W', { 0x11, 0x11, 0x15, 0x1b, 0x11 } }, { 'X', { 0x11, 0x0a, 0x04, 0x0a, 0x11 } },
	{ 'Y', { 0x11, 0x0a, 0x04, 0x04, 0x04 } }, { 'Z', { 0x1f, 0x02, 0x04, 0x08, 0x1f } },
	{ '0', { 0x0e, 0x13, 0x15, 0x19, 0x0e } }, { '1', { 0x04, 0x0c, 0x04, 0x04, 0x0e } },
	{ '2', { 0x1e, 0x01, 0x0e, 0x10, 0x1f } }, { '3', { 0x1e, 0x01, 0x0e, 0x01, 0x1e } },
	{ '4', { 0x12, 0x12, 0x1f, 0x02, 0x02 } }, { '5', { 0x1f, 0x10, 0x1e, 0x01, 0x1e } },
	{ '6', { 0x0e, 0x10, 0x1e, 0x11, 0x0e } }, { '7', { 0x1f, 0x01, 0x02, 0x04, 0x04 } },
	{ '8', { 0x0e, 0x11, 0x0e, 0x11, 0x0e } }, { '9', { 0x0e, 0x11, 0x0f, 0x01, 0x0e } },
	{ ' ', { 0x00, 0x00, 0x00, 0x00, 0x00 } }, { '!', { 0x04, 0x04, 0x04, 0x00, 0x04 } },
	{ '\'', { 0x04, 0x04, 0x00, 0x00, 0x00 } }, { '(', { 0x02, 0x04, 0x08, 0x08, 0x04 } },
	{ ')', { 0x08, 0x04, 0x02, 0x02, 0x04 } }, { '+', { 0x00, 0x04, 0x1f, 0x04, 0x00 } },
	{ ',', { 0x00, 0x00, 0x00, 0x04, 0x08 } }, { '=', { 0x00, 0x1f, 0x00, 0x1f, 0x00 } },
	{ '[', { 0x0e, 0x08, 0x08, 0x08, 0x0e } }, { ']', { 0x0e, 0x02, 0x02, 0x02, 0x0e } },
	{ '-', { 0x00, 0x00, 0x1f, 0x00, 0x00 } }, { ':', { 0x00, 0x04, 0x00, 0x04, 0x00 } },
	{ '.', { 0x00, 0x00, 0x00, 0x00, 0x04 } }, { '/', { 0x01, 0x02, 0x04, 0x08, 0x10 } },
	{ '_', { 0x00, 0x00, 0x00, 0x00, 0x1f } }, { '*', { 0x00, 0x15, 0x0e, 0x15, 0x00 } },
	{ '?', { 0x0e, 0x11, 0x02, 0x00, 0x02 } },
};

static int A8E_LibraryWindow_IsAbsolutePath(const char *pPath)
{
	if(!pPath || !pPath[0]) return 0;
	if(pPath[0] == '/' || pPath[0] == '\\') return 1;
	return isalpha((unsigned char)pPath[0]) && pPath[1] == ':';
}

static const char *A8E_LibraryWindow_ResolvePackagePath(
	const char *pPath,
	char *pResolved,
	uint32_t lResolvedSize)
{
	FILE *pFile;
	char *pBasePath;
	if(!pPath || !pPath[0] || !pResolved || lResolvedSize == 0) return pPath;
	pFile = fopen(pPath, "rb");
	if(pFile)
	{
		fclose(pFile);
		return pPath;
	}
	if(A8E_LibraryWindow_IsAbsolutePath(pPath)) return pPath;
	pBasePath = SDL_GetBasePath();
	if(!pBasePath) return pPath;
	if(strlen(pBasePath) + strlen(pPath) + 1u >= lResolvedSize)
	{
		SDL_free(pBasePath);
		return pPath;
	}
	snprintf(pResolved, lResolvedSize, "%s%s", pBasePath, pPath);
	SDL_free(pBasePath);
	pFile = fopen(pResolved, "rb");
	if(pFile)
	{
		fclose(pFile);
		return pResolved;
	}
	return pPath;
}

static const uint8_t *A8E_LibraryWindow_FindGlyph(char cCharacter)
{
	uint32_t i;
	for(i = 0; i < sizeof(aGlyphs) / sizeof(aGlyphs[0]); i++)
		if(aGlyphs[i].cCharacter == cCharacter) return aGlyphs[i].aRows;
	return aGlyphs[sizeof(aGlyphs) / sizeof(aGlyphs[0]) - 1u].aRows;
}

static void A8E_LibraryWindow_Text(
	SDL_Renderer *pRenderer, int lX, int lY, const char *pText, SDL_Color tColor)
{
	const int lScale = 2;
	const char *p;
	SDL_SetRenderDrawColor(pRenderer, tColor.r, tColor.g, tColor.b, tColor.a);
	for(p = pText; p && *p; p++, lX += 6 * lScale)
	{
		const uint8_t *pGlyph = A8E_LibraryWindow_FindGlyph(
			(char)toupper((unsigned char)*p));
		int y;
		for(y = 0; y < 5; y++)
		{
			int x;
			for(x = 0; x < 5; x++)
				if(pGlyph[y] & (uint8_t)(1u << (4 - x)))
				{
					SDL_Rect tPixel = { lX + x * lScale, lY + y * lScale, lScale, lScale };
					SDL_RenderFillRect(pRenderer, &tPixel);
				}
		}
	}
}

static void A8E_LibraryWindow_CopyColumnText(
	char *pDestination,
	uint32_t lDestinationSize,
	const char *pSource,
	uint32_t lMaximumCharacters)
{
	uint32_t lLength;
	if(!pDestination || lDestinationSize == 0) return;
	if(!pSource) pSource = "";
	lLength = (uint32_t)strlen(pSource);
	if(lLength <= lMaximumCharacters || lMaximumCharacters < 4u)
	{
		if(lLength >= lDestinationSize) lLength = lDestinationSize - 1u;
		memcpy(pDestination, pSource, lLength);
		pDestination[lLength] = '\0';
		return;
	}
	if(lMaximumCharacters >= lDestinationSize) lMaximumCharacters = lDestinationSize - 1u;
	memcpy(pDestination, pSource, lMaximumCharacters - 3u);
	memcpy(pDestination + lMaximumCharacters - 3u, "...", 3u);
	pDestination[lMaximumCharacters] = '\0';
}

static void A8E_LibraryWindow_CopyMountedIds(A8E_LibraryWindow_t *pWindow)
{
	uint32_t lDrive;
	memset(pWindow->acMountedIds, 0, sizeof(pWindow->acMountedIds));
	for(lDrive = 0; lDrive < 8u; lDrive++)
	{
		const char *pId = A8E_LibraryRepository_GetDeviceEntryId(pWindow->pRepository, lDrive);
		if(pId) strncpy(pWindow->acMountedIds[lDrive], pId,
			sizeof(pWindow->acMountedIds[lDrive]) - 1u);
	}
}

static int A8E_LibraryWindow_MatchesSearch(
	const A8E_LibraryWindow_t *pWindow,
	const A8E_LibraryRepositoryRecord_t *pRecord)
{
	const char *pName = pRecord ? pRecord->pName : NULL;
	uint16_t i;
	if(pWindow->sSearchLength == 0 || !pName) return 1;
	for(; *pName; pName++)
	{
		for(i = 0; i < pWindow->sSearchLength && pName[i]; i++)
			if(toupper((unsigned char)pName[i]) !=
				toupper((unsigned char)pWindow->acSearch[i])) break;
		if(i == pWindow->sSearchLength) return 1;
	}
	return 0;
}

static const A8E_LibraryRepositoryRecord_t *A8E_LibraryWindow_VisibleRecord(
	const A8E_LibraryWindow_t *pWindow, uint32_t lVisibleIndex)
{
	uint16_t sIndex;
	for(sIndex = 0; sIndex < pWindow->pRepository->sRecordCount; sIndex++)
	{
		const A8E_LibraryRepositoryRecord_t *pRecord =
			A8E_LibraryRepository_GetRecord(pWindow->pRepository, sIndex);
		if(!A8E_LibraryWindow_MatchesSearch(pWindow, pRecord)) continue;
		if(lVisibleIndex-- == 0u) return pRecord;
	}
	return NULL;
}

static uint32_t A8E_LibraryWindow_VisibleCount(const A8E_LibraryWindow_t *pWindow)
{
	uint16_t sIndex;
	uint32_t lCount = 0;
	for(sIndex = 0; sIndex < pWindow->pRepository->sRecordCount; sIndex++)
		if(A8E_LibraryWindow_MatchesSearch(
			pWindow, A8E_LibraryRepository_GetRecord(pWindow->pRepository, sIndex))) lCount++;
	return lCount;
}

static int A8E_LibraryWindow_SaveDirtyDrive(
	A8E_LibraryWindow_t *pWindow, uint32_t lDrive)
{
	const uint8_t *pBytes;
	uint32_t lSize;
	if(lDrive >= 8u || pWindow->acMountedIds[lDrive][0] == '\0' ||
		!AtariIoIsDiskDirty(pWindow->pContext, lDrive)) return 1;
	pBytes = AtariIoGetDiskBytes(pWindow->pContext, lDrive, &lSize);
	if(!pBytes) return 0;
	return A8E_LibraryRepository_SaveWorkingCopy(
		pWindow->pRepository, "library", pWindow->acMountedIds[lDrive],
		pBytes, lSize, NULL, 0);
}

static int A8E_LibraryWindow_SaveWorkspace(A8E_LibraryWindow_t *pWindow)
{
	const char *apEntryIds[8];
	uint8_t abWriteProtected[8];
	uint32_t lDrive;
	for(lDrive = 0; lDrive < 8u; lDrive++)
	{
		apEntryIds[lDrive] = pWindow->acMountedIds[lDrive][0]
			? pWindow->acMountedIds[lDrive] : NULL;
		abWriteProtected[lDrive] = apEntryIds[lDrive]
			? (uint8_t)!AtariIoIsDiskWritable(pWindow->pContext, lDrive) : 0u;
	}
	return A8E_LibraryRepository_SaveWorkspace(
		pWindow->pRepository, "library", apEntryIds,
		abWriteProtected, NULL, 0);
}

static const A8E_LibraryRepositoryRecord_t *A8E_LibraryWindow_FindId(
	const A8E_LibraryRepository_t *pRepository, const char *pId)
{
	uint16_t sIndex;
	if(!pRepository || !pId) return NULL;
	for(sIndex = 0; sIndex < pRepository->sRecordCount; sIndex++)
	{
		const A8E_LibraryRepositoryRecord_t *pRecord =
			A8E_LibraryRepository_GetRecord(pRepository, sIndex);
		if(pRecord && strcmp(pRecord->pId, pId) == 0) return pRecord;
	}
	return NULL;
}

static const A8E_LibraryRepositoryRecord_t *A8E_LibraryWindow_CurrentAtr(
	const A8E_LibraryWindow_t *pWindow)
{
	const A8E_LibraryRepositoryRecord_t *pRecord;
	if(!pWindow || !pWindow->bAtrView || !pWindow->acAtrEntryId[0]) return NULL;
	pRecord = A8E_LibraryWindow_FindId(pWindow->pRepository, pWindow->acAtrEntryId);
	if(!pRecord || strcmp(pRecord->pType, "atr") != 0) return NULL;
	return pRecord;
}

static int A8E_LibraryWindow_GetAtrEntry(
	const A8E_LibraryWindow_t *pWindow,
	uint32_t lVisibleIndex,
	A8E_LibraryAtrDirectoryEntry *pEntry,
	A8E_LibraryAtrInfo *pInfo)
{
	const A8E_LibraryRepositoryRecord_t *pRecord;
	const uint8_t *pBytes;
	uint32_t lSize;
	uint32_t lIndex;
	uint32_t lFound = 0;

	if(!pEntry || !pInfo) return 0;
	pRecord = A8E_LibraryWindow_CurrentAtr(pWindow);
	if(!pRecord) return 0;
	pBytes = A8E_LibraryRepository_GetPayload(pWindow->pRepository,
		pRecord->pPath, &lSize);
	if(!pBytes || !A8E_LibraryImage_InspectAtr(pBytes, lSize, pInfo)) return 0;
	for(lIndex = 0; lIndex < A8E_LIBRARY_ATR_DIRECTORY_ENTRIES; lIndex++)
	{
		if(!A8E_LibraryImage_ReadDirectoryEntry(
			pBytes, lSize, pInfo, lIndex, pEntry)) continue;
		if(lFound++ == lVisibleIndex) return 1;
	}
	return 0;
}

static uint32_t A8E_LibraryWindow_AtrEntryCount(
	const A8E_LibraryWindow_t *pWindow,
	A8E_LibraryAtrInfo *pInfo)
{
	uint32_t lCount = 0;
	uint32_t lIndex;
	A8E_LibraryAtrDirectoryEntry Entry;
	if(!pInfo) return 0;
	for(lIndex = 0; lIndex < A8E_LIBRARY_ATR_DIRECTORY_ENTRIES; lIndex++)
		if(A8E_LibraryWindow_GetAtrEntry(pWindow, lCount, &Entry, pInfo)) lCount++;
	return lCount;
}

static void A8E_LibraryWindow_CloseAtr(
	A8E_LibraryWindow_t *pWindow)
{
	if(!pWindow) return;
	pWindow->bAtrView = 0;
	pWindow->bAtrPreview = 0;
	pWindow->sAtrSelectedRow = 0;
	pWindow->sAtrScroll = 0;
	pWindow->acAtrEntryId[0] = '\0';
	pWindow->acAtrPreview[0] = '\0';
	strncpy(pWindow->acStatus, "BACK TO LIBRARY", sizeof(pWindow->acStatus) - 1u);
}

static int A8E_LibraryWindow_OpenAtr(
	A8E_LibraryWindow_t *pWindow,
	const A8E_LibraryRepositoryRecord_t *pRecord)
{
	const uint8_t *pBytes;
	uint32_t lSize;
	A8E_LibraryAtrInfo Info;
	if(!pWindow || !pRecord || strcmp(pRecord->pType, "atr") != 0) return 0;
	pBytes = A8E_LibraryRepository_GetPayload(
		pWindow->pRepository, pRecord->pPath, &lSize);
	if(!pBytes || !A8E_LibraryImage_InspectAtr(pBytes, lSize, &Info))
	{
		snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
			"INVALID ATR %s", pRecord->pName);
		return 0;
	}
	strncpy(pWindow->acAtrEntryId, pRecord->pId,
		sizeof(pWindow->acAtrEntryId) - 1u);
	pWindow->acAtrEntryId[sizeof(pWindow->acAtrEntryId) - 1u] = '\0';
	pWindow->bAtrView = 1;
	pWindow->bAtrPreview = 0;
	pWindow->sAtrSelectedRow = 0;
	pWindow->sAtrScroll = 0;
	pWindow->acAtrPreview[0] = '\0';
	snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
		"OPENED %s", pRecord->pName);
	return 1;
}

static void A8E_LibraryWindow_AppendPreview(
	A8E_LibraryWindow_t *pWindow,
	uint32_t *pOffset,
	const char *pText)
{
	uint32_t lLength;
	uint32_t lAvailable;
	if(!pWindow || !pOffset || !pText || *pOffset >= sizeof(pWindow->acAtrPreview) - 1u) return;
	lLength = (uint32_t)strlen(pText);
	lAvailable = (uint32_t)sizeof(pWindow->acAtrPreview) - 1u - *pOffset;
	if(lLength > lAvailable) lLength = lAvailable;
	memcpy(pWindow->acAtrPreview + *pOffset, pText, lLength);
	*pOffset += lLength;
	pWindow->acAtrPreview[*pOffset] = '\0';
}

static int A8E_LibraryWindow_BuildAtrPreview(
	A8E_LibraryWindow_t *pWindow,
	uint32_t lVisibleIndex)
{
	const A8E_LibraryRepositoryRecord_t *pRecord;
	A8E_LibraryAtrInfo Info;
	A8E_LibraryAtrDirectoryEntry Entry;
	const uint8_t *pBytes;
	uint8_t *pFile = NULL;
	uint32_t lSize;
	uint32_t lFileSize;
	uint32_t lPrintable = 0;
	uint32_t lLimit;
	uint32_t i;
	uint32_t lOffset = 0;
	char *pDecoded = NULL;
	uint32_t lDecodedSize = 0;

	if(!A8E_LibraryWindow_GetAtrEntry(pWindow, lVisibleIndex, &Entry, &Info)) return 0;
	pRecord = A8E_LibraryWindow_CurrentAtr(pWindow);
	if(!pRecord) return 0;
	pBytes = A8E_LibraryRepository_GetPayload(
		pWindow->pRepository, pRecord->pPath, &lSize);
	if(!pBytes || !A8E_LibraryImage_ExtractFile(
		pBytes, lSize, &Info, Entry.index, &pFile, &lFileSize)) return 0;
	lLimit = lFileSize < 4096u ? lFileSize : 4096u;
	for(i = 0; i < lLimit; i++)
	{
		uint8_t nCode = pFile[i] & 0x7Fu;
		if(nCode == 0x09u || nCode == 0x0Au || nCode == 0x0Du ||
			(nCode >= 0x20u && nCode <= 0x7Eu)) lPrintable++;
	}
	if(lLimit && lPrintable * 100u >= lLimit * 85u &&
		A8E_LibraryImage_DecodeAtascii(pFile, lFileSize, &pDecoded, &lDecodedSize))
	{
		A8E_LibraryWindow_AppendPreview(pWindow, &lOffset, pDecoded);
		if(lDecodedSize > sizeof(pWindow->acAtrPreview) - 1u)
			A8E_LibraryWindow_AppendPreview(pWindow, &lOffset, "\n...");
	}
	else
	{
		char sLine[96];
		lLimit = lFileSize < 768u ? lFileSize : 768u;
		for(i = 0; i < lLimit; i += 16u)
		{
			uint32_t j;
			int lWritten = snprintf(sLine, sizeof(sLine), "%06X  ", i);
			for(j = 0; j < 16u; j++)
				if(i + j < lLimit) lWritten += snprintf(
				sLine + lWritten, sizeof(sLine) - (size_t)lWritten,
				"%02X ", pFile[i + j]);
			A8E_LibraryWindow_AppendPreview(pWindow, &lOffset, sLine);
			A8E_LibraryWindow_AppendPreview(pWindow, &lOffset, "\n");
		}
		if(lFileSize > lLimit) A8E_LibraryWindow_AppendPreview(pWindow, &lOffset, "...\n");
	}
	free(pDecoded);
	free(pFile);
	pWindow->bAtrPreview = 1;
	snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
		"PREVIEW %s", Entry.name);
	return 1;
}

static void A8E_LibraryWindow_RestoreWorkspace(A8E_LibraryWindow_t *pWindow)
{
	uint32_t lDrive;
	for(lDrive = 0; lDrive < 8u; lDrive++)
	{
		const char *pId = A8E_LibraryRepository_GetDeviceEntryId(
			pWindow->pRepository, lDrive);
		const A8E_LibraryRepositoryRecord_t *pRecord =
			A8E_LibraryWindow_FindId(pWindow->pRepository, pId);
		const uint8_t *pBytes;
		uint32_t lSize;
		if(!pRecord) continue;
		pBytes = A8E_LibraryRepository_GetPayload(
			pWindow->pRepository, pRecord->pPath, &lSize);
		if(pBytes && AtariIoMountDisk(
			pWindow->pContext, lDrive, pBytes, lSize, pRecord->pName,
			(uint8_t)!A8E_LibraryRepository_IsDeviceWriteProtected(
				pWindow->pRepository, lDrive)))
		{
			strncpy(pWindow->acMountedIds[lDrive], pRecord->pId,
				sizeof(pWindow->acMountedIds[lDrive]) - 1u);
		}
	}
}

static void A8E_LibraryWindow_PerformPathOperation(A8E_LibraryWindow_t *pWindow)
{
	char sError[160];
	uint32_t lDrive;
	if(!pWindow || !pWindow->bPathInput || pWindow->sPathLength == 0) return;
	if(pWindow->cPathOperation == 'N')
	{
		char sName[1024];
		strncpy(sName, pWindow->acPath, sizeof(sName) - 1u);
		sName[sizeof(sName) - 1u] = '\0';
		if(!strchr(sName, '.') && strlen(sName) + 4u < sizeof(sName)) strcat(sName, ".atr");
		if(A8E_LibraryRepository_CreateBlankAtr(
			pWindow->pRepository, "library", sName, sError, sizeof(sError)))
			snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
				"CREATED %s", sName);
		else snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
				"CREATE FAILED %s", sError);
		return;
	}
	if(pWindow->cPathOperation == 'D')
	{
		A8E_LibraryAtrInfo Info;
		A8E_LibraryAtrDirectoryEntry Entry;
		const A8E_LibraryRepositoryRecord_t *pRecord =
			A8E_LibraryWindow_CurrentAtr(pWindow);
		const uint8_t *pBytes;
		uint8_t *pFile = NULL;
		uint32_t lSize;
		uint32_t lFileSize;
		FILE *pFileOutput;
		if(!pRecord || !A8E_LibraryWindow_GetAtrEntry(
			pWindow, pWindow->sAtrSelectedRow + pWindow->sAtrScroll, &Entry, &Info))
		{
			strncpy(pWindow->acStatus, "DOWNLOAD FAILED", sizeof(pWindow->acStatus) - 1u);
			return;
		}
		pBytes = A8E_LibraryRepository_GetPayload(
			pWindow->pRepository, pRecord->pPath, &lSize);
		if(!pBytes || !A8E_LibraryImage_ExtractFile(
			pBytes, lSize, &Info, Entry.index, &pFile, &lFileSize))
		{
			strncpy(pWindow->acStatus, "DOWNLOAD FAILED", sizeof(pWindow->acStatus) - 1u);
			return;
		}
		pFileOutput = fopen(pWindow->acPath, "wb");
		if(!pFileOutput || fwrite(pFile, 1u, lFileSize, pFileOutput) != lFileSize)
		{
			if(pFileOutput) fclose(pFileOutput);
			free(pFile);
			snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
				"DOWNLOAD FAILED %s", Entry.name);
			return;
		}
		fclose(pFileOutput);
		free(pFile);
		snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
			"DOWNLOADED %s", Entry.name);
		return;
	}
	if(pWindow->cPathOperation == 'E')
	{
		A8E_LibraryWindow_SaveDirty(pWindow);
		if(A8E_LibraryRepository_ExportPackageFile(
			pWindow->pRepository, pWindow->acPath, sError, sizeof(sError)))
			snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
				"EXPORTED %s", pWindow->acPath);
		else snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
				"EXPORT FAILED %s", sError);
		return;
	}
	A8E_LibraryWindow_SaveDirty(pWindow);
	{
		char sResolvedPackagePath[2048];
		const char *pPackagePath = A8E_LibraryWindow_ResolvePackagePath(
			pWindow->acPath, sResolvedPackagePath, sizeof(sResolvedPackagePath));
		for(lDrive = 0; lDrive < 8u; lDrive++)
		{
			AtariIoUnmountDisk(pWindow->pContext, lDrive);
			pWindow->acMountedIds[lDrive][0] = '\0';
		}
		if(!A8E_LibraryRepository_ImportPackageFile(
			pWindow->pRepository, "library", pPackagePath,
			sError, sizeof(sError)))
		{
			snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
				"IMPORT FAILED %s", sError);
			fprintf(stderr, "A8E Library import failed for '%s': %s\n",
				pPackagePath, sError);
			return;
		}
		A8E_LibraryWindow_RestoreWorkspace(pWindow);
		snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
			"IMPORTED %s", pPackagePath);
	}
}

static int A8E_LibraryWindow_Mount(
	A8E_LibraryWindow_t *pWindow,
	const A8E_LibraryRepositoryRecord_t *pRecord,
	uint32_t lDrive)
{
	const uint8_t *pBytes;
	uint32_t lSize;
	uint32_t i;
	if(!pRecord || lDrive >= 8u) return 0;
	for(i = 0; i < 8u; i++)
		if(i != lDrive && strcmp(pWindow->acMountedIds[i], pRecord->pId) == 0)
		{
			if(!A8E_LibraryWindow_SaveDirtyDrive(pWindow, i)) return 0;
			AtariIoUnmountDisk(pWindow->pContext, i);
			pWindow->acMountedIds[i][0] = '\0';
		}
	if(strcmp(pWindow->acMountedIds[lDrive], pRecord->pId) == 0)
	{
		if(!A8E_LibraryWindow_SaveDirtyDrive(pWindow, lDrive)) return 0;
		AtariIoUnmountDisk(pWindow->pContext, lDrive);
		pWindow->acMountedIds[lDrive][0] = '\0';
		if(!A8E_LibraryWindow_SaveWorkspace(pWindow))
			snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
				"UNMOUNTED BUT WORKSPACE SAVE FAILED");
		return 1;
	}
	if(pWindow->acMountedIds[lDrive][0] != '\0')
	{
		if(!A8E_LibraryWindow_SaveDirtyDrive(pWindow, lDrive)) return 0;
		AtariIoUnmountDisk(pWindow->pContext, lDrive);
		pWindow->acMountedIds[lDrive][0] = '\0';
	}
	pBytes = A8E_LibraryRepository_GetPayload(pWindow->pRepository, pRecord->pPath, &lSize);
	if(!pBytes || !AtariIoMountDisk(
		pWindow->pContext, lDrive, pBytes, lSize, pRecord->pName,
		(uint8_t)!A8E_LibraryRepository_IsDeviceWriteProtected(pWindow->pRepository, lDrive)))
	{
		snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
			"MOUNT FAILED %s", pRecord->pName);
		A8E_LibraryWindow_SaveWorkspace(pWindow);
		return 0;
	}
	strncpy(pWindow->acMountedIds[lDrive], pRecord->pId,
		sizeof(pWindow->acMountedIds[lDrive]) - 1u);
	if(!A8E_LibraryWindow_SaveWorkspace(pWindow))
	{
		snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
			"MOUNTED BUT WORKSPACE SAVE FAILED");
		return 0;
	}
	snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
		"MOUNTED %s IN D%u", pRecord->pName, lDrive + 1u);
	return 1;
}

int A8E_LibraryWindow_Init(
	A8E_LibraryWindow_t *pWindow,
	_6502_Context_t *pContext,
	A8E_LibraryRepository_t *pRepository)
{
	if(!pWindow || !pContext || !pRepository) return 0;
	memset(pWindow, 0, sizeof(*pWindow));
	pWindow->pContext = pContext;
	pWindow->pRepository = pRepository;
	pWindow->pWindow = SDL_CreateWindow(
		"A8E Library", SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED,
		A8E_LIBRARY_WINDOW_WIDTH, A8E_LIBRARY_WINDOW_HEIGHT,
		SDL_WINDOW_HIDDEN | SDL_WINDOW_RESIZABLE);
	if(!pWindow->pWindow) return 0;
	pWindow->pRenderer = SDL_CreateRenderer(
		pWindow->pWindow, -1, SDL_RENDERER_ACCELERATED | SDL_RENDERER_PRESENTVSYNC);
	if(!pWindow->pRenderer) pWindow->pRenderer = SDL_CreateRenderer(pWindow->pWindow, -1, 0);
	if(!pWindow->pRenderer)
	{
		SDL_DestroyWindow(pWindow->pWindow);
		memset(pWindow, 0, sizeof(*pWindow));
		return 0;
	}
	pWindow->lWindowId = SDL_GetWindowID(pWindow->pWindow);
	A8E_LibraryWindow_CopyMountedIds(pWindow);
	return 1;
}

void A8E_LibraryWindow_Free(A8E_LibraryWindow_t *pWindow)
{
	if(!pWindow) return;
	if(pWindow->pRenderer) SDL_DestroyRenderer(pWindow->pRenderer);
	if(pWindow->pWindow) SDL_DestroyWindow(pWindow->pWindow);
	memset(pWindow, 0, sizeof(*pWindow));
}

void A8E_LibraryWindow_Toggle(A8E_LibraryWindow_t *pWindow)
{
	if(!pWindow || !pWindow->pWindow) return;
	pWindow->bVisible = (uint8_t)!pWindow->bVisible;
	if(pWindow->bVisible)
	{
		SDL_ShowWindow(pWindow->pWindow);
		SDL_StartTextInput();
	}
	else
	{
		SDL_StopTextInput();
		SDL_HideWindow(pWindow->pWindow);
	}
}

int A8E_LibraryWindow_HandleEvent(
	A8E_LibraryWindow_t *pWindow, const SDL_Event *pEvent)
{
	int lRow;
	int lDrive;
	if(!pWindow || !pEvent || pEvent->type == SDL_QUIT ||
		pEvent->window.windowID != pWindow->lWindowId) return 0;
	if(pEvent->type == SDL_WINDOWEVENT && pEvent->window.event == SDL_WINDOWEVENT_CLOSE)
	{
		pWindow->bVisible = 0;
		SDL_StopTextInput();
		SDL_HideWindow(pWindow->pWindow);
		return 1;
	}
	if(pEvent->type == SDL_KEYDOWN && pEvent->key.keysym.sym == SDLK_ESCAPE)
	{
		if(pWindow->bPathInput)
		{
			pWindow->bPathInput = 0;
			pWindow->bIgnorePathActivation = 0;
			pWindow->sPathLength = 0;
			pWindow->acPath[0] = '\0';
			return 1;
		}
		if(pWindow->bAtrView)
		{
			A8E_LibraryWindow_CloseAtr(pWindow);
			return 1;
		}
		pWindow->bVisible = 0;
		SDL_StopTextInput();
		SDL_HideWindow(pWindow->pWindow);
		return 1;
	}
	if(pEvent->type == SDL_TEXTINPUT)
	{
		if(pWindow->bPathInput)
		{
			if(pWindow->bIgnorePathActivation)
			{
				pWindow->bIgnorePathActivation = 0;
				if(strlen(pEvent->text.text) == 1u &&
					tolower((unsigned char)pEvent->text.text[0]) ==
					tolower((unsigned char)pWindow->cPathOperation))
					return 1;
			}
			uint16_t lAvailable = (uint16_t)(sizeof(pWindow->acPath) -
				pWindow->sPathLength - 1u);
			uint16_t lLength = (uint16_t)strlen(pEvent->text.text);
			if(lLength > lAvailable) lLength = lAvailable;
			if(lLength > 0)
			{
				memcpy(pWindow->acPath + pWindow->sPathLength,
					pEvent->text.text, lLength);
				pWindow->sPathLength += lLength;
				pWindow->acPath[pWindow->sPathLength] = '\0';
			}
			return 1;
		}
		uint16_t lAvailable = (uint16_t)(sizeof(pWindow->acSearch) - pWindow->sSearchLength - 1u);
		uint16_t lLength = (uint16_t)strlen(pEvent->text.text);
		if(lLength > lAvailable) lLength = lAvailable;
		if(lLength > 0)
		{
			memcpy(pWindow->acSearch + pWindow->sSearchLength, pEvent->text.text, lLength);
			pWindow->sSearchLength += lLength;
			pWindow->acSearch[pWindow->sSearchLength] = '\0';
			pWindow->lScroll = 0;
		}
		return 1;
	}
	if(pEvent->type == SDL_KEYDOWN && pEvent->key.keysym.sym == SDLK_BACKSPACE)
	{
		if(pWindow->bPathInput)
		{
			if(pWindow->sPathLength > 0) pWindow->acPath[--pWindow->sPathLength] = '\0';
			return 1;
		}
		if(pWindow->bAtrView)
		{
			A8E_LibraryWindow_CloseAtr(pWindow);
			return 1;
		}
		if(pWindow->sSearchLength > 0) pWindow->acSearch[--pWindow->sSearchLength] = '\0';
		pWindow->lScroll = 0;
		return 1;
	}
	if(pEvent->type == SDL_KEYDOWN && pWindow->bPathInput &&
		pEvent->key.keysym.sym == SDLK_RETURN)
	{
		A8E_LibraryWindow_PerformPathOperation(pWindow);
		pWindow->bPathInput = 0;
		pWindow->bIgnorePathActivation = 0;
		pWindow->sPathLength = 0;
		pWindow->acPath[0] = '\0';
		return 1;
	}
	if(pEvent->type == SDL_KEYDOWN && pEvent->key.repeat == 0 &&
		!pWindow->bPathInput && pWindow->bAtrView)
	{
		if(pEvent->key.keysym.sym == SDLK_RETURN)
		{
			if(!A8E_LibraryWindow_BuildAtrPreview(
				pWindow, pWindow->sAtrSelectedRow + pWindow->sAtrScroll))
				strncpy(pWindow->acStatus, "PREVIEW FAILED", sizeof(pWindow->acStatus) - 1u);
			return 1;
		}
		if(pEvent->key.keysym.sym == SDLK_d)
		{
			pWindow->bPathInput = 1;
			pWindow->bIgnorePathActivation = 1;
			pWindow->cPathOperation = 'D';
			pWindow->sPathLength = 0;
			pWindow->acPath[0] = '\0';
			return 1;
		}
	}
	if(pEvent->type == SDL_KEYDOWN && pEvent->key.repeat == 0 && !pWindow->bPathInput &&
		(pEvent->key.keysym.sym == SDLK_i || pEvent->key.keysym.sym == SDLK_e ||
			pEvent->key.keysym.sym == SDLK_n))
	{
		pWindow->bPathInput = 1;
		pWindow->bIgnorePathActivation = 1;
		pWindow->cPathOperation = pEvent->key.keysym.sym == SDLK_e ? 'E' :
			pEvent->key.keysym.sym == SDLK_n ? 'N' : 'I';
		pWindow->sPathLength = 0;
		pWindow->acPath[0] = '\0';
		return 1;
	}
	if(pEvent->type == SDL_KEYDOWN && pEvent->key.keysym.sym == SDLK_DELETE)
	{
		if(pWindow->bAtrView) return 1;
		const A8E_LibraryRepositoryRecord_t *pRecord = A8E_LibraryWindow_VisibleRecord(
			pWindow, pWindow->sSelectedRow + pWindow->lScroll);
		char sName[257];
		uint32_t lMountedDrive;
		if(!pRecord) return 1;
		strncpy(sName, pRecord->pName, sizeof(sName) - 1u);
		sName[sizeof(sName) - 1u] = '\0';
		for(lMountedDrive = 0; lMountedDrive < 8u; lMountedDrive++)
			if(strcmp(pWindow->acMountedIds[lMountedDrive], pRecord->pId) == 0)
			{
				snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
					"UNMOUNT %s BEFORE DELETE", pRecord->pName);
				return 1;
			}
		if(A8E_LibraryRepository_RemoveEntry(
			pWindow->pRepository, "library", pRecord->pId, NULL, 0))
			snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
				"DELETED %s", sName);
		else snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
			"DELETE FAILED %s", sName);
		return 1;
	}
	if(pEvent->type == SDL_MOUSEWHEEL)
	{
		if(pWindow->bAtrView)
		{
			A8E_LibraryAtrInfo Info;
			uint32_t lCount = A8E_LibraryWindow_AtrEntryCount(pWindow, &Info);
			uint32_t lMaximum = lCount > A8E_LIBRARY_ATR_MAX_VISIBLE_ROWS
				? lCount - A8E_LIBRARY_ATR_MAX_VISIBLE_ROWS : 0u;
			if(pEvent->wheel.y < 0 && pWindow->sAtrScroll < lMaximum) pWindow->sAtrScroll++;
			if(pEvent->wheel.y > 0 && pWindow->sAtrScroll > 0) pWindow->sAtrScroll--;
			return 1;
		}
		uint32_t lCount = A8E_LibraryWindow_VisibleCount(pWindow);
		uint32_t lMaximum = lCount > A8E_LIBRARY_MAX_VISIBLE_ROWS
			? lCount - A8E_LIBRARY_MAX_VISIBLE_ROWS : 0u;
		if(pEvent->wheel.y < 0 && pWindow->lScroll < lMaximum) pWindow->lScroll++;
		if(pEvent->wheel.y > 0 && pWindow->lScroll > 0) pWindow->lScroll--;
		return 1;
	}
	if(pEvent->type != SDL_MOUSEBUTTONDOWN ||
		(pEvent->button.button != SDL_BUTTON_LEFT && pEvent->button.button != SDL_BUTTON_RIGHT)) return 1;
	if(pWindow->bAtrView)
	{
		A8E_LibraryAtrInfo Info;
		uint32_t lCount = A8E_LibraryWindow_AtrEntryCount(pWindow, &Info);
		lRow = (pEvent->button.y - A8E_LIBRARY_ATR_LIST_TOP) /
			A8E_LIBRARY_ATR_ROW_HEIGHT;
		if(lRow >= 0 && lRow < A8E_LIBRARY_ATR_MAX_VISIBLE_ROWS &&
			(uint32_t)(lRow + (int)pWindow->sAtrScroll) < lCount)
		{
			pWindow->sAtrSelectedRow = (uint16_t)lRow;
			pWindow->bAtrPreview = 0;
			pWindow->acAtrPreview[0] = '\0';
			if(pEvent->button.button == SDL_BUTTON_RIGHT)
				A8E_LibraryWindow_BuildAtrPreview(
					pWindow, pWindow->sAtrSelectedRow + pWindow->sAtrScroll);
		}
		return 1;
	}
	lRow = (pEvent->button.y - A8E_LIBRARY_LIST_TOP) / A8E_LIBRARY_ROW_HEIGHT;
	if(pEvent->button.button == SDL_BUTTON_LEFT &&
		pEvent->button.x >= A8E_LIBRARY_NAME_X &&
		pEvent->button.x < A8E_LIBRARY_DRIVE_X)
	{
		const A8E_LibraryRepositoryRecord_t *pRecord;
		int lVisibleRow = lRow + (int)pWindow->lScroll;
		if(lRow < 0 || lRow >= A8E_LIBRARY_MAX_VISIBLE_ROWS ||
			lVisibleRow < 0 || (uint32_t)lVisibleRow >= A8E_LibraryWindow_VisibleCount(pWindow)) return 1;
		pRecord = A8E_LibraryWindow_VisibleRecord(pWindow, (uint32_t)lVisibleRow);
		if(pRecord && A8E_LibraryWindow_OpenAtr(pWindow, pRecord))
			pWindow->sSelectedRow = (uint16_t)lRow;
		return 1;
	}
	if(pEvent->button.x < A8E_LIBRARY_DRIVE_X) return 1;
	lDrive = (pEvent->button.x - A8E_LIBRARY_DRIVE_X) / A8E_LIBRARY_DRIVE_WIDTH;
	if(lRow < 0 || lRow >= A8E_LIBRARY_MAX_VISIBLE_ROWS || lDrive < 0 || lDrive >= 8) return 1;
	{
		int lVisibleRow = lRow + (int)pWindow->lScroll;
		const A8E_LibraryRepositoryRecord_t *pRecord;
		if(lVisibleRow < 0 || (uint32_t)lVisibleRow >= A8E_LibraryWindow_VisibleCount(pWindow)) return 1;
		pRecord = A8E_LibraryWindow_VisibleRecord(pWindow, (uint32_t)lVisibleRow);
		if(!pRecord) return 1;
		pWindow->sSelectedRow = (uint16_t)lRow;
		if(pEvent->button.button == SDL_BUTTON_RIGHT &&
			strcmp(pWindow->acMountedIds[lDrive], pRecord->pId) == 0)
		{
			AtariIoSetDiskWritable(pWindow->pContext, (uint32_t)lDrive,
				(uint8_t)!AtariIoIsDiskWritable(pWindow->pContext, (uint32_t)lDrive));
			if(!A8E_LibraryWindow_SaveWorkspace(pWindow))
				snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
					"RW CHANGED BUT WORKSPACE SAVE FAILED");
		}
		else if(pEvent->button.button == SDL_BUTTON_LEFT)
			A8E_LibraryWindow_Mount(pWindow, pRecord, (uint32_t)lDrive);
	}
	return 1;
}

static void A8E_LibraryWindow_DrawAtr(
	A8E_LibraryWindow_t *pWindow)
{
	SDL_Color tWhite = { 232, 232, 232, 255 };
	SDL_Color tMuted = { 150, 160, 170, 255 };
	SDL_Color tSelected = { 94, 180, 230, 255 };
	const A8E_LibraryRepositoryRecord_t *pRecord =
		A8E_LibraryWindow_CurrentAtr(pWindow);
	const uint8_t *pBytes = NULL;
	A8E_LibraryAtrInfo Info;
	uint32_t lSize = 0;
	uint32_t lCount = 0;
	uint16_t sRow;

	if(pRecord) pBytes = A8E_LibraryRepository_GetPayload(
		pWindow->pRepository, pRecord->pPath, &lSize);
	if(!pBytes || !A8E_LibraryImage_InspectAtr(pBytes, lSize, &Info))
	{
		A8E_LibraryWindow_Text(pWindow->pRenderer, 14, 12, "ATR INVALID", tWhite);
		A8E_LibraryWindow_Text(pWindow->pRenderer, 14, 34,
			pRecord ? pRecord->pName : "UNKNOWN", tMuted);
		return;
	}
	A8E_LibraryWindow_Text(pWindow->pRenderer, 14, 12, "ATR CONTENTS", tWhite);
	A8E_LibraryWindow_Text(pWindow->pRenderer, 14, 34,
		pRecord->pName, tWhite);
	if(pWindow->bPathInput)
	{
		A8E_LibraryWindow_Text(pWindow->pRenderer, 300, 34,
			"DOWNLOAD PATH", tMuted);
		A8E_LibraryWindow_Text(pWindow->pRenderer, 438, 34,
			pWindow->sPathLength ? pWindow->acPath : "TYPE PATH ENTER ESC", tWhite);
	}
	else if(pWindow->bAtrPreview)
	{
		A8E_LibraryWindow_Text(pWindow->pRenderer, 300, 34,
			"ESC LIST D DOWNLOAD", tMuted);
		A8E_LibraryWindow_Text(pWindow->pRenderer, 14, 58,
			"FILE PREVIEW", tMuted);
		{
			const char *pLine = pWindow->acAtrPreview;
			uint16_t sLine;
			for(sLine = 0; sLine < 20u && pLine && *pLine; sLine++)
			{
				char acLine[180];
				const char *pEnd = strchr(pLine, '\n');
				size_t lLength = pEnd ? (size_t)(pEnd - pLine) : strlen(pLine);
				if(lLength >= sizeof(acLine)) lLength = sizeof(acLine) - 1u;
				memcpy(acLine, pLine, lLength);
				acLine[lLength] = '\0';
				A8E_LibraryWindow_Text(pWindow->pRenderer, 14,
					82 + (int)sLine * 20, acLine, tWhite);
				pLine = pEnd ? pEnd + 1 : NULL;
			}
		}
	}
	else
	{
		const char *pFilesystem = Info.filesystem ==
			A8E_LIBRARY_IMAGE_FILESYSTEM_DOS2_MYDOS ? "DOS2 MYDOS" : "UNKNOWN";
		char acInfo[180];
		snprintf(acInfo, sizeof(acInfo), "%s %u BYTE %u SECT FREE %u",
			pFilesystem, Info.sectorSize, Info.totalSectors, Info.freeSectors);
		A8E_LibraryWindow_Text(pWindow->pRenderer, 14, 58, acInfo, tMuted);
		if(Info.filesystem != A8E_LIBRARY_IMAGE_FILESYSTEM_DOS2_MYDOS)
		{
			uint32_t lLimit = lSize < 512u ? lSize : 512u;
			A8E_LibraryWindow_Text(pWindow->pRenderer, 14, 82,
				"UNRECOGNIZED FILESYSTEM RAW HEX", tMuted);
			for(sRow = 0; sRow < 20u && (uint32_t)sRow * 16u < lLimit; sRow++)
			{
				char acLine[96];
				uint32_t lOffset = (uint32_t)sRow * 16u;
				uint32_t j;
				int lWritten = snprintf(acLine, sizeof(acLine), "%06X  ", lOffset);
				for(j = 0; j < 16u && lOffset + j < lLimit; j++)
					lWritten += snprintf(acLine + lWritten,
						sizeof(acLine) - (size_t)lWritten, "%02X ", pBytes[lOffset + j]);
				A8E_LibraryWindow_Text(pWindow->pRenderer, 14,
					104 + (int)sRow * 20, acLine, tWhite);
			}
		}
		else
		{
		A8E_LibraryWindow_Text(pWindow->pRenderer, 14, 82, "NAME", tMuted);
		A8E_LibraryWindow_Text(pWindow->pRenderer, A8E_LIBRARY_ATR_SECT_X, 82,
			"SECT", tMuted);
		A8E_LibraryWindow_Text(pWindow->pRenderer, A8E_LIBRARY_ATR_START_X, 82,
			"START", tMuted);
		A8E_LibraryWindow_Text(pWindow->pRenderer, A8E_LIBRARY_ATR_STATE_X, 82,
			"STATE", tMuted);
		A8E_LibraryWindow_Text(pWindow->pRenderer, A8E_LIBRARY_ATR_ACTION_X, 82,
			"ENTER PREVIEW D DOWNLOAD", tMuted);
		lCount = A8E_LibraryWindow_AtrEntryCount(pWindow, &Info);
		for(sRow = 0; sRow < A8E_LIBRARY_ATR_MAX_VISIBLE_ROWS; sRow++)
		{
			A8E_LibraryAtrDirectoryEntry Entry;
			int lY = A8E_LIBRARY_ATR_LIST_TOP + (int)sRow * A8E_LIBRARY_ATR_ROW_HEIGHT;
			if(!A8E_LibraryWindow_GetAtrEntry(
				pWindow, sRow + pWindow->sAtrScroll, &Entry, &Info)) break;
			if(sRow == pWindow->sAtrSelectedRow)
			{
				SDL_Rect tRow = { 8, lY - 2, A8E_LIBRARY_WINDOW_WIDTH - 16,
					A8E_LIBRARY_ATR_ROW_HEIGHT };
				SDL_SetRenderDrawColor(pWindow->pRenderer, 30, 45, 58, 255);
				SDL_RenderFillRect(pWindow->pRenderer, &tRow);
			}
			A8E_LibraryWindow_Text(pWindow->pRenderer, 14, lY, Entry.name,
				sRow == pWindow->sAtrSelectedRow ? tSelected : tWhite);
			{
				char acValue[32];
				snprintf(acValue, sizeof(acValue), "%u", Entry.sectors);
				A8E_LibraryWindow_Text(pWindow->pRenderer,
					A8E_LIBRARY_ATR_SECT_X, lY, acValue, tMuted);
				snprintf(acValue, sizeof(acValue), "%u", Entry.startSector);
				A8E_LibraryWindow_Text(pWindow->pRenderer,
					A8E_LIBRARY_ATR_START_X, lY, acValue, tMuted);
				A8E_LibraryWindow_Text(pWindow->pRenderer,
					A8E_LIBRARY_ATR_STATE_X, lY,
					Entry.locked ? "LOCKED" : Entry.open ? "OPEN" : "READY", tMuted);
			}
		}
		if(!lCount) A8E_LibraryWindow_Text(pWindow->pRenderer, 14,
			A8E_LIBRARY_ATR_LIST_TOP, "NO FILES IN DIRECTORY", tMuted);
		}
	}
	if(pWindow->acStatus[0]) A8E_LibraryWindow_Text(
		pWindow->pRenderer, 14, A8E_LIBRARY_WINDOW_HEIGHT - 24,
		pWindow->acStatus, tMuted);
}

void A8E_LibraryWindow_SaveDirty(A8E_LibraryWindow_t *pWindow)
{
	uint32_t lDrive;
	if(!pWindow) return;
	for(lDrive = 0; lDrive < 8u; lDrive++)
		if(!A8E_LibraryWindow_SaveDirtyDrive(pWindow, lDrive))
			fprintf(stderr, "A8E: failed to save dirty library drive D%u:\n", lDrive + 1u);
}

void A8E_LibraryWindow_Draw(A8E_LibraryWindow_t *pWindow)
{
	SDL_Color tWhite = { 232, 232, 232, 255 };
	SDL_Color tMuted = { 150, 160, 170, 255 };
	uint16_t sRow;
	if(!pWindow || !pWindow->bVisible || !pWindow->pRenderer) return;
	SDL_SetRenderDrawColor(pWindow->pRenderer, 22, 26, 32, 255);
	SDL_RenderClear(pWindow->pRenderer);
	if(pWindow->bAtrView)
	{
		A8E_LibraryWindow_DrawAtr(pWindow);
		SDL_RenderPresent(pWindow->pRenderer);
		return;
	}
	A8E_LibraryWindow_Text(pWindow->pRenderer, 14, 12, "DISK LIBRARY", tWhite);
	if(pWindow->bPathInput)
	{
		A8E_LibraryWindow_Text(pWindow->pRenderer, 14, 34,
			pWindow->cPathOperation == 'E' ? "EXPORT PATH" :
			pWindow->cPathOperation == 'N' ? "NEW ATR NAME" : "IMPORT PATH", tMuted);
		A8E_LibraryWindow_Text(pWindow->pRenderer, 130, 34,
			pWindow->sPathLength ? pWindow->acPath : "TYPE PATH ENTER ESC", tWhite);
	}
	else
	{
		A8E_LibraryWindow_Text(pWindow->pRenderer, 14, 34, "SEARCH", tMuted);
		A8E_LibraryWindow_Text(pWindow->pRenderer, 100, 34,
			pWindow->sSearchLength ? pWindow->acSearch : "TYPE TO FILTER", tWhite);
	}
	A8E_LibraryWindow_Text(pWindow->pRenderer, 500, 34,
		"I/E PACKAGE N ATR", tMuted);
	A8E_LibraryWindow_Text(pWindow->pRenderer, A8E_LIBRARY_NAME_X, 54, "NAME", tMuted);
	A8E_LibraryWindow_Text(pWindow->pRenderer, A8E_LIBRARY_TYPE_X, 54, "TYPE", tMuted);
	for(sRow = 0; sRow < 8u; sRow++)
	{
		char sDrive[4];
		snprintf(sDrive, sizeof(sDrive), "D%u", sRow + 1u);
		A8E_LibraryWindow_Text(pWindow->pRenderer,
			A8E_LIBRARY_DRIVE_X + (int)sRow * A8E_LIBRARY_DRIVE_WIDTH, 54, sDrive, tMuted);
	}
	for(sRow = 0; sRow < A8E_LIBRARY_MAX_VISIBLE_ROWS; sRow++)
	{
		const A8E_LibraryRepositoryRecord_t *pRecord = A8E_LibraryWindow_VisibleRecord(
			pWindow, sRow + pWindow->lScroll);
		char acDisplayName[64];
		int lY;
		uint32_t lDrive;
		if(!pRecord) break;
		lY = A8E_LIBRARY_LIST_TOP + (int)sRow * A8E_LIBRARY_ROW_HEIGHT;
		if(sRow & 1u)
		{
			SDL_Rect tRow = { 8, lY - 2, A8E_LIBRARY_WINDOW_WIDTH - 16, A8E_LIBRARY_ROW_HEIGHT };
			SDL_SetRenderDrawColor(pWindow->pRenderer, 30, 35, 42, 255);
			SDL_RenderFillRect(pWindow->pRenderer, &tRow);
		}
		A8E_LibraryWindow_CopyColumnText(acDisplayName, sizeof(acDisplayName),
			pRecord->pName, A8E_LIBRARY_NAME_MAX_CHARS);
		A8E_LibraryWindow_Text(pWindow->pRenderer, A8E_LIBRARY_NAME_X, lY,
			acDisplayName, tWhite);
		A8E_LibraryWindow_Text(pWindow->pRenderer, A8E_LIBRARY_TYPE_X, lY, pRecord->pType, tMuted);
		for(lDrive = 0; lDrive < 8u; lDrive++)
		{
			SDL_Rect tCell = { A8E_LIBRARY_DRIVE_X + (int)lDrive * A8E_LIBRARY_DRIVE_WIDTH - 3,
				lY - 3, A8E_LIBRARY_DRIVE_WIDTH - 6, A8E_LIBRARY_ROW_HEIGHT - 2 };
			int bMounted = strcmp(pWindow->acMountedIds[lDrive], pRecord->pId) == 0;
			u8 cActivity = bMounted
				? AtariIoGetDiskActivity(pWindow->pContext, lDrive)
				: ATARI_IO_DISK_ACTIVITY_NONE;
			SDL_SetRenderDrawColor(pWindow->pRenderer,
				bMounted ? (AtariIoIsDiskWritable(pWindow->pContext, lDrive) ? 42 : 120) : 48,
				bMounted ? (AtariIoIsDiskWritable(pWindow->pContext, lDrive) ? 94 : 48) : 54,
				bMounted ? 62 : 64, 255);
			SDL_RenderDrawRect(pWindow->pRenderer, &tCell);
			if(bMounted)
			{
				SDL_Color tActivity = cActivity == ATARI_IO_DISK_ACTIVITY_WRITE
					? (SDL_Color){ 242, 211, 94, 255 }
					: cActivity == ATARI_IO_DISK_ACTIVITY_READ
					? (SDL_Color){ 94, 229, 138, 255 }
					: tWhite;
				A8E_LibraryWindow_Text(pWindow->pRenderer,
					tCell.x + 5, lY, "*", tActivity);
			}
		}
	}
	if(pWindow->pRepository->sRecordCount == 0)
		A8E_LibraryWindow_Text(pWindow->pRenderer, A8E_LIBRARY_NAME_X,
			A8E_LIBRARY_LIST_TOP, "EMPTY", tMuted);
	if(pWindow->acStatus[0]) A8E_LibraryWindow_Text(
		pWindow->pRenderer, 14, A8E_LIBRARY_WINDOW_HEIGHT - 24, pWindow->acStatus, tMuted);
	SDL_RenderPresent(pWindow->pRenderer);
}
