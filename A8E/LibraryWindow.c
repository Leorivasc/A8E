#include "LibraryWindow.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#ifdef _WIN32
#include <sys/stat.h>
#include <windows.h>
#else
#include <dirent.h>
#include <sys/stat.h>
#include <sys/statvfs.h>
#endif

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

static int A8E_LibraryWindow_IsDirectory(const char *pPath)
{
#ifdef _WIN32
	struct _stat tInfo;
	return pPath && _stat(pPath, &tInfo) == 0 && (tInfo.st_mode & _S_IFDIR) != 0;
#else
	struct stat tInfo;
	return pPath && lstat(pPath, &tInfo) == 0 && S_ISDIR(tInfo.st_mode);
#endif
}

static int A8E_LibraryWindow_EqualName(const char *pLeft, const char *pRight)
{
	if(!pLeft || !pRight) return 0;
	while(*pLeft && *pRight)
	{
		if(tolower((unsigned char)*pLeft++) != tolower((unsigned char)*pRight++)) return 0;
	}
	return *pLeft == '\0' && *pRight == '\0';
}

static const A8E_LibraryRepositoryFolder_t *A8E_LibraryWindow_FindChildFolder(
	const A8E_LibraryRepository_t *pRepository,
	const char *pParentId,
	const char *pName)
{
	uint16_t i;
	const char *pParent = pParentId && pParentId[0] ? pParentId : "root";
	if(!pRepository || !pName) return NULL;
	for(i = 0; i < pRepository->sFolderCount; i++)
	{
		const A8E_LibraryRepositoryFolder_t *pFolder = &pRepository->pFolders[i];
		if(A8E_LibraryWindow_EqualName(
			pFolder->pParentId ? pFolder->pParentId : "root", pParent) &&
			A8E_LibraryWindow_EqualName(pFolder->pName, pName)) return pFolder;
	}
	return NULL;
}

static const char *A8E_LibraryWindow_FileExtension(const char *pPath)
{
	const char *pName = pPath;
	const char *pDot = NULL;
	if(!pPath) return "";
	for(; *pPath; pPath++)
		if(*pPath == '/' || *pPath == '\\') pName = pPath + 1;
	for(; *pName; pName++)
		if(*pName == '.') pDot = pName + 1;
	return pDot ? pDot : "";
}

