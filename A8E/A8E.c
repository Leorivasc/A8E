/********************************************************************
*
*
*
* Atari 800 XL Emulator
*
* (c) 2004 Sascha Springer
*
* cmake -S . -B build
* cmake --build build -j
*
********************************************************************/

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <SDL2/SDL.h>

#include "6502.h"
#include "AtariIo.h"
#include "LibraryRepository.h"
#include "LibraryWindow.h"
#include "Pokey.h"

/* Global window handle — used by Pokey.c to update the title bar. */
SDL_Window *g_pSdlWindow = NULL;

static void A8E_LoadLibraryWorkspace(
	_6502_Context_t *pContext,
	const A8E_LibraryRepository_t *pRepository,
	u8 bCommandLineDisk)
{
	uint32_t lDrive;
	for(lDrive = 0; lDrive < 8u; lDrive++)
	{
		/* A positional ATR/XEX is an explicit D1: boot medium. Do not let
		 * the persisted D1: assignment replace it during workspace restore. */
		if(bCommandLineDisk && lDrive == 0u) continue;
		const char *pEntryId = A8E_LibraryRepository_GetDeviceEntryId(
			pRepository, lDrive);
		uint16_t sIndex;
		if(!pEntryId) continue;
		for(sIndex = 0; sIndex < pRepository->sRecordCount; sIndex++)
		{
			const A8E_LibraryRepositoryRecord_t *pRecord =
				A8E_LibraryRepository_GetRecord(pRepository, sIndex);
			const uint8_t *pBytes;
			uint32_t lSize;
			if(!pRecord || strcmp(pRecord->pId, pEntryId) != 0) continue;
			pBytes = A8E_LibraryRepository_GetPayload(pRepository, pRecord->pPath, &lSize);
			if(!pBytes || !AtariIoMountDisk(
				pContext, lDrive, pBytes, lSize, pRecord->pName,
				(uint8_t)!A8E_LibraryRepository_IsDeviceWriteProtected(
					pRepository, lDrive)))
			{
				fprintf(stderr, "A8E: failed to mount library entry %s in D%u:\n",
					pEntryId, lDrive + 1u);
			}
			break;
		}
	}
}

static int A8E_HelpRequested(int argc, char *argv[])
{
	int lIndex;
	for(lIndex = 1; lIndex < argc; lIndex++)
		if(strcmp(argv[lIndex], "-h") == 0 || strcmp(argv[lIndex], "--help") == 0)
			return 1;
	return 0;
}

static void A8E_PrintHelp(void)
{
	printf(
		"A8E Atari 800 XL emulator\n"
		"\n"
		"Usage:\n"
		"  A8E [options] [disk.atr|program.xex]\n"
		"\n"
		"Arguments and options:\n"
		"  disk.atr / program.xex  Boot the ATR image or XEX program.\n"
		"                            XEX files are converted to a temporary ATR.\n"
		"  -h, --help              Show this help and exit.\n"
		"  -f, -F                  Start in desktop fullscreen mode.\n"
		"  -b, -B                  Compatibility alias for the default BASIC boot.\n"
		"  -o, -O                  Simulate holding OPTION during OS startup.\n"
		"  --option-on-start       Same as -o: start with BASIC disabled.\n"
		"  -n, -N                  Start an NTSC machine. PAL is the default.\n"
		"  -d, -D                  Write audio diagnostics to a8e_audio_debug.csv.\n"
		"  -128K                   Enable the 128K 130XE memory expansion.\n"
		"  -192R                   Enable the 192K RAMBO memory expansion.\n"
		"  -256R                   Enable the 256K RAMBO memory expansion.\n"
		"  -320R                   Enable the 320K RAMBO memory expansion.\n"
		"  -320C                   Enable the 320K COMPY memory expansion.\n"
		"  -576R                   Enable the 576K RAMBO memory expansion.\n"
		"  -576C                   Enable the 576K COMPY memory expansion.\n"
		"  -1088R                  Enable the 1088K RAMBO memory expansion.\n"
		"  -U1MB                   Enable the Ultimate1MB memory model.\n"
		"\n"
		"Function and system keys:\n"
		"  F1                      Atari HELP key.\n"
		"  F2                      Atari OPTION key.\n"
		"  F3                      Atari SELECT key.\n"
		"  F4                      Atari START key.\n"
		"  F5                      Atari RESET key.\n"
		"  F9                      Toggle the floating Library window.\n"
		"  F11                     Hold for turbo mode; reload D1.ATR on press.\n"
		"  F12                     Start live CPU disassembly when enabled at build time.\n"
		"  Alt+Enter               Toggle fullscreen and windowed mode.\n"
		"  Alt+F4                  Close the emulator window.\n"
		"\n"
		"Library window (F9):\n"
		"  Type / Backspace        Filter the library by name; Backspace returns from ATR view.\n"
		"  Click D1: through D8:   Mount an entry, or unmount it when already selected.\n"
		"  Right-click a mounted  Toggle its write-protection state.\n"
		"  Click an ATR name       Open its read-only directory and geometry view.\n"
		"  Enter                   Preview the selected ATR file as text or hexadecimal.\n"
		"  D                       Download the selected ATR file to a typed path.\n"
		"  I                       Import an .a8e library package.\n"
		"  E                       Export the current library as an .a8e package.\n"
		"  N                       Create a blank writable ATR.\n"
		"  Delete                  Delete the selected unmounted library entry.\n"
		"  Esc                     Return from ATR view or close the Library window.\n"
		"\n"
		"The Library uses the application-owned library/ directory when present.\n");
}

