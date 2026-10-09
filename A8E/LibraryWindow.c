#include "LibraryWindow.h"

#include <ctype.h>
#include <stdio.h>
#include <string.h>

#include "AtariIo.h"

#define A8E_LIBRARY_WINDOW_WIDTH 920
#define A8E_LIBRARY_WINDOW_HEIGHT 560
#define A8E_LIBRARY_ROW_HEIGHT 24
#define A8E_LIBRARY_LIST_TOP 68
#define A8E_LIBRARY_NAME_X 14
#define A8E_LIBRARY_TYPE_X 230
#define A8E_LIBRARY_DRIVE_X 282
#define A8E_LIBRARY_DRIVE_WIDTH 74
#define A8E_LIBRARY_MAX_VISIBLE_ROWS 19

typedef struct
{
	char cCharacter;
	uint8_t aRows[5];
} A8E_LibraryGlyph_t;

static const A8E_LibraryGlyph_t aGlyphs[] = {
	{ 'A', { 0x1e, 0x05, 0x1f, 0x11, 0x11 } }, { 'B', { 0x1e, 0x11, 0x1e, 0x11, 0x1e } },
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
	{ '-', { 0x00, 0x00, 0x1f, 0x00, 0x00 } }, { ':', { 0x00, 0x04, 0x00, 0x04, 0x00 } },
	{ '.', { 0x00, 0x00, 0x00, 0x00, 0x04 } }, { '/', { 0x01, 0x02, 0x04, 0x08, 0x10 } },
	{ '_', { 0x00, 0x00, 0x00, 0x00, 0x1f } }, { '*', { 0x00, 0x15, 0x0e, 0x15, 0x00 } },
	{ '?', { 0x0e, 0x11, 0x02, 0x00, 0x02 } },
};

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
	for(lDrive = 0; lDrive < 8u; lDrive++)
	{
		AtariIoUnmountDisk(pWindow->pContext, lDrive);
		pWindow->acMountedIds[lDrive][0] = '\0';
	}
	if(!A8E_LibraryRepository_ImportPackageFile(
		pWindow->pRepository, "library", pWindow->acPath,
		sError, sizeof(sError)))
	{
		snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
			"IMPORT FAILED %s", sError);
		return;
	}
	A8E_LibraryWindow_RestoreWorkspace(pWindow);
	snprintf(pWindow->acStatus, sizeof(pWindow->acStatus),
		"IMPORTED %s", pWindow->acPath);
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
			pWindow->sPathLength = 0;
			pWindow->acPath[0] = '\0';
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
		if(pWindow->sSearchLength > 0) pWindow->acSearch[--pWindow->sSearchLength] = '\0';
		pWindow->lScroll = 0;
		return 1;
	}
	if(pEvent->type == SDL_KEYDOWN && pWindow->bPathInput &&
		pEvent->key.keysym.sym == SDLK_RETURN)
	{
		A8E_LibraryWindow_PerformPathOperation(pWindow);
		pWindow->bPathInput = 0;
		pWindow->sPathLength = 0;
		pWindow->acPath[0] = '\0';
		return 1;
	}
	if(pEvent->type == SDL_KEYDOWN && pEvent->key.repeat == 0 && !pWindow->bPathInput &&
		(pEvent->key.keysym.sym == SDLK_i || pEvent->key.keysym.sym == SDLK_e ||
			pEvent->key.keysym.sym == SDLK_n))
	{
		pWindow->bPathInput = 1;
		pWindow->cPathOperation = pEvent->key.keysym.sym == SDLK_e ? 'E' :
			pEvent->key.keysym.sym == SDLK_n ? 'N' : 'I';
		pWindow->sPathLength = 0;
		pWindow->acPath[0] = '\0';
		return 1;
	}
	if(pEvent->type == SDL_KEYDOWN && pEvent->key.keysym.sym == SDLK_DELETE)
	{
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
		uint32_t lCount = A8E_LibraryWindow_VisibleCount(pWindow);
		uint32_t lMaximum = lCount > A8E_LIBRARY_MAX_VISIBLE_ROWS
			? lCount - A8E_LIBRARY_MAX_VISIBLE_ROWS : 0u;
		if(pEvent->wheel.y < 0 && pWindow->lScroll < lMaximum) pWindow->lScroll++;
		if(pEvent->wheel.y > 0 && pWindow->lScroll > 0) pWindow->lScroll--;
		return 1;
	}
	if(pEvent->type != SDL_MOUSEBUTTONDOWN ||
		(pEvent->button.button != SDL_BUTTON_LEFT && pEvent->button.button != SDL_BUTTON_RIGHT)) return 1;
	lRow = (pEvent->button.y - A8E_LIBRARY_LIST_TOP) / A8E_LIBRARY_ROW_HEIGHT;
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
		A8E_LibraryWindow_Text(pWindow->pRenderer, A8E_LIBRARY_NAME_X, lY, pRecord->pName, tWhite);
		A8E_LibraryWindow_Text(pWindow->pRenderer, A8E_LIBRARY_TYPE_X, lY, pRecord->pType, tMuted);
		for(lDrive = 0; lDrive < 8u; lDrive++)
		{
			SDL_Rect tCell = { A8E_LIBRARY_DRIVE_X + (int)lDrive * A8E_LIBRARY_DRIVE_WIDTH - 3,
				lY - 3, A8E_LIBRARY_DRIVE_WIDTH - 6, A8E_LIBRARY_ROW_HEIGHT - 2 };
			int bMounted = strcmp(pWindow->acMountedIds[lDrive], pRecord->pId) == 0;
			SDL_SetRenderDrawColor(pWindow->pRenderer,
				bMounted ? (AtariIoIsDiskWritable(pWindow->pContext, lDrive) ? 42 : 120) : 48,
				bMounted ? (AtariIoIsDiskWritable(pWindow->pContext, lDrive) ? 94 : 48) : 54,
				bMounted ? 62 : 64, 255);
			SDL_RenderDrawRect(pWindow->pRenderer, &tCell);
			if(bMounted) A8E_LibraryWindow_Text(pWindow->pRenderer,
				tCell.x + 5, lY, "*", tWhite);
		}
	}
	if(pWindow->pRepository->sRecordCount == 0)
		A8E_LibraryWindow_Text(pWindow->pRenderer, A8E_LIBRARY_NAME_X,
			A8E_LIBRARY_LIST_TOP, "EMPTY", tMuted);
	if(pWindow->acStatus[0]) A8E_LibraryWindow_Text(
		pWindow->pRenderer, 14, A8E_LIBRARY_WINDOW_HEIGHT - 24, pWindow->acStatus, tMuted);
	SDL_RenderPresent(pWindow->pRenderer);
}