static int A8E_LibraryWindow_JoinDropPath(
	char *pOutput,
	uint32_t lOutputSize,
	const char *pDirectory,
	const char *pName)
{
	int lLength;
	if(!pOutput || !pDirectory || !pName) return 0;
	lLength = snprintf(pOutput, lOutputSize, "%s%c%s", pDirectory,
#ifdef _WIN32
		'\\',
#else
		'/',
#endif
		pName);
	return lLength > 0 && (uint32_t)lLength < lOutputSize;
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

static void A8E_LibraryWindow_ShowStorage(A8E_LibraryWindow_t *pWindow)
{
	uint64_t lCapacity = 0;
	uint64_t lAvailable = 0;
	uint64_t lUsed;
#ifdef _WIN32
	ULARGE_INTEGER tAvailable;
	ULARGE_INTEGER tTotal;
	if(!GetDiskFreeSpaceExA("library", &tAvailable, &tTotal, NULL))
	{
		strncpy(pWindow->acStatus, "STORAGE UNAVAILABLE", sizeof(pWindow->acStatus) - 1u);
		return;
	}
	lCapacity = (uint64_t)tTotal.QuadPart;
	lAvailable = (uint64_t)tFree.QuadPart;
#else
	struct statvfs tStats;
	if(statvfs("library", &tStats) != 0)
	{
		strncpy(pWindow->acStatus, "STORAGE UNAVAILABLE", sizeof(pWindow->acStatus) - 1u);
		return;
	}
	lCapacity = (uint64_t)tStats.f_blocks * (uint64_t)tStats.f_frsize;
	lAvailable = (uint64_t)tStats.f_bavail * (uint64_t)tStats.f_frsize;
#endif
	lUsed = lCapacity > lAvailable ? lCapacity - lAvailable : 0;
	snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
		"STORAGE %llu USED / %llu FREE MB",
		(unsigned long long)(lUsed / (1024u * 1024u)),
		(unsigned long long)(lAvailable / (1024u * 1024u)));
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

static int A8E_LibraryWindow_MatchesFilters(
	const A8E_LibraryWindow_t *pWindow,
	const A8E_LibraryRepositoryRecord_t *pRecord)
{
	uint32_t lDrive;
	int bMounted = 0;
	if(!pWindow || !pRecord || !A8E_LibraryWindow_MatchesSearch(pWindow, pRecord)) return 0;
	if(pWindow->nTypeFilter == 1u && strcmp(pRecord->pType, "atr") != 0) return 0;
	if(pWindow->nTypeFilter == 2u && strcmp(pRecord->pType, "xex") != 0) return 0;
	for(lDrive = 0; lDrive < 8u; lDrive++)
		if(strcmp(pWindow->acMountedIds[lDrive], pRecord->pId) == 0) bMounted = 1;
	if(pWindow->nMountFilter == 1u && !bMounted) return 0;
	if(pWindow->nMountFilter == 2u && bMounted) return 0;
	return 1;
}

static int A8E_LibraryWindow_CompareText(const char *pLeft, const char *pRight)
{
	while(*pLeft && *pRight)
	{
		int lLeft = toupper((unsigned char)*pLeft++);
		int lRight = toupper((unsigned char)*pRight++);
		if(lLeft != lRight) return lLeft < lRight ? -1 : 1;
	}
	return *pLeft ? 1 : *pRight ? -1 : 0;
}

static int A8E_LibraryWindow_CompareRecords(
	const A8E_LibraryWindow_t *pWindow,
	const A8E_LibraryRepositoryRecord_t *pLeft,
	const A8E_LibraryRepositoryRecord_t *pRight)
{
	int lResult;
	if(pWindow->nSortMode == 1u)
		lResult = A8E_LibraryWindow_CompareText(pLeft->pType, pRight->pType);
	else if(pWindow->nSortMode == 2u)
		lResult = pLeft->lSize < pRight->lSize ? -1 : pLeft->lSize > pRight->lSize ? 1 : 0;
	else if(pWindow->nSortMode == 3u)
		lResult = A8E_LibraryWindow_CompareText(
			pRight->pModifiedAt ? pRight->pModifiedAt : "",
			pLeft->pModifiedAt ? pLeft->pModifiedAt : "");
	else
		lResult = A8E_LibraryWindow_CompareText(pLeft->pName, pRight->pName);
	if(!lResult) lResult = A8E_LibraryWindow_CompareText(pLeft->pName, pRight->pName);
	return lResult;
}

static const A8E_LibraryRepositoryFolder_t *A8E_LibraryWindow_CurrentFolder(
	const A8E_LibraryWindow_t *pWindow)
{
	uint16_t i;
	if(!pWindow || strcmp(pWindow->acFolderId, "root") == 0) return NULL;
	for(i = 0; i < pWindow->pRepository->sFolderCount; i++)
		if(strcmp(pWindow->pRepository->pFolders[i].pId, pWindow->acFolderId) == 0)
			return &pWindow->pRepository->pFolders[i];
	return NULL;
}

static uint32_t A8E_LibraryWindow_FolderRowCount(
	const A8E_LibraryWindow_t *pWindow)
{
	uint32_t lCount = 0;
	uint16_t i;
	if(pWindow->bTrashView) return 0;
	const A8E_LibraryRepositoryFolder_t *pCurrent =
		A8E_LibraryWindow_CurrentFolder(pWindow);
	if(pWindow->sSearchLength > 0) return 0;
	if(pCurrent && pCurrent->pParentId) lCount++;
	for(i = 0; i < pWindow->pRepository->sFolderCount; i++)
	{
		const A8E_LibraryRepositoryFolder_t *pFolder =
			&pWindow->pRepository->pFolders[i];
		if(strcmp(pFolder->pId, "root") != 0 &&
			strcmp(pFolder->pParentId ? pFolder->pParentId : "root", pWindow->acFolderId) == 0)
			lCount++;
	}
	return lCount;
}

static const A8E_LibraryRepositoryFolder_t *A8E_LibraryWindow_VisibleFolder(
	const A8E_LibraryWindow_t *pWindow,
	uint32_t lVisibleIndex,
	int *pParentRow)
{
	uint32_t lOffset = 0;
	uint16_t i;
	const A8E_LibraryRepositoryFolder_t *pCurrent =
		A8E_LibraryWindow_CurrentFolder(pWindow);
	if(pParentRow) *pParentRow = 0;
	if(pWindow->bTrashView) return NULL;
	if(pWindow->sSearchLength > 0) return NULL;
	if(pCurrent && pCurrent->pParentId)
	{
		if(lVisibleIndex == 0u)
		{
			if(pParentRow) *pParentRow = 1;
			return NULL;
		}
		lOffset = 1u;
	}
	if(lVisibleIndex < lOffset) return NULL;
	lVisibleIndex -= lOffset;
	for(i = 0; i < pWindow->pRepository->sFolderCount; i++)
	{
		const A8E_LibraryRepositoryFolder_t *pFolder =
			&pWindow->pRepository->pFolders[i];
		if(strcmp(pFolder->pId, "root") == 0 ||
			strcmp(pFolder->pParentId ? pFolder->pParentId : "root", pWindow->acFolderId) != 0)
			continue;
		if(lVisibleIndex-- == 0u) return pFolder;
	}
	return NULL;
}

static const A8E_LibraryRepositoryRecord_t *A8E_LibraryWindow_VisibleRecord(
	const A8E_LibraryWindow_t *pWindow, uint32_t lVisibleIndex)
{
	uint16_t sIndex;
	uint16_t sCount = 0;
	uint16_t *pIndices;
	if(pWindow->bTrashView)
		return A8E_LibraryRepository_GetTrashRecord(
			pWindow->pRepository, (uint16_t)lVisibleIndex);
	uint32_t lFolderRows = A8E_LibraryWindow_FolderRowCount(pWindow);
	if(lVisibleIndex < lFolderRows) return NULL;
	lVisibleIndex -= lFolderRows;
	pIndices = (uint16_t *)calloc(pWindow->pRepository->sRecordCount, sizeof(*pIndices));
	if(!pIndices) return NULL;
	for(sIndex = 0; sIndex < pWindow->pRepository->sRecordCount; sIndex++)
	{
		const A8E_LibraryRepositoryRecord_t *pRecord =
			A8E_LibraryRepository_GetRecord(pWindow->pRepository, sIndex);
		if(!A8E_LibraryWindow_MatchesFilters(pWindow, pRecord)) continue;
		if(pWindow->sSearchLength == 0 && strcmp(
			pRecord->pFolderId ? pRecord->pFolderId : "root", pWindow->acFolderId) != 0) continue;
		pIndices[sCount++] = sIndex;
	}
	for(sIndex = 1; sIndex < sCount; sIndex++)
	{
		uint16_t sPosition = sIndex;
		while(sPosition > 0u && A8E_LibraryWindow_CompareRecords(
			pWindow,
			A8E_LibraryRepository_GetRecord(pWindow->pRepository, pIndices[sPosition]),
			A8E_LibraryRepository_GetRecord(pWindow->pRepository, pIndices[sPosition - 1u])) < 0)
		{
			uint16_t sSwap = pIndices[sPosition];
			pIndices[sPosition] = pIndices[sPosition - 1u];
			pIndices[sPosition - 1u] = sSwap;
			sPosition--;
		}
	}
	if(lVisibleIndex < sCount)
	{
		const A8E_LibraryRepositoryRecord_t *pResult =
			A8E_LibraryRepository_GetRecord(pWindow->pRepository, pIndices[lVisibleIndex]);
		free(pIndices);
		return pResult;
	}
	free(pIndices);
	return NULL;
}

static uint32_t A8E_LibraryWindow_VisibleCount(const A8E_LibraryWindow_t *pWindow)
{
	uint16_t sIndex;
	if(pWindow->bTrashView) return pWindow->pRepository->sTrashCount;
	uint32_t lCount = A8E_LibraryWindow_FolderRowCount(pWindow);
	for(sIndex = 0; sIndex < pWindow->pRepository->sRecordCount; sIndex++)
		if(A8E_LibraryWindow_MatchesFilters(
			pWindow, A8E_LibraryRepository_GetRecord(pWindow->pRepository, sIndex)) &&
			(pWindow->sSearchLength > 0 || strcmp(
				A8E_LibraryRepository_GetRecord(pWindow->pRepository, sIndex)->pFolderId
				? A8E_LibraryRepository_GetRecord(pWindow->pRepository, sIndex)->pFolderId
				: "root", pWindow->acFolderId) == 0)) lCount++;
	return lCount;
}

static int A8E_LibraryWindow_SaveDirtyDrive(
	A8E_LibraryWindow_t *pWindow, uint32_t lDrive)
{
	const uint8_t *pBytes;
	u32 lSize;
	if(lDrive >= 8u || pWindow->acMountedIds[lDrive][0] == '\0' ||
		!AtariIoIsDiskDirty(pWindow->pContext, lDrive)) return 1;
	pBytes = AtariIoGetDiskBytes(pWindow->pContext, lDrive, &lSize);
	if(!pBytes) return 0;
	if(!A8E_LibraryRepository_SaveWorkingCopy(
		pWindow->pRepository, "library", pWindow->acMountedIds[lDrive],
		pBytes, (uint32_t)lSize, NULL, 0)) return 0;
	AtariIoClearDiskDirty(pWindow->pContext, lDrive);
	return 1;
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

static void A8E_LibraryWindow_SetFolder(
	A8E_LibraryWindow_t *pWindow,
	const char *pFolderId)
{
	if(!pWindow) return;
	strncpy(pWindow->acFolderId,
		pFolderId && pFolderId[0] ? pFolderId : "root",
		sizeof(pWindow->acFolderId) - 1u);
	pWindow->acFolderId[sizeof(pWindow->acFolderId) - 1u] = '\0';
	pWindow->lScroll = 0;
	pWindow->sSelectedRow = 0;
}

static int A8E_LibraryWindow_ImportDropPath(
	A8E_LibraryWindow_t *pWindow,
	const char *pPath,
	const char *pFolderId,
	uint32_t lDepth,
	uint32_t *pImported,
	uint32_t *pSkipped)
{
	char sError[160];
	if(!pWindow || !pPath || !pFolderId || lDepth > 32u) return 0;
	if(!A8E_LibraryWindow_IsDirectory(pPath))
	{
		const char *pExtension = A8E_LibraryWindow_FileExtension(pPath);
		if(tolower((unsigned char)pExtension[0]) != 'a' &&
			tolower((unsigned char)pExtension[0]) != 'x')
		{
			if(pSkipped) (*pSkipped)++;
			return 0;
		}
		if(!A8E_LibraryRepository_ImportImageFile(
			pWindow->pRepository, "library", pFolderId, pPath,
			sError, sizeof(sError)))
		{
			if(pSkipped) (*pSkipped)++;
			return 0;
		}
		if(pImported) (*pImported)++;
		return 1;
	}
	{
		char sDirectory[1024];
		char sFolderName[257];
		char sChildFolderId[257];
		const char *pLeaf;
		const A8E_LibraryRepositoryFolder_t *pChild;
		if(!pWindow->pRepository->pManifest &&
			!A8E_LibraryRepository_EnsureDirectory(
				pWindow->pRepository, "library", sError, sizeof(sError)))
		{
			if(pSkipped) (*pSkipped)++;
			return 0;
		}
		strncpy(sDirectory, pPath, sizeof(sDirectory) - 1u);
		sDirectory[sizeof(sDirectory) - 1u] = '\0';
		while(strlen(sDirectory) > 1u &&
			(sDirectory[strlen(sDirectory) - 1u] == '/' ||
			 sDirectory[strlen(sDirectory) - 1u] == '\\'))
			sDirectory[strlen(sDirectory) - 1u] = '\0';
		pLeaf = strrchr(sDirectory, '/');
		{
			const char *pBackslash = strrchr(sDirectory, '\\');
			if(!pLeaf || (pBackslash && pBackslash > pLeaf)) pLeaf = pBackslash;
		}
		pLeaf = pLeaf ? pLeaf + 1 : sDirectory;
		if(strlen(pLeaf) == 0u || strlen(pLeaf) >= sizeof(sFolderName))
		{
			if(pSkipped) (*pSkipped)++;
			return 0;
		}
		strcpy(sFolderName, pLeaf);
		pChild = A8E_LibraryWindow_FindChildFolder(
			pWindow->pRepository, pFolderId, sFolderName);
		if(!pChild)
		{
			if(!A8E_LibraryRepository_CreateFolder(
				pWindow->pRepository, "library", pFolderId, sFolderName,
				sError, sizeof(sError)) ||
				!(pChild = A8E_LibraryWindow_FindChildFolder(
					pWindow->pRepository, pFolderId, sFolderName)))
			{
				if(pSkipped) (*pSkipped)++;
				return 0;
			}
		}
		strncpy(sChildFolderId, pChild->pId, sizeof(sChildFolderId) - 1u);
		sChildFolderId[sizeof(sChildFolderId) - 1u] = '\0';
#ifdef _WIN32
		{
			char sPattern[1024];
			WIN32_FIND_DATAA tData;
			HANDLE hFind;
			if(!A8E_LibraryWindow_JoinDropPath(
				sPattern, sizeof(sPattern), sDirectory, "*")) return 0;
			hFind = FindFirstFileA(sPattern, &tData);
			if(hFind == INVALID_HANDLE_VALUE) return 0;
			do
			{
				char sChild[1024];
				if(strcmp(tData.cFileName, ".") != 0 &&
					strcmp(tData.cFileName, "..") != 0 &&
					A8E_LibraryWindow_JoinDropPath(
						sChild, sizeof(sChild), sDirectory, tData.cFileName))
					A8E_LibraryWindow_ImportDropPath(
						pWindow, sChild, sChildFolderId, lDepth + 1u,
						pImported, pSkipped);
			} while(FindNextFileA(hFind, &tData));
			FindClose(hFind);
		}
#else
		{
			DIR *pDirectory = opendir(sDirectory);
			struct dirent *pEntry;
			if(!pDirectory) return 0;
			while((pEntry = readdir(pDirectory)) != NULL)
			{
				char sChild[1024];
				if(strcmp(pEntry->d_name, ".") == 0 ||
					strcmp(pEntry->d_name, "..") == 0 ||
					!A8E_LibraryWindow_JoinDropPath(
						sChild, sizeof(sChild), sDirectory, pEntry->d_name))
					continue;
				A8E_LibraryWindow_ImportDropPath(
					pWindow, sChild, sChildFolderId, lDepth + 1u,
					pImported, pSkipped);
			}
			closedir(pDirectory);
		}
#endif
	}
	return 1;
}

static const A8E_LibraryRepositoryRecord_t *A8E_LibraryWindow_SelectedRecord(
	const A8E_LibraryWindow_t *pWindow)
{
	return A8E_LibraryWindow_VisibleRecord(
		pWindow, pWindow->sSelectedRow + pWindow->lScroll);
}

static void A8E_LibraryWindow_DrawRecordInfo(
	A8E_LibraryWindow_t *pWindow,
	const A8E_LibraryRepositoryRecord_t *pRecord,
	int lY)
{
	char acFull[220];
	char acInfo[100];
	char acMount[8] = "";
	if(!pWindow || !pRecord) return;
	if(pRecord->lMountedSlot >= 0)
	{
		acMount[0] = 'D';
		acMount[1] = (char)('1' + pRecord->lMountedSlot);
		acMount[2] = '\0';
	}
	snprintf(acFull, sizeof(acFull), "%s REV %s | %u HIST | %s | %s",
		pRecord->pType ? pRecord->pType : "MEDIA",
		pRecord->pPreferredRevisionId ? pRecord->pPreferredRevisionId : "-",
		(unsigned)pRecord->sRevisionCount,
		pRecord->pModifiedAt && pRecord->pModifiedAt[0]
			? pRecord->pModifiedAt : "MODIFIED UNKNOWN",
		acMount[0] ? acMount : "UNMOUNTED");
	A8E_LibraryWindow_CopyColumnText(acInfo, sizeof(acInfo), acFull, 74u);
	A8E_LibraryWindow_Text(pWindow->pRenderer, 14, lY, acInfo,
		(SDL_Color){ 150, 160, 170, 255 });
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

static int A8E_LibraryWindow_ReportLibraryProgress(
	const char *pPhase,
	uint32_t lCompleted,
	uint32_t lTotal,
	const char *pCurrent,
	void *pUserData)
{
	A8E_LibraryWindow_t *pWindow = (A8E_LibraryWindow_t *)pUserData;
	if(!pWindow) return 1;
	snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
		"%s %u/%u %s", pPhase ? pPhase : "LIBRARY",
		(unsigned)lCompleted, (unsigned)lTotal,
		pCurrent ? pCurrent : "");
	SDL_PumpEvents();
	if(SDL_GetKeyboardFocus() == pWindow->pWindow)
	{
		const Uint8 *pKeyboard = SDL_GetKeyboardState(NULL);
		if(pKeyboard && pKeyboard[SDL_SCANCODE_ESCAPE]) return 0;
	}
	return 1;
}

static int A8E_LibraryWindow_ImportPackage(
	A8E_LibraryWindow_t *pWindow,
	const char *pPackagePath)
{
	A8E_LibraryPackagePreview_t tPreview;
	char sError[160];
	char sMessage[512];
	const SDL_MessageBoxButtonData aButtons[] = {
		{ SDL_MESSAGEBOX_BUTTON_ESCAPEKEY_DEFAULT, 0, "Cancel" },
		{ SDL_MESSAGEBOX_BUTTON_RETURNKEY_DEFAULT, 1, "Import" },
	};
	const SDL_MessageBoxData tMessageBox = {
		SDL_MESSAGEBOX_INFORMATION,
		pWindow ? pWindow->pWindow : NULL,
		"Import A8E library package",
		sMessage,
		2,
		aButtons,
		NULL,
	};
	int lButton = 0;
	uint32_t lDrive;
	if(!pWindow || !pPackagePath) return 0;
	if(!A8E_LibraryRepository_PreviewPackageFile(
		pWindow->pRepository, pPackagePath, &tPreview,
		sError, sizeof(sError)))
	{
		snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
			"IMPORT FAILED %s", sError);
		return 0;
	}
	snprintf(sMessage, sizeof(sMessage),
		"Entries: %u\nNew: %u\nDuplicates: %u\nConflicts: %u "
		"(newer %u, older %u, concurrent %u)\nName collisions: %u\n"
		"New folders: %u\nPayloads: %u\nWorkspace mounts: %u\n\n"
		"Import without replacing local content?",
		(unsigned)tPreview.sPackageEntryCount,
		(unsigned)tPreview.sNewEntryCount,
		(unsigned)tPreview.sDuplicateCount,
		(unsigned)tPreview.sConflictCount,
		(unsigned)tPreview.sNewerCount,
		(unsigned)tPreview.sOlderCount,
		(unsigned)tPreview.sConcurrentCount,
		(unsigned)tPreview.sNameCollisionCount,
		(unsigned)tPreview.sNewFolderCount,
		(unsigned)tPreview.sPayloadCount,
		(unsigned)tPreview.sRestoredDeviceCount);
	if(tPreview.bNewerSchemaVersion || tPreview.bNewerLibraryVersion)
	{
		char sWarning[192];
		if(tPreview.bNewerSchemaVersion && tPreview.bNewerLibraryVersion)
			snprintf(sWarning, sizeof(sWarning),
				"Warning: package schema %u and library version %u are newer.\n\n",
				(unsigned)tPreview.lPackageSchemaVersion,
				(unsigned)tPreview.lPackageLibraryVersion);
		else if(tPreview.bNewerSchemaVersion)
			snprintf(sWarning, sizeof(sWarning),
				"Warning: package schema %u is newer; known fields only will be imported.\n\n",
				(unsigned)tPreview.lPackageSchemaVersion);
		else
			snprintf(sWarning, sizeof(sWarning),
				"Warning: package library version %u is newer.\n\n",
				(unsigned)tPreview.lPackageLibraryVersion);
		/* Rebuild the short message with the warning while retaining the
		 * bounded summary above. */
		{
			char sSummary[512];
			strncpy(sSummary, sMessage, sizeof(sSummary) - 1u);
			sSummary[sizeof(sSummary) - 1u] = '\0';
			snprintf(sMessage, sizeof(sMessage), "%s%s", sWarning, sSummary);
		}
	}
	if(SDL_ShowMessageBox(&tMessageBox, &lButton) != 0 || lButton != 1)
	{
		strncpy(pWindow->acStatus, "IMPORT CANCELED",
			sizeof(pWindow->acStatus) - 1u);
		pWindow->acStatus[sizeof(pWindow->acStatus) - 1u] = '\0';
		return 0;
	}
	A8E_LibraryWindow_SaveDirty(pWindow);
	if(!A8E_LibraryRepository_ImportPackageFileWithProgress(
		pWindow->pRepository, "library", pPackagePath,
		A8E_LibraryWindow_ReportLibraryProgress, pWindow,
		sError, sizeof(sError)))
	{
		snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
			"IMPORT FAILED %s", sError);
		fprintf(stderr, "A8E Library import failed for '%s': %s\n",
			pPackagePath, sError);
		return 0;
	}
	for(lDrive = 0; lDrive < 8u; lDrive++)
	{
		AtariIoUnmountDisk(pWindow->pContext, lDrive);
		pWindow->acMountedIds[lDrive][0] = '\0';
	}
	A8E_LibraryWindow_RestoreWorkspace(pWindow);
	A8E_LibraryWindow_SetFolder(pWindow, "root");
	snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
		"IMPORTED PACKAGE %s", pPackagePath);
	return 1;
}

