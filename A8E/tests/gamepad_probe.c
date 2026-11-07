#include <stdio.h>
#include <string.h>

#include <SDL2/SDL.h>

#include "6502.h"
#include "AtariIo.h"
#include "Gamepad.h"
#include "Gtia.h"
#include "Pia.h"

SDL_Window *g_pSdlWindow = NULL;

static int g_lFailures = 0;

static void Expect(int bCondition, const char *pMessage)
{
	if(!bCondition)
	{
		fprintf(stderr, "FAILED: %s\n", pMessage);
		g_lFailures++;
	}
}

static void SendKey(_6502_Context_t *pContext, Uint32 lType, SDL_Keycode sKey)
{
	SDL_KeyboardEvent tEvent;

	memset(&tEvent, 0, sizeof(tEvent));
	tEvent.type = lType;
	tEvent.keysym.sym = sKey;
	AtariIoKeyboardEvent(pContext, &tEvent);
}

static void TestMapping(void)
{
	Expect(Gamepad_DirectionsFromInputs(0, 0, 0) == 0, "idle pad reports nothing");
	Expect(Gamepad_DirectionsFromInputs(-32768, 0, 0) == GAMEPAD_LEFT, "axis left");
	Expect(Gamepad_DirectionsFromInputs(32767, 0, 0) == GAMEPAD_RIGHT, "axis right");
	Expect(Gamepad_DirectionsFromInputs(0, -32768, 0) == GAMEPAD_UP, "axis up");
	Expect(Gamepad_DirectionsFromInputs(0, 32767, 0) == GAMEPAD_DOWN, "axis down");
	Expect(Gamepad_DirectionsFromInputs(16384, -16384, 0) == 0, "half deflection is inside the dead zone");
	Expect(Gamepad_DirectionsFromInputs(16385, 0, 0) == GAMEPAD_RIGHT, "just past the dead zone");
	Expect(Gamepad_DirectionsFromInputs(0, 0, SDL_HAT_UP) == GAMEPAD_UP, "hat up");
	Expect(Gamepad_DirectionsFromInputs(0, 0, SDL_HAT_RIGHTDOWN) == (GAMEPAD_RIGHT | GAMEPAD_DOWN), "hat diagonal");
	Expect(Gamepad_DirectionsFromInputs(-32768, 0, SDL_HAT_RIGHT) == 0, "stick and hat in opposite directions cancel");
	Expect(Gamepad_DirectionsFromInputs(0, 0, SDL_HAT_LEFTUP) == (GAMEPAD_LEFT | GAMEPAD_UP), "hat other diagonal");
	/* PORTA layout the emulator expects: up 1, down 2, left 4, right 8. */
	Expect(GAMEPAD_UP == 0x01 && GAMEPAD_DOWN == 0x02 && GAMEPAD_LEFT == 0x04 && GAMEPAD_RIGHT == 0x08,
		   "direction bits match PORTA");
}

static void TestMachine(_6502_Context_t *pContext)
{
	u8 *pRam = pContext->pMemory;

	pRam[IO_PORTA] = 0x0f;
	pRam[IO_GRAFP3_TRIG0] = 1;

	/* An idle pad changes nothing. */
	AtariIoGamepadState(pContext, 0, 0);
	Expect(pRam[IO_PORTA] == 0x0f && pRam[IO_GRAFP3_TRIG0] == 1, "idle pad leaves PORTA and TRIG0 alone");

	/* Left + fire, repeated every frame, then released. */
	AtariIoGamepadState(pContext, GAMEPAD_LEFT, 1);
	AtariIoGamepadState(pContext, GAMEPAD_LEFT, 1);
	Expect((pRam[IO_PORTA] & 0x0f) == 0x0b, "left pulls PORTA bit 2 low");
	Expect(pRam[IO_GRAFP3_TRIG0] == 0, "fire pulls TRIG0 low");
	AtariIoGamepadState(pContext, GAMEPAD_UP, 1);
	Expect((pRam[IO_PORTA] & 0x0f) == 0x0e, "moving from left to up releases left and presses up");
	AtariIoGamepadState(pContext, 0, 0);
	Expect((pRam[IO_PORTA] & 0x0f) == 0x0f && pRam[IO_GRAFP3_TRIG0] == 1, "release returns PORTA and TRIG0 to idle");

	/* A keyboard direction survives an idle pad and a pad press/release. */
	SendKey(pContext, SDL_KEYDOWN, SDLK_RIGHT);
	Expect((pRam[IO_PORTA] & 0x0f) == 0x07, "keyboard right pulls PORTA bit 3 low");
	AtariIoGamepadState(pContext, 0, 0);
	Expect((pRam[IO_PORTA] & 0x0f) == 0x07, "an idle pad does not release the keyboard direction");
	AtariIoGamepadState(pContext, GAMEPAD_RIGHT, 0);
	AtariIoGamepadState(pContext, 0, 0);
	Expect((pRam[IO_PORTA] & 0x0f) == 0x07, "releasing the pad keeps the key-held direction pressed");
	SendKey(pContext, SDL_KEYUP, SDLK_RIGHT);
	Expect((pRam[IO_PORTA] & 0x0f) == 0x0f, "releasing the key releases the direction");

	/* A pad direction survives a key release of the same direction. */
	AtariIoGamepadState(pContext, GAMEPAD_DOWN, 0);
	SendKey(pContext, SDL_KEYDOWN, SDLK_DOWN);
	SendKey(pContext, SDL_KEYUP, SDLK_DOWN);
	AtariIoGamepadState(pContext, GAMEPAD_DOWN, 0); /* next frame re-asserts the held pad */
	Expect((pRam[IO_PORTA] & 0x0f) == 0x0d, "a held pad direction is re-asserted on the next frame");
	AtariIoGamepadState(pContext, 0, 0);
	Expect((pRam[IO_PORTA] & 0x0f) == 0x0f, "pad release finally frees the direction");

	/* Bits above the direction nibble are never touched. */
	pRam[IO_PORTA] = 0xf0;
	AtariIoGamepadState(pContext, GAMEPAD_UP | GAMEPAD_RIGHT, 0);
	AtariIoGamepadState(pContext, 0, 0);
	Expect((pRam[IO_PORTA] & 0xf0) == 0xf0, "upper PORTA bits (joystick 2) stay as they were");
}

