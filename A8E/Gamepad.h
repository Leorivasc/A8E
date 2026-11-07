#ifndef A8E_GAMEPAD_H
#define A8E_GAMEPAD_H

#include <SDL2/SDL.h>

#include "6502.h"

/* Direction bits use the PORTA layout, so they can be applied directly. */
#define GAMEPAD_UP 0x01
#define GAMEPAD_DOWN 0x02
#define GAMEPAD_LEFT 0x04
#define GAMEPAD_RIGHT 0x08

/* Starts the SDL joystick subsystem. A failure is reported and ignored: the
 * emulator keeps working with the keyboard only. */
void Gamepad_Init(void);

/* Opens and closes joysticks on SDL_JOYDEVICEADDED / SDL_JOYDEVICEREMOVED.
 * Other events are ignored. */
void Gamepad_HandleEvent(const SDL_Event *pEvent);

/* Combined state of every open joystick: returns the GAMEPAD_* direction bits
 * (left stick or hat) and sets *pFire when any of buttons 0-3 is pressed. */
u8 Gamepad_Poll(u8 *pFire);

void Gamepad_Shutdown(void);

/* Pure helper behind Gamepad_Poll: stick axes (SDL range) and an SDL_HAT_*
 * mask to GAMEPAD_* bits. Opposite directions cancel each other. */
u8 Gamepad_DirectionsFromInputs(s16 sAxisX, s16 sAxisY, u8 cHat);

#endif