static void A8E_LibraryWindow_PerformPathOperation(A8E_LibraryWindow_t *pWindow)
{
	char sError[160];
	uint32_t lDrive;
	if(!pWindow || !pWindow->bPathInput || pWindow->sPathLength == 0) return;
	if(pWindow->cPathOperation == 'A')
	{
		char *pEnd;
		unsigned long lDays = strtoul(pWindow->acPath, &pEnd, 10);
		time_t lNow;
		time_t lAge;
		time_t lCutoff;
		struct tm *pUtc;
		char sBefore[32];
		char sMessage[192];
		const SDL_MessageBoxButtonData aButtons[] = {
			{ SDL_MESSAGEBOX_BUTTON_ESCAPEKEY_DEFAULT, 0, "Cancel" },
			{ SDL_MESSAGEBOX_BUTTON_RETURNKEY_DEFAULT, 1, "Purge" },
		};
		SDL_MessageBoxData tMessageBox;
		int lButton = 0;
		uint16_t sPurged = 0;
		if(*pEnd != '\0' || lDays > 3650000ul)
		{
			strncpy(pWindow->acStatus, "AGE MUST BE 0-3650000 DAYS",
				sizeof(pWindow->acStatus) - 1u);
			return;
		}
		lNow = time(NULL);
		/* Avoid converting a large age to a narrow time_t before checking
		 * whether the cutoff predates the representable Unix epoch. */
		if(lNow >= (time_t)0 &&
			lDays > (unsigned long)(lNow / (time_t)86400))
			lCutoff = (time_t)0;
		else
		{
			lAge = (time_t)lDays * (time_t)86400;
			lCutoff = lNow - lAge;
		}
		if(!(pUtc = gmtime(&lCutoff)) ||
			strftime(sBefore, sizeof(sBefore), "%Y-%m-%dT%H:%M:%SZ", pUtc) == 0)
		{
			strncpy(pWindow->acStatus, "INVALID TRASH AGE",
				sizeof(pWindow->acStatus) - 1u);
			return;
		}
		snprintf(sMessage, sizeof(sMessage),
			"Permanently purge trash older than %lu days?", lDays);
		tMessageBox.flags = SDL_MESSAGEBOX_WARNING;
		tMessageBox.window = pWindow->pWindow;
		tMessageBox.title = "Purge old trash";
		tMessageBox.message = sMessage;
		tMessageBox.numbuttons = 2;
		tMessageBox.buttons = aButtons;
		tMessageBox.colorScheme = NULL;
		if(SDL_ShowMessageBox(&tMessageBox, &lButton) != 0 || lButton != 1)
		{
			strncpy(pWindow->acStatus, "TRASH PURGE CANCELED",
				sizeof(pWindow->acStatus) - 1u);
			return;
		}
		if(A8E_LibraryRepository_PurgeTrashBefore(
			pWindow->pRepository, "library", sBefore, &sPurged,
			sError, sizeof(sError)))
			snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
				"PURGED %u OLD TRASH", (unsigned)sPurged);
		else snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
			"TRASH PURGE FAILED %s", sError);
		return;
	}
	if(pWindow->cPathOperation == 'F')
	{
		if(A8E_LibraryRepository_CreateFolder(
			pWindow->pRepository, "library", pWindow->acFolderId,
			pWindow->acPath, sError, sizeof(sError)))
			snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
				"CREATED FOLDER %s", pWindow->acPath);
		else snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
			"FOLDER FAILED %s", sError);
		return;
	}
	if(pWindow->cPathOperation == 'R')
	{
		const A8E_LibraryRepositoryFolder_t *pFolder;
		int bParentRow = 0;
		pFolder = A8E_LibraryWindow_VisibleFolder(
			pWindow, pWindow->sSelectedRow + pWindow->lScroll, &bParentRow);
		if(pFolder)
		{
			if(A8E_LibraryRepository_RenameFolder(
				pWindow->pRepository, "library", pFolder->pId,
				pWindow->acPath, sError, sizeof(sError)))
				snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
					"RENAMED FOLDER %s", pWindow->acPath);
			else snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
				"RENAME FAILED %s", sError);
			return;
		}
		{
			const A8E_LibraryRepositoryRecord_t *pRecord =
				A8E_LibraryWindow_SelectedRecord(pWindow);
			if(pRecord && A8E_LibraryRepository_RenameEntry(
				pWindow->pRepository, "library", pRecord->pId,
				pWindow->acPath, sError, sizeof(sError)))
				snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
					"RENAMED %s", pWindow->acPath);
			else snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
				"RENAME FAILED %s", sError);
		}
		return;
	}
	if(pWindow->cPathOperation == 'M')
	{
		const A8E_LibraryRepositoryRecord_t *pRecord =
			A8E_LibraryWindow_SelectedRecord(pWindow);
		char sName[257];
		if(pRecord)
		{
			strncpy(sName, pRecord->pName, sizeof(sName) - 1u);
			sName[sizeof(sName) - 1u] = '\0';
		}
		if(pRecord && A8E_LibraryRepository_MoveEntry(
			pWindow->pRepository, "library", pRecord->pId,
			pWindow->acFolderId, sError, sizeof(sError)))
			snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
				"MOVED %s", sName);
		else snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
			"MOVE FAILED %s", sError);
		return;
	}
	if(pWindow->cPathOperation == 'N')
	{
		char sName[1024];
		strncpy(sName, pWindow->acPath, sizeof(sName) - 1u);
		sName[sizeof(sName) - 1u] = '\0';
		if(!strchr(sName, '.') && strlen(sName) + 4u < sizeof(sName)) strcat(sName, ".atr");
		if(A8E_LibraryRepository_CreateBlankAtr(
			pWindow->pRepository, "library", sName, sError, sizeof(sError)))
		{
			uint16_t i;
			const A8E_LibraryRepositoryRecord_t *pCreated = NULL;
			for(i = 0; i < pWindow->pRepository->sRecordCount; i++)
				if(strcmp(pWindow->pRepository->pRecords[i].pName, sName) == 0)
				{
					pCreated = &pWindow->pRepository->pRecords[i];
					break;
				}
			if(pCreated && strcmp(pWindow->acFolderId, "root") != 0)
				A8E_LibraryRepository_MoveEntry(
					pWindow->pRepository, "library", pCreated->pId,
					pWindow->acFolderId, NULL, 0);
			snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
				"CREATED %s", sName);
		}
		else snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
				"CREATE FAILED %s", sError);
		return;
	}
	if(pWindow->cPathOperation == 'Y')
	{
		const A8E_LibraryRepositoryRecord_t *pRecord =
			A8E_LibraryWindow_SelectedRecord(pWindow);
		char sEntryId[257];
		uint32_t lDrive;
		if(!pRecord)
		{
			strncpy(pWindow->acStatus, "NO FILE SELECTED",
				sizeof(pWindow->acStatus) - 1u);
			return;
		}
		strncpy(sEntryId, pRecord->pId, sizeof(sEntryId) - 1u);
		sEntryId[sizeof(sEntryId) - 1u] = '\0';
		A8E_LibraryWindow_SaveDirty(pWindow);
		for(lDrive = 0; lDrive < 8u; lDrive++)
			if(strcmp(pWindow->acMountedIds[lDrive], sEntryId) == 0)
			{
				AtariIoUnmountDisk(pWindow->pContext, lDrive);
				pWindow->acMountedIds[lDrive][0] = '\0';
			}
		if(A8E_LibraryRepository_PromoteRevision(
			pWindow->pRepository, "library", sEntryId, pWindow->acPath,
			sError, sizeof(sError)))
		{
			A8E_LibraryWindow_SaveWorkspace(pWindow);
			snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
				"PROMOTED REVISION %s", sEntryId);
		}
		else snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
			"PROMOTE FAILED %s", sError);
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
		if(A8E_LibraryRepository_ExportPackageFileWithProgress(
			pWindow->pRepository, pWindow->acPath,
			A8E_LibraryWindow_ReportLibraryProgress, pWindow,
			sError, sizeof(sError)))
			snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
				"EXPORTED %s", pWindow->acPath);
		else snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
				"EXPORT FAILED %s", sError);
		return;
	}
	if(pWindow->cPathOperation == 'W')
	{
		A8E_LibraryWindow_SaveDirty(pWindow);
		if(A8E_LibraryRepository_ExportWorkspacePackageFileWithProgress(
			pWindow->pRepository, pWindow->acPath,
			A8E_LibraryWindow_ReportLibraryProgress, pWindow,
			sError, sizeof(sError)))
			snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
				"EXPORTED WORKSPACE %s", pWindow->acPath);
		else snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
				"WORKSPACE EXPORT FAILED %s", sError);
		return;
	}
	{
		char sResolvedPackagePath[2048];
		const char *pPackagePath = A8E_LibraryWindow_ResolvePackagePath(
			pWindow->acPath, sResolvedPackagePath, sizeof(sResolvedPackagePath));
		if(A8E_LibraryWindow_ImportPackage(pWindow, pPackagePath))
		{
			SDL_StopTextInput();
			SDL_HideWindow(pWindow->pWindow);
		}
	}
}

