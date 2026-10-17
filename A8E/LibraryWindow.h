#ifndef A8E_LIBRARY_WINDOW_H
#define A8E_LIBRARY_WINDOW_H

#include <SDL2/SDL.h>

#include "6502.h"
#include "LibraryRepository.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct
{
	SDL_Window *pWindow;
	SDL_Renderer *pRenderer;
	_6502_Context_t *pContext;
	A8E_LibraryRepository_t *pRepository;
	uint32_t lWindowId;
	uint32_t lScroll;
	uint16_t sSelectedRow;
	uint16_t sAtrSelectedRow;
	uint16_t sAtrScroll;
	uint16_t sSearchLength;
	uint16_t sPathLength;
	uint8_t bVisible;
	uint8_t bPathInput;
	uint8_t bIgnorePathActivation;
	uint8_t bAtrView;
	uint8_t bAtrPreview;
	uint8_t bTrashView;
	uint8_t nTypeFilter;
	uint8_t nMountFilter;
	uint8_t nSortMode;
	char cPathOperation;
	char acMountedIds[8][257];
	char acFolderId[257];
	char acAtrEntryId[257];
	char acSearch[257];
	char acPath[1024];
	char acAtrPreview[4096];
	char acStatus[160];
} A8E_LibraryWindow_t;

int A8E_LibraryWindow_Init(
	A8E_LibraryWindow_t *pLibraryWindow,
	_6502_Context_t *pContext,
	A8E_LibraryRepository_t *pRepository);

void A8E_LibraryWindow_Free(A8E_LibraryWindow_t *pLibraryWindow);

void A8E_LibraryWindow_Toggle(A8E_LibraryWindow_t *pLibraryWindow);

int A8E_LibraryWindow_HandleEvent(
	A8E_LibraryWindow_t *pLibraryWindow,
	const SDL_Event *pEvent);

void A8E_LibraryWindow_Draw(A8E_LibraryWindow_t *pLibraryWindow);

void A8E_LibraryWindow_SaveDirty(A8E_LibraryWindow_t *pLibraryWindow);

#ifdef __cplusplus
}
#endif

#endif
