#include "Gamepad.h"

#include <stdio.h>

/* Physical joystick support through the SDL joystick API. It needs no
 * controller mapping database, so plain USB joysticks work too: axes 0 and 1
 * (or the first hat) move, and any of buttons 0-3 fires. */

#define GAMEPAD_MAX 4
#define GAMEPAD_AXIS_THRESHOLD 16384 /* half of the SDL axis range */
#define GAMEPAD_FIRE_BUTTONS 4

static SDL_Joystick *g_apJoysticks[GAMEPAD_MAX];

/* Opposite directions cancel each other, as on a real joystick. */
static u8 CancelOpposites(u8 cDirections)
{
	if((cDirections & (GAMEPAD_UP | GAMEPAD_DOWN)) == (GAMEPAD_UP | GAMEPAD_DOWN))
	{
		cDirections &= (u8)~(GAMEPAD_UP | GAMEPAD_DOWN);
	}
	if((cDirections & (GAMEPAD_LEFT | GAMEPAD_RIGHT)) == (GAMEPAD_LEFT | GAMEPAD_RIGHT))
	{
		cDirections &= (u8)~(GAMEPAD_LEFT | GAMEPAD_RIGHT);
	}

	return cDirections;
}

u8 Gamepad_DirectionsFromInputs(s16 sAxisX, s16 sAxisY, u8 cHat)
{
	u8 cDirections = 0;

	if(sAxisY < -GAMEPAD_AXIS_THRESHOLD || (cHat & SDL_HAT_UP)) cDirections |= GAMEPAD_UP;
	if(sAxisY > GAMEPAD_AXIS_THRESHOLD || (cHat & SDL_HAT_DOWN)) cDirections |= GAMEPAD_DOWN;
	if(sAxisX < -GAMEPAD_AXIS_THRESHOLD || (cHat & SDL_HAT_LEFT)) cDirections |= GAMEPAD_LEFT;
	if(sAxisX > GAMEPAD_AXIS_THRESHOLD || (cHat & SDL_HAT_RIGHT)) cDirections |= GAMEPAD_RIGHT;

	return CancelOpposites(cDirections);
}

void Gamepad_Init(void)
{
	if(SDL_InitSubSystem(SDL_INIT_JOYSTICK) < 0)
	{
		fprintf(stderr, "A8E gamepad: SDL joystick init failed: %s\n", SDL_GetError());
	}
}

void Gamepad_HandleEvent(const SDL_Event *pEvent)
{
	int lIndex;

	if(pEvent->type == SDL_JOYDEVICEADDED)
	{
		/* SDL also reports the joysticks that are already plugged in at start. */
		for(lIndex = 0; lIndex < GAMEPAD_MAX; lIndex++)
		{
			if(!g_apJoysticks[lIndex])
			{
				g_apJoysticks[lIndex] = SDL_JoystickOpen(pEvent->jdevice.which);
				if(g_apJoysticks[lIndex])
				{
					printf("A8E gamepad: connected %s\n", SDL_JoystickName(g_apJoysticks[lIndex]));
				}
				break;
			}
		}
	}
	else if(pEvent->type == SDL_JOYDEVICEREMOVED)
	{
		for(lIndex = 0; lIndex < GAMEPAD_MAX; lIndex++)
		{
			if(g_apJoysticks[lIndex] &&
			   SDL_JoystickInstanceID(g_apJoysticks[lIndex]) == pEvent->jdevice.which)
			{
				SDL_JoystickClose(g_apJoysticks[lIndex]);
				g_apJoysticks[lIndex] = NULL;
				printf("A8E gamepad: disconnected\n");
				break;
			}
		}
	}
}

u8 Gamepad_Poll(u8 *pFire)
{
	u8 cDirections = 0;
	u8 cFire = 0;
	int lIndex;
	int lButton;

	for(lIndex = 0; lIndex < GAMEPAD_MAX; lIndex++)
	{
		SDL_Joystick *pJoystick = g_apJoysticks[lIndex];
		s16 sAxisX = 0;
		s16 sAxisY = 0;
		u8 cHat = 0;

		if(!pJoystick) continue;
		if(SDL_JoystickNumAxes(pJoystick) >= 2)
		{
			sAxisX = SDL_JoystickGetAxis(pJoystick, 0);
			sAxisY = SDL_JoystickGetAxis(pJoystick, 1);
		}
		if(SDL_JoystickNumHats(pJoystick) > 0) cHat = SDL_JoystickGetHat(pJoystick, 0);
		cDirections |= Gamepad_DirectionsFromInputs(sAxisX, sAxisY, cHat);

		for(lButton = 0; lButton < GAMEPAD_FIRE_BUTTONS && lButton < SDL_JoystickNumButtons(pJoystick); lButton++)
		{
			if(SDL_JoystickGetButton(pJoystick, lButton)) cFire = 1;
		}
	}

	/* Pads are merged above, so opposite directions from two pads cancel too. */
	cDirections = CancelOpposites(cDirections);

	*pFire = cFire;
	return cDirections;
}

void Gamepad_Shutdown(void)
{
	int lIndex;

	for(lIndex = 0; lIndex < GAMEPAD_MAX; lIndex++)
	{
		if(g_apJoysticks[lIndex])
		{
			SDL_JoystickClose(g_apJoysticks[lIndex]);
			g_apJoysticks[lIndex] = NULL;
		}
	}
}