static void A8E_LibraryWindow_VerifySelected(
	A8E_LibraryWindow_t *pWindow)
{
	const A8E_LibraryRepositoryRecord_t *pRecord;
	const uint8_t *pBytes;
	A8E_LibraryAtrIntegrityReport Report;
	uint32_t lSize;
	if(!pWindow) return;
	pRecord = A8E_LibraryWindow_SelectedRecord(pWindow);
	if(!pRecord || strcmp(pRecord->pType, "atr") != 0)
	{
		strncpy(pWindow->acStatus, "VERIFY ATR ONLY", sizeof(pWindow->acStatus) - 1u);
		return;
	}
	pBytes = A8E_LibraryRepository_GetPayload(
		pWindow->pRepository, pRecord->pPath, &lSize);
	if(!pBytes || !A8E_LibraryImage_VerifyAtr(pBytes, lSize, &Report))
	{
		strncpy(pWindow->acStatus, "VERIFY FAILED", sizeof(pWindow->acStatus) - 1u);
		return;
	}
	if(Report.valid)
		snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
			"INTEGRITY OK %s", Report.warningCount ? "WITH WARNING" : "");
	else snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
		"INTEGRITY ERROR %s", Report.firstError);
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
	strcpy(pWindow->acFolderId, "root");
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
		(pEvent->type == SDL_DROPFILE
			? pEvent->drop.windowID != pWindow->lWindowId
			: pEvent->window.windowID != pWindow->lWindowId)) return 0;
	if(pEvent->type == SDL_WINDOWEVENT && pEvent->window.event == SDL_WINDOWEVENT_CLOSE)
	{
		pWindow->bVisible = 0;
		SDL_StopTextInput();
		SDL_HideWindow(pWindow->pWindow);
		return 1;
	}
	if(pEvent->type == SDL_DROPFILE)
	{
		char sPath[1024];
		const char *pExtension;
		uint32_t lImported = 0;
		uint32_t lSkipped = 0;
		if(!pEvent->drop.file)
			return 1;
		strncpy(sPath, pEvent->drop.file, sizeof(sPath) - 1u);
		sPath[sizeof(sPath) - 1u] = '\0';
		pExtension = A8E_LibraryWindow_FileExtension(sPath);
		if(pWindow->bTrashView)
			strncpy(pWindow->acStatus, "CLOSE TRASH BEFORE DROP",
				sizeof(pWindow->acStatus) - 1u);
		else if(A8E_LibraryWindow_EqualName(pExtension, "a8e") &&
			!A8E_LibraryWindow_IsDirectory(sPath))
		{
			(void)A8E_LibraryWindow_ImportPackage(pWindow, sPath);
		}
		else
		{
			A8E_LibraryWindow_ImportDropPath(
				pWindow, sPath, pWindow->acFolderId, 0u,
				&lImported, &lSkipped);
			snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
				"DROPPED %u FILE%s, %u SKIPPED", lImported,
				lImported == 1u ? "" : "S", lSkipped);
		}
		SDL_free(pEvent->drop.file);
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
		if(pWindow->sSearchLength > 0)
			pWindow->acSearch[--pWindow->sSearchLength] = '\0';
		else
		{
			const A8E_LibraryRepositoryFolder_t *pFolder =
				A8E_LibraryWindow_CurrentFolder(pWindow);
			if(pFolder && pFolder->pParentId)
				A8E_LibraryWindow_SetFolder(pWindow, pFolder->pParentId);
		}
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
	if(pEvent->type == SDL_KEYDOWN && !pWindow->bPathInput && !pWindow->bAtrView &&
		(pEvent->key.keysym.sym == SDLK_UP || pEvent->key.keysym.sym == SDLK_DOWN ||
		 pEvent->key.keysym.sym == SDLK_PAGEUP || pEvent->key.keysym.sym == SDLK_PAGEDOWN ||
		 pEvent->key.keysym.sym == SDLK_HOME || pEvent->key.keysym.sym == SDLK_END))
	{
		uint32_t lCount = A8E_LibraryWindow_VisibleCount(pWindow);
		uint32_t lPosition;
		if(lCount == 0u)
		{
			pWindow->lScroll = 0;
			pWindow->sSelectedRow = 0;
			return 1;
		}
		lPosition = pWindow->lScroll + pWindow->sSelectedRow;
		if(lPosition >= lCount) lPosition = lCount - 1u;
		if(pEvent->key.keysym.sym == SDLK_UP)
		{
			if(lPosition > 0u) lPosition--;
		}
		else if(pEvent->key.keysym.sym == SDLK_DOWN)
		{
			if(lPosition + 1u < lCount) lPosition++;
		}
		else if(pEvent->key.keysym.sym == SDLK_PAGEUP)
			lPosition = lPosition > A8E_LIBRARY_MAX_VISIBLE_ROWS
				? lPosition - A8E_LIBRARY_MAX_VISIBLE_ROWS : 0u;
		else if(pEvent->key.keysym.sym == SDLK_PAGEDOWN)
		{
			uint32_t lPageEnd = lPosition + A8E_LIBRARY_MAX_VISIBLE_ROWS;
			lPosition = lPageEnd < lCount ? lPageEnd : lCount - 1u;
		}
		else if(pEvent->key.keysym.sym == SDLK_HOME)
			lPosition = 0u;
		else lPosition = lCount - 1u;
		if(lPosition < pWindow->lScroll) pWindow->lScroll = lPosition;
		else if(lPosition >= pWindow->lScroll + A8E_LIBRARY_MAX_VISIBLE_ROWS)
			pWindow->lScroll = lPosition - A8E_LIBRARY_MAX_VISIBLE_ROWS + 1u;
		pWindow->sSelectedRow = (uint16_t)(lPosition - pWindow->lScroll);
		return 1;
	}
	if(pEvent->type == SDL_KEYDOWN && !pEvent->key.repeat &&
		!pWindow->bPathInput && !pWindow->bAtrView &&
		(pEvent->key.keysym.sym == SDLK_RETURN ||
		 pEvent->key.keysym.sym == SDLK_KP_ENTER))
	{
		int bParentRow = 0;
		const A8E_LibraryRepositoryFolder_t *pFolder =
			A8E_LibraryWindow_VisibleFolder(
			pWindow, pWindow->sSelectedRow + pWindow->lScroll, &bParentRow);
		if(pFolder)
			A8E_LibraryWindow_SetFolder(pWindow, pFolder->pId);
		else if(bParentRow)
		{
			const A8E_LibraryRepositoryFolder_t *pCurrent =
				A8E_LibraryWindow_CurrentFolder(pWindow);
			if(pCurrent) A8E_LibraryWindow_SetFolder(pWindow, pCurrent->pParentId);
		}
		else if(pWindow->bTrashView)
			strncpy(pWindow->acStatus, "USE R TO RESTORE P TO PURGE",
				sizeof(pWindow->acStatus) - 1u);
		else
		{
			const A8E_LibraryRepositoryRecord_t *pRecord =
				A8E_LibraryWindow_SelectedRecord(pWindow);
			if(pRecord) A8E_LibraryWindow_OpenAtr(pWindow, pRecord);
		}
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
			pEvent->key.keysym.sym == SDLK_w || pEvent->key.keysym.sym == SDLK_n ||
			(pEvent->key.keysym.sym == SDLK_y && !pWindow->bTrashView)))
	{
		pWindow->bPathInput = 1;
		pWindow->bIgnorePathActivation = 1;
		pWindow->cPathOperation = pEvent->key.keysym.sym == SDLK_e ? 'E' :
			pEvent->key.keysym.sym == SDLK_w ? 'W' :
			pEvent->key.keysym.sym == SDLK_n ? 'N' : 'I';
		if(pEvent->key.keysym.sym == SDLK_y) pWindow->cPathOperation = 'Y';
		pWindow->sPathLength = 0;
		pWindow->acPath[0] = '\0';
		return 1;
	}
	if(pEvent->type == SDL_KEYDOWN && pEvent->key.repeat == 0 && !pWindow->bPathInput)
	{
		if(pEvent->key.keysym.sym == SDLK_b)
		{
			pWindow->bTrashView = (uint8_t)!pWindow->bTrashView;
			pWindow->lScroll = 0;
			pWindow->sSelectedRow = 0;
			pWindow->acStatus[0] = '\0';
			return 1;
		}
		if(pWindow->bTrashView && pEvent->key.keysym.sym == SDLK_r)
		{
			const A8E_LibraryRepositoryRecord_t *pTrash =
				A8E_LibraryWindow_SelectedRecord(pWindow);
			if(pTrash && A8E_LibraryRepository_RestoreTrashEntry(
				pWindow->pRepository, "library", pTrash->pId,
				pWindow->acFolderId, pWindow->acStatus, sizeof(pWindow->acStatus)))
				strncpy(pWindow->acStatus, "TRASH ENTRY RESTORED",
					sizeof(pWindow->acStatus) - 1u);
			else if(!pTrash) strncpy(pWindow->acStatus, "NO TRASH ENTRY SELECTED",
				sizeof(pWindow->acStatus) - 1u);
			return 1;
		}
		if(pWindow->bTrashView && pEvent->key.keysym.sym == SDLK_p)
		{
			const A8E_LibraryRepositoryRecord_t *pTrash =
				A8E_LibraryWindow_SelectedRecord(pWindow);
			if(pTrash && A8E_LibraryRepository_PurgeTrashEntry(
				pWindow->pRepository, "library", pTrash->pId,
				pWindow->acStatus, sizeof(pWindow->acStatus)))
				strncpy(pWindow->acStatus, "TRASH ENTRY PURGED",
					sizeof(pWindow->acStatus) - 1u);
			else if(!pTrash) strncpy(pWindow->acStatus, "NO TRASH ENTRY SELECTED",
					sizeof(pWindow->acStatus) - 1u);
			return 1;
		}
		if(pWindow->bTrashView && pEvent->key.keysym.sym == SDLK_a)
		{
			pWindow->bPathInput = 1;
			pWindow->bIgnorePathActivation = 1;
			pWindow->cPathOperation = 'A';
			pWindow->sPathLength = 0;
			pWindow->acPath[0] = '\0';
			return 1;
		}
		if(pEvent->key.keysym.sym == SDLK_t)
		{
			pWindow->nTypeFilter = (uint8_t)((pWindow->nTypeFilter + 1u) % 3u);
			pWindow->lScroll = 0;
			strncpy(pWindow->acStatus, pWindow->nTypeFilter == 0u ? "TYPE ALL" :
				pWindow->nTypeFilter == 1u ? "TYPE ATR" : "TYPE XEX",
				sizeof(pWindow->acStatus) - 1u);
			return 1;
		}
		if(pEvent->key.keysym.sym == SDLK_q)
		{
			pWindow->nMountFilter = (uint8_t)((pWindow->nMountFilter + 1u) % 3u);
			pWindow->lScroll = 0;
			strncpy(pWindow->acStatus, pWindow->nMountFilter == 0u ? "MOUNT ALL" :
				pWindow->nMountFilter == 1u ? "MOUNTED ONLY" : "UNMOUNTED ONLY",
				sizeof(pWindow->acStatus) - 1u);
			return 1;
		}
		if(pEvent->key.keysym.sym == SDLK_s)
		{
			pWindow->nSortMode = (uint8_t)((pWindow->nSortMode + 1u) % 4u);
			pWindow->lScroll = 0;
			strncpy(pWindow->acStatus, pWindow->nSortMode == 0u ? "SORT NAME" :
				pWindow->nSortMode == 1u ? "SORT TYPE" :
				pWindow->nSortMode == 2u ? "SORT SIZE" : "SORT MODIFIED",
				sizeof(pWindow->acStatus) - 1u);
			return 1;
		}
		if(pEvent->key.keysym.sym == SDLK_h)
		{
			A8E_LibraryWindow_ShowStorage(pWindow);
			return 1;
		}
		if(pEvent->key.keysym.sym == SDLK_v)
		{
			if(pWindow->bTrashView)
			{
				strncpy(pWindow->acStatus, "VERIFY ACTIVE ATR ONLY",
					sizeof(pWindow->acStatus) - 1u);
				return 1;
			}
			A8E_LibraryWindow_VerifySelected(pWindow);
			return 1;
		}
		if(!pWindow->bTrashView &&
			(pEvent->key.keysym.sym == SDLK_f || pEvent->key.keysym.sym == SDLK_r))
		{
			pWindow->bPathInput = 1;
			pWindow->bIgnorePathActivation = 1;
			pWindow->cPathOperation = pEvent->key.keysym.sym == SDLK_f ? 'F' : 'R';
			pWindow->sPathLength = 0;
			pWindow->acPath[0] = '\0';
			return 1;
		}
		if(pEvent->key.keysym.sym == SDLK_m)
		{
			const A8E_LibraryRepositoryRecord_t *pRecord =
				A8E_LibraryWindow_SelectedRecord(pWindow);
			char sError[160];
			char sName[257];
			if(pRecord)
			{
				strncpy(sName, pRecord->pName, sizeof(sName) - 1u);
				sName[sizeof(sName) - 1u] = '\0';
			}
			if(pRecord && A8E_LibraryRepository_MoveEntry(
				pWindow->pRepository, "library", pRecord->pId,
				pWindow->acFolderId, sError, sizeof(sError)))
				snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
					"MOVED %s", sName);
			else snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
				"MOVE FAILED %s", pRecord ? sError : "NO FILE SELECTED");
			return 1;
		}
	}
	if(pEvent->type == SDL_KEYDOWN && pEvent->key.keysym.sym == SDLK_DELETE)
	{
		if(pWindow->bAtrView) return 1;
		if(pWindow->bTrashView)
		{
			strncpy(pWindow->acStatus, "USE P TO PURGE TRASH",
				sizeof(pWindow->acStatus) - 1u);
			return 1;
		}
		{
			int bParentRow = 0;
			const A8E_LibraryRepositoryFolder_t *pFolder =
				A8E_LibraryWindow_VisibleFolder(
				pWindow, pWindow->sSelectedRow + pWindow->lScroll, &bParentRow);
			if(pFolder)
			{
				char sError[160];
				char sName[257];
				strncpy(sName, pFolder->pName, sizeof(sName) - 1u);
				sName[sizeof(sName) - 1u] = '\0';
				if(A8E_LibraryRepository_DeleteFolder(
					pWindow->pRepository, "library", pFolder->pId,
					sError, sizeof(sError)))
					snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
						"DELETED FOLDER %s", sName);
				else snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
					"DELETE FAILED %s", sError);
				return 1;
			}
			if(bParentRow) return 1;
		}
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
				"MOVED TO TRASH %s", sName);
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
		int bParentRow = 0;
		const A8E_LibraryRepositoryFolder_t *pFolder;
		if(lRow < 0 || lRow >= A8E_LIBRARY_MAX_VISIBLE_ROWS ||
			lVisibleRow < 0 || (uint32_t)lVisibleRow >= A8E_LibraryWindow_VisibleCount(pWindow)) return 1;
		pFolder = A8E_LibraryWindow_VisibleFolder(
			pWindow, (uint32_t)lVisibleRow, &bParentRow);
		if(pFolder)
		{
			A8E_LibraryWindow_SetFolder(pWindow, pFolder->pId);
			return 1;
		}
		if(bParentRow)
		{
			const A8E_LibraryRepositoryFolder_t *pCurrent =
				A8E_LibraryWindow_CurrentFolder(pWindow);
			if(pCurrent) A8E_LibraryWindow_SetFolder(pWindow, pCurrent->pParentId);
			return 1;
		}
		pRecord = A8E_LibraryWindow_VisibleRecord(pWindow, (uint32_t)lVisibleRow);
		if(pWindow->bTrashView)
		{
			pWindow->sSelectedRow = (uint16_t)lRow;
			return 1;
		}
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
		if((uint32_t)lVisibleRow < A8E_LibraryWindow_FolderRowCount(pWindow)) return 1;
		if(lVisibleRow < 0 || (uint32_t)lVisibleRow >= A8E_LibraryWindow_VisibleCount(pWindow)) return 1;
		pRecord = A8E_LibraryWindow_VisibleRecord(pWindow, (uint32_t)lVisibleRow);
		if(!pRecord) return 1;
		if(pWindow->bTrashView) return 1;
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
	A8E_LibraryWindow_DrawRecordInfo(pWindow, pRecord,
		A8E_LIBRARY_WINDOW_HEIGHT - 48);
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
	{
		const A8E_LibraryRepositoryFolder_t *pCurrent =
			A8E_LibraryWindow_CurrentFolder(pWindow);
		char sTitle[320];
		snprintf(sTitle, sizeof(sTitle), "DISK LIBRARY / %s",
			pWindow->bTrashView ? "Trash" : (pCurrent ? pCurrent->pName : "Library"));
		A8E_LibraryWindow_Text(pWindow->pRenderer, 14, 12, sTitle, tWhite);
	}
	if(pWindow->bPathInput)
	{
		A8E_LibraryWindow_Text(pWindow->pRenderer, 14, 34,
			pWindow->cPathOperation == 'E' ? "EXPORT PATH" :
			pWindow->cPathOperation == 'W' ? "WORKSPACE EXPORT PATH" :
			pWindow->cPathOperation == 'N' ? "NEW ATR NAME" :
			pWindow->cPathOperation == 'Y' ? "REVISION ID" :
			pWindow->cPathOperation == 'F' ? "NEW FOLDER NAME" :
			pWindow->cPathOperation == 'R' ? "RENAME" :
			pWindow->cPathOperation == 'A' ? "TRASH AGE DAYS" : "IMPORT PATH", tMuted);
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
		pWindow->bTrashView ? "B LIBRARY R RESTORE P PURGE A AGE H SPACE" :
		"B TRASH F NEW FOLDER R RENAME Y REVISION T TYPE Q MOUNT S SORT H SPACE V VERIFY I/E/W N", tMuted);
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
		uint32_t lVisibleIndex = sRow + pWindow->lScroll;
		int bParentRow = 0;
		const A8E_LibraryRepositoryFolder_t *pFolder =
			A8E_LibraryWindow_VisibleFolder(pWindow, lVisibleIndex, &bParentRow);
		const A8E_LibraryRepositoryRecord_t *pRecord = pFolder || bParentRow
			? NULL : A8E_LibraryWindow_VisibleRecord(pWindow, lVisibleIndex);
		char acDisplayName[64];
		int lY;
		uint32_t lDrive;
		if(!pRecord && !pFolder && !bParentRow) break;
		lY = A8E_LIBRARY_LIST_TOP + (int)sRow * A8E_LIBRARY_ROW_HEIGHT;
		if(sRow == pWindow->sSelectedRow)
		{
			SDL_Rect tRow = { 8, lY - 2, A8E_LIBRARY_WINDOW_WIDTH - 16, A8E_LIBRARY_ROW_HEIGHT };
			SDL_SetRenderDrawColor(pWindow->pRenderer, 30, 45, 58, 255);
			SDL_RenderFillRect(pWindow->pRenderer, &tRow);
		}
		else if(sRow & 1u)
		{
			SDL_Rect tRow = { 8, lY - 2, A8E_LIBRARY_WINDOW_WIDTH - 16, A8E_LIBRARY_ROW_HEIGHT };
			SDL_SetRenderDrawColor(pWindow->pRenderer, 30, 35, 42, 255);
			SDL_RenderFillRect(pWindow->pRenderer, &tRow);
		}
		if(pFolder || bParentRow)
		{
			const char *pName = bParentRow ? ".." : pFolder->pName;
			A8E_LibraryWindow_CopyColumnText(acDisplayName, sizeof(acDisplayName),
				pName, A8E_LIBRARY_NAME_MAX_CHARS - 2u);
			A8E_LibraryWindow_Text(pWindow->pRenderer, A8E_LIBRARY_NAME_X, lY,
				bParentRow ? ".." : "DIR", tMuted);
			A8E_LibraryWindow_Text(pWindow->pRenderer, A8E_LIBRARY_NAME_X + 36,
				lY, acDisplayName, tWhite);
			continue;
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
	if(A8E_LibraryWindow_VisibleCount(pWindow) == 0)
		A8E_LibraryWindow_Text(pWindow->pRenderer, A8E_LIBRARY_NAME_X,
			A8E_LIBRARY_LIST_TOP, pWindow->bTrashView ? "TRASH EMPTY" : "EMPTY", tMuted);
	A8E_LibraryWindow_DrawRecordInfo(
		pWindow, A8E_LibraryWindow_SelectedRecord(pWindow),
		A8E_LIBRARY_WINDOW_HEIGHT - 48);
	if(pWindow->acStatus[0]) A8E_LibraryWindow_Text(
		pWindow->pRenderer, 14, A8E_LIBRARY_WINDOW_HEIGHT - 24, pWindow->acStatus, tMuted);
	SDL_RenderPresent(pWindow->pRenderer);
}