static void PumpGamepadEvents(void)
{
	SDL_Event tEvent;

	SDL_PumpEvents();
	while(SDL_PollEvent(&tEvent)) Gamepad_HandleEvent(&tEvent);
}

/* The emulator loop pumps events every frame, which refreshes joystick state. */
static u8 PollAfterPump(u8 *pFire)
{
	SDL_PumpEvents();
	return Gamepad_Poll(pFire);
}

/* Exercises the real SDL path with a virtual joystick (SDL 2.0.14 or newer). */
static void TestSdlDevice(void)
{
#if SDL_VERSION_ATLEAST(2, 0, 14)
	SDL_Joystick *pJoystick;
	u8 cFire = 1;
	int lDevice;

	Gamepad_Init();
	lDevice = SDL_JoystickAttachVirtual(SDL_JOYSTICK_TYPE_GAMECONTROLLER, 2, 4, 1);
	if(lDevice < 0)
	{
		printf("gamepad_probe: virtual joystick unavailable (%s), SDL device test skipped\n", SDL_GetError());
		return;
	}
	PumpGamepadEvents();
	pJoystick = SDL_JoystickOpen(lDevice); /* same handle that Gamepad opened */
	Expect(pJoystick != NULL, "virtual joystick opens");
	if(!pJoystick) return;

	Expect(PollAfterPump(&cFire) == 0 && cFire == 0, "a connected idle joystick reports nothing");

	SDL_JoystickSetVirtualAxis(pJoystick, 0, -32768);
	SDL_JoystickSetVirtualButton(pJoystick, 2, 1);
	Expect(PollAfterPump(&cFire) == GAMEPAD_LEFT && cFire == 1, "stick left and button 2 fire");
	SDL_JoystickSetVirtualAxis(pJoystick, 0, 0);
	SDL_JoystickSetVirtualButton(pJoystick, 2, 0);
	SDL_JoystickSetVirtualHat(pJoystick, 0, SDL_HAT_UP);
	Expect(PollAfterPump(&cFire) == GAMEPAD_UP && cFire == 0, "hat up");
	SDL_JoystickSetVirtualHat(pJoystick, 0, SDL_HAT_CENTERED);
	SDL_JoystickSetVirtualAxis(pJoystick, 1, 32767);
	Expect(PollAfterPump(&cFire) == GAMEPAD_DOWN, "stick down");

	/* Unplugging while a direction is held must release it. */
	SDL_JoystickClose(pJoystick);
	SDL_JoystickDetachVirtual(lDevice);
	PumpGamepadEvents();
	Expect(PollAfterPump(&cFire) == 0 && cFire == 0, "a disconnected joystick reports nothing");
#else
	printf("gamepad_probe: SDL too old for virtual joysticks, SDL device test skipped\n");
#endif
}

int main(void)
{
	_6502_Context_t *pContext = _6502_Open();

	if(!pContext)
	{
		fprintf(stderr, "could not open gamepad probe machine\n");
		return 1;
	}
	AtariIoOpen(pContext, 0, NULL, ATARI_VIDEO_NTSC);

	TestMapping();
	TestMachine(pContext);
	TestSdlDevice();
	Gamepad_Shutdown();

	AtariIoClose(pContext);
	_6502_Close(pContext);

	if(g_lFailures)
	{
		fprintf(stderr, "gamepad_probe: %d failure(s)\n", g_lFailures);
		return 1;
	}
	printf("gamepad_probe passed\n");
	return 0;
}