/********************************************************************
*
*
* Funktionen
*
*
********************************************************************/

int main(int argc, char *argv[])
{
	_6502_Context_t *pAtariContext;
	SDL_Event tEvent;
	SDL_Window *pWindow = NULL;
	SDL_Renderer *pRenderer = NULL;
	SDL_Texture *pScreenTexture = NULL;
	SDL_Surface *pScreenSurface = NULL;
	u8 cTurboFlag = 0;
	u32 lLastTicks = 0;
	u32 lCounter;
	u32 lFramePeriodMs;
	u8 cDisassembleFlag = 0;
	u64 llCycles;
	u32 lMode = 0;
	AtariVideoStandard_t eVideoStandard = ATARI_VIDEO_PAL;
	AtariMemoryExpansion_t eMemoryExpansion = ATARI_MEMORY_NONE;
	char *pDiskFileName = "d1.atr";
	u32 lAtariScreenWidth = 336;
	u32 lAtariScreenHeight = 240;
	u32 lWindowWidth = 0;
	u32 lWindowHeight = 0;
	u32 lLogicalWidth;
	u32 lWindowScale = 2;
	u32 lFullscreen = 0;
	u8 bCommandLineDisk = 0;
	char cMemoryTitle[64];
	char cWindowTitle[160];
	A8E_LibraryRepository_t tLibraryRepository;
	A8E_LibraryWindow_t tLibraryWindow;
	int lIndex;
	if(A8E_HelpRequested(argc, argv))
	{
		A8E_PrintHelp();
		return 0;
	}
	A8E_LibraryRepository_Init(&tLibraryRepository);
	memset(&tLibraryWindow, 0, sizeof(tLibraryWindow));

	if(SDL_Init(SDL_INIT_VIDEO | SDL_INIT_TIMER) < 0)
	{
		fprintf(stderr, "SDL_Init() failed: %s\n", SDL_GetError());
		return -1;
	}

	for(lIndex = 1; lIndex < argc; lIndex++)
	{
		if(argv[lIndex][0] == '-')
		{
			if(strcmp(argv[lIndex], "--option-on-start") == 0)
			{
				lMode |= ATARI_MODE_OPTION_ON_START;
				continue;
			}
			if(strcmp(argv[lIndex], "-128K") == 0 || strcmp(argv[lIndex], "-128k") == 0)
			{
				eMemoryExpansion = ATARI_MEMORY_130XE_128K;
				continue;
			}
			if(strcmp(argv[lIndex], "-192R") == 0) { eMemoryExpansion = ATARI_MEMORY_RAMBO_192K; continue; }
			if(strcmp(argv[lIndex], "-256R") == 0) { eMemoryExpansion = ATARI_MEMORY_RAMBO_256K; continue; }
			if(strcmp(argv[lIndex], "-320R") == 0) { eMemoryExpansion = ATARI_MEMORY_RAMBO_320K; continue; }
			if(strcmp(argv[lIndex], "-320C") == 0) { eMemoryExpansion = ATARI_MEMORY_COMPY_320K; continue; }
			if(strcmp(argv[lIndex], "-576R") == 0) { eMemoryExpansion = ATARI_MEMORY_RAMBO_576K; continue; }
			if(strcmp(argv[lIndex], "-576C") == 0) { eMemoryExpansion = ATARI_MEMORY_COMPY_576K; continue; }
			if(strcmp(argv[lIndex], "-1088R") == 0) { eMemoryExpansion = ATARI_MEMORY_RAMBO_1088K; continue; }
			if(strcmp(argv[lIndex], "-U1MB") == 0) { eMemoryExpansion = ATARI_MEMORY_ULTIMATE1MB; continue; }
			switch(argv[lIndex][1])
			{
			case 'b':
			case 'B':
				/* Retained as a compatibility alias: BASIC is now the normal
				 * hardware state, so this option needs no runtime flag. */
				lMode &= ~ATARI_MODE_OPTION_ON_START;

				break;

			case 'o':
			case 'O':
				lMode |= ATARI_MODE_OPTION_ON_START;

				break;

			case 'f':
			case 'F':
				lFullscreen = 1;

				break;

			case 'n':
			case 'N':
				eVideoStandard = ATARI_VIDEO_NTSC;

				break;

			case 'd':
			case 'D':
				lMode |= 0x02;

				break;

			default:
				break;
			}
		}
		else
		{
			pDiskFileName = argv[lIndex];
			bCommandLineDisk = 1;
		}
	}

	/* Logical width applies the non-square pixel aspect without changing the
	   internal 456-pixel Atari line or the 336-pixel visible crop. */
	lLogicalWidth = eVideoStandard == ATARI_VIDEO_NTSC ? 288u : 350u;
	lWindowWidth = lLogicalWidth * lWindowScale;
	lWindowHeight = lAtariScreenHeight * lWindowScale;
	switch(eMemoryExpansion)
	{
	case ATARI_MEMORY_130XE_128K: strcpy(cMemoryTitle, "128K (130XE)"); break;
	case ATARI_MEMORY_RAMBO_192K: strcpy(cMemoryTitle, "192K (RAMBO)"); break;
	case ATARI_MEMORY_RAMBO_256K: strcpy(cMemoryTitle, "256K (RAMBO)"); break;
	case ATARI_MEMORY_RAMBO_320K: strcpy(cMemoryTitle, "320K (RAMBO)"); break;
	case ATARI_MEMORY_COMPY_320K: strcpy(cMemoryTitle, "320K (COMPY)"); break;
	case ATARI_MEMORY_RAMBO_576K: strcpy(cMemoryTitle, "576K (RAMBO)"); break;
	case ATARI_MEMORY_COMPY_576K: strcpy(cMemoryTitle, "576K (COMPY)"); break;
	case ATARI_MEMORY_RAMBO_1088K: strcpy(cMemoryTitle, "1088K (RAMBO)"); break;
	case ATARI_MEMORY_ULTIMATE1MB: strcpy(cMemoryTitle, "Ultimate1MB (1088K)"); break;
	default: strcpy(cMemoryTitle, "64K"); break;
	}
	snprintf(cWindowTitle, sizeof(cWindowTitle), "%s - %s - %s",
		APPLICATION_CAPTION, cMemoryTitle,
		eVideoStandard == ATARI_VIDEO_NTSC ? "NTSC" : "PAL");

	/* SDL_WINDOW_FULLSCREEN_DESKTOP scales to desktop resolution without
	   changing the video mode, so the aspect ratio is correct on all
	   monitors and the desktop is never left in a bad resolution if the
	   app crashes. */
	pWindow = SDL_CreateWindow(cWindowTitle,
							   SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED,
							   (int)lWindowWidth, (int)lWindowHeight,
							   lFullscreen ? SDL_WINDOW_FULLSCREEN_DESKTOP : 0);

	if(pWindow == NULL)
	{
		fprintf(stderr, "SDL_CreateWindow() failed: %s\n", SDL_GetError());
		SDL_Quit();
		return -1;
	}

	g_pSdlWindow = pWindow;

	pRenderer = SDL_CreateRenderer(pWindow, -1, SDL_RENDERER_ACCELERATED | SDL_RENDERER_PRESENTVSYNC);
	if(pRenderer == NULL)
	{
		pRenderer = SDL_CreateRenderer(pWindow, -1, 0);
	}
	if(pRenderer == NULL)
	{
		fprintf(stderr, "SDL_CreateRenderer() failed: %s\n", SDL_GetError());
		SDL_DestroyWindow(pWindow);
		SDL_Quit();
		return -1;
	}

	/* Logical size lets the renderer scale the Atari output to fill the
	   window (or screen in fullscreen) while preserving the aspect ratio. */
	SDL_RenderSetLogicalSize(pRenderer, (int)lLogicalWidth, (int)lAtariScreenHeight);

	pScreenTexture = SDL_CreateTexture(pRenderer, SDL_PIXELFORMAT_ARGB8888,
									   SDL_TEXTUREACCESS_STREAMING, (int)lAtariScreenWidth, (int)lAtariScreenHeight);
	if(pScreenTexture == NULL)
	{
		fprintf(stderr, "SDL_CreateTexture() failed: %s\n", SDL_GetError());
		SDL_DestroyRenderer(pRenderer);
		SDL_DestroyWindow(pWindow);
		SDL_Quit();
		return -1;
	}

	/* Software surface — AtariIoDrawScreen draws the Atari output here,
	   then we upload it to pScreenTexture each frame. */
	pScreenSurface = SDL_CreateRGBSurface(0,
										  (int)lAtariScreenWidth, (int)lAtariScreenHeight, 32,
										  0x00FF0000, 0x0000FF00, 0x000000FF, 0xFF000000);
	if(pScreenSurface == NULL)
	{
		fprintf(stderr, "SDL_CreateRGBSurface() failed: %s\n", SDL_GetError());
		SDL_DestroyTexture(pScreenTexture);
		SDL_DestroyRenderer(pRenderer);
		SDL_DestroyWindow(pWindow);
		SDL_Quit();
		return -1;
	}

	_6502_Init();

	pAtariContext = _6502_Open();
	AtariIoOpenWithMemory(pAtariContext, lMode, pDiskFileName, eVideoStandard, eMemoryExpansion);
	{
		FILE *pLibraryManifest = fopen("library/library.json", "rb");
		if(pLibraryManifest)
		{
			char sError[160];
			fclose(pLibraryManifest);
			if(A8E_LibraryRepository_LoadDirectory(
				&tLibraryRepository, "library", sError, sizeof(sError)))
			{
				A8E_LoadLibraryWorkspace(
					pAtariContext, &tLibraryRepository, bCommandLineDisk);
			}
			else fprintf(stderr, "A8E: library load skipped: %s\n", sError);
		}
	}
	printf("A8E memory: opened %s\n", cMemoryTitle);
	A8E_LibraryWindow_Init(&tLibraryWindow, pAtariContext, &tLibraryRepository);
	if(bCommandLineDisk)
	{
		/* The command-line medium is outside the library repository. Keep it
		 * out of the library panel's mounted-entry bookkeeping as well. */
		tLibraryWindow.acMountedIds[0][0] = '\0';
	}
	llCycles = CYCLES_PER_LINE *
		(eVideoStandard == ATARI_VIDEO_NTSC ? LINES_PER_SCREEN_NTSC : LINES_PER_SCREEN_PAL);
	{
		u32 lCpuHz = eVideoStandard == ATARI_VIDEO_NTSC
			? ATARI_CPU_HZ_NTSC
			: ATARI_CPU_HZ_PAL;
		/* Rounded frame period used only when audio cannot provide throttling. */
		lFramePeriodMs = (u32)((llCycles * 1000u + lCpuHz / 2u) / lCpuHz);
	}

	_6502_Reset(pAtariContext);

	while(1)
	{
		if(cDisassembleFlag)
		{
			lCounter = (u32)(llCycles / 3);

			while(lCounter)
			{
				_6502_Run(pAtariContext, pAtariContext->llCycleCounter + 1);

				_6502_Status(pAtariContext);
				printf(" ");
				_6502_DisassembleLive(pAtariContext, pAtariContext->tCpu.pc);

				lCounter--;
			}
		}
		else
		{
			_6502_Run(pAtariContext, llCycles);

			llCycles += CYCLES_PER_LINE *
				(eVideoStandard == ATARI_VIDEO_NTSC ? LINES_PER_SCREEN_NTSC : LINES_PER_SCREEN_PAL);
		}
		AtariIoDrawScreen(pAtariContext, pScreenSurface, lAtariScreenWidth, lAtariScreenHeight);

		SDL_UpdateTexture(pScreenTexture, NULL, pScreenSurface->pixels, pScreenSurface->pitch);
		SDL_RenderClear(pRenderer);
		SDL_RenderCopy(pRenderer, pScreenTexture, NULL, NULL);
		SDL_RenderPresent(pRenderer);
		A8E_LibraryWindow_Draw(&tLibraryWindow);
		Pokey_DebugFrame(pAtariContext);

		while(SDL_PollEvent(&tEvent))
		{
			if(A8E_LibraryWindow_HandleEvent(&tLibraryWindow, &tEvent)) continue;
			if(tEvent.type == SDL_QUIT ||
			   (tEvent.type == SDL_WINDOWEVENT &&
				tEvent.window.event == SDL_WINDOWEVENT_CLOSE &&
				tEvent.window.windowID == SDL_GetWindowID(pWindow)))
			{
				goto Exit;
			}

			if(tEvent.type == SDL_KEYDOWN)
			{
				if(tEvent.key.keysym.sym == SDLK_F9 && tEvent.key.repeat == 0)
				{
					A8E_LibraryWindow_Toggle(&tLibraryWindow);
					continue;
				}
				if(tEvent.key.keysym.sym == SDLK_F11)
				{
					cTurboFlag = 1;
				}

				/* Alt+Enter toggles fullscreen at runtime. */
				if(tEvent.key.keysym.sym == SDLK_RETURN &&
				   (tEvent.key.keysym.mod & KMOD_ALT) &&
				   tEvent.key.repeat == 0)
				{
					Uint32 flags = SDL_GetWindowFlags(pWindow);
					SDL_SetWindowFullscreen(pWindow,
											(flags & SDL_WINDOW_FULLSCREEN_DESKTOP)
												? 0
												: SDL_WINDOW_FULLSCREEN_DESKTOP);
				}

#ifdef ENABLE_VERBOSE_DEBUGGING
				if(tEvent.key.keysym.sym == SDLK_F12)
				{
					cDisassembleFlag = 1;
				}
#endif
			}

			if(tEvent.type == SDL_KEYUP)
			{
				if(tEvent.key.keysym.sym == SDLK_F11)
				{
					cTurboFlag = 0;
				}
			}

			if((tEvent.type == SDL_KEYDOWN || tEvent.type == SDL_KEYUP) &&
				tEvent.key.windowID == SDL_GetWindowID(pWindow))
			{
				AtariIoKeyboardEvent(pAtariContext, &tEvent.key);
			}
		}

		if(!cTurboFlag)
		{
			/* Audio-driven timing: wait while audio buffer is sufficiently full.
			   This keeps emulation in sync with audio playback rate. */
			u32 throttleStart = SDL_GetTicks();
			int didThrottle = 0;

			while(Pokey_ShouldThrottle(pAtariContext))
			{
				/* Audio buffer is filling up - let it drain. */
				SDL_PumpEvents();
				SDL_Delay(1);
				didThrottle = 1;

				/* Safety net: never stall the main loop indefinitely. */
				if((SDL_GetTicks() - throttleStart) > 250)
				{
					break;
				}
			}

			/* Fallback only when audio is unavailable. When SDL is playing, the
			   audio ring buffer is the clock; an extra frame delay can starve it. */
			if(!didThrottle && SDL_GetAudioStatus() != SDL_AUDIO_PLAYING)
			{
				u32 elapsed = SDL_GetTicks() - lLastTicks;
				if(elapsed < lFramePeriodMs)
				{
					SDL_Delay(lFramePeriodMs - elapsed);
				}
			}
		}

		lLastTicks = SDL_GetTicks();
	}

Exit:
	A8E_LibraryWindow_SaveDirty(&tLibraryWindow);
	A8E_LibraryWindow_Free(&tLibraryWindow);
	A8E_LibraryRepository_Free(&tLibraryRepository);
	AtariIoClose(pAtariContext);
	_6502_Close(pAtariContext);
	SDL_FreeSurface(pScreenSurface);
	SDL_DestroyTexture(pScreenTexture);
	SDL_DestroyRenderer(pRenderer);
	SDL_DestroyWindow(pWindow);
	SDL_Quit();

	return 0;
}
