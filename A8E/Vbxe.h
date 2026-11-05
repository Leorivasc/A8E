/********************************************************************
*
* VBXE (VideoBoard XE) device - native core, stage 1
*
* Implements the register bank, 512 KiB VRAM, palette latches, MEMAC A/B
* windows (CPU, ANTIC and instruction fetch), the blitter with its
* completion IRQ and the per-scanline local-bus budget. The XDL, overlay,
* attribute map and the video compositor are not implemented yet; the
* device therefore never changes the picture. See
* implementation/VBXE_ROADMAP.md and AHRM 12.4.
*
* The behavior follows jsA8E (jsA8E/js/core/vbxe.js), which in turn follows
* AHRM 12.4 and Altirra 4.40 where the AHRM prose and real software differ.
*
********************************************************************/

#ifndef _VBXE_H_
#define _VBXE_H_

#include "6502.h"

#define VBXE_VRAM_SIZE (512u * 1024u)
#define VBXE_VRAM_MASK (VBXE_VRAM_SIZE - 1u)
#define VBXE_LOCAL_BUS_SLOTS (114u * 8u)
#define VBXE_REGISTER_COUNT 0x20u
#define VBXE_PAGE_D6 0xd640u
#define VBXE_PAGE_D7 0xd740u

typedef enum
{
	VBXE_PROFILE_OFF = 0,
	VBXE_PROFILE_FX120,
	VBXE_PROFILE_FX124,
	VBXE_PROFILE_FX126
} VbxeProfile_t;

typedef struct
{
	u32 lBlockAddress;
	/* Local cycles still needed to load the 21-byte BCB while loading. */
	u32 lLoadCyclesRemaining;
	u32 lSource;
	s32 lSourceYStep;
	s32 lSourceXStep;
	u32 lDestination;
	s32 lDestinationYStep;
	s32 lDestinationXStep;
	u32 lWidth;
	u32 lHeight;
	u8 cDataAnd;
	u8 cDataXor;
	u8 cCollisionMask;
	u8 cZoomX;
	u8 cZoomY;
	u8 bPatternEnabled;
	u8 cPatternWidth;
	u8 cMode;
	u8 bNext;
	u8 bConstantFetchPending;
	u32 lX;
	u32 lY;
	u8 cRepeatX;
	u8 cRepeatY;
} VbxeBlitter_t;

typedef struct
{
	u8 bEnabled;
	VbxeProfile_t eProfile;
	u16 sPage;
	u8 *pVram;
	u8 aPalette[4 * 256 * 3];
	u8 cVideoControlPending;
	u8 cVideoControlActive;
	u32 lXdlAddressPending;
	u32 lXdlAddressActive;
	u8 cColorSelect;
	u8 cPaletteSelect;
	u8 cCollisionMask;
	u8 cCollisionDetect;
	u32 lBlitAddress;
	u8 cBlitCollisionCode;
	/* 0 idle, 1 loading the BCB, 2 processing data (BLITTER_BUSY bits). */
	u8 cBlitterBusy;
	VbxeBlitter_t tBlit;
	u8 cIrqStatus;
	u8 cIrqControl;
	u8 bBlitterIrqPending;
	u8 bBlitterIrqScheduled;
	u32 lBlitterIrqResidual;
	/* BLITTER_START already ran this line's budget (see StartMidLine). */
	u8 bBlitterEarlyRun;
	/* Local-bus slots MEMAC used in the current scanline. */
	u32 lMemacSlots;
	u8 cPriority[4];
	u8 cMemacBControl;
	u8 cMemacControl;
	u8 cMemacBankSelect;
	u8 cConfigLatch;
	u8 cRegisterValue;
	/* Per address: 1 when this device installed its MEMAC handler there. */
	u8 *pWindowInstalled;
	/* Per address: 1 when the CPU fetches instructions from VRAM there. */
	u8 *pFetchWindow;
	u8 bAnyFetchWindow;
	/* Routing state the installed windows were built for (0 = none yet). */
	u32 lWindowKey;
	u8 aFetchSave[3];
} Vbxe_t;

Vbxe_t *Vbxe_Create(VbxeProfile_t eProfile, u16 sPage);
void Vbxe_Free(Vbxe_t *pVbxe);
VbxeProfile_t Vbxe_ParseProfile(const char *pName);

/* Installs the register, MEMAC and strobe handlers on the CPU bus. */
void Vbxe_Attach(_6502_Context_t *pContext);
/* Re-evaluates the MEMAC windows when the registers changed their routing. */
void Vbxe_SyncWindows(_6502_Context_t *pContext);
/* Same, but unconditionally: ROM/RAM mapping changed under the windows. */
void Vbxe_RebuildWindows(_6502_Context_t *pContext);

void Vbxe_SoftReset(Vbxe_t *pVbxe);
void Vbxe_VerticalSync(Vbxe_t *pVbxe);

/* VRAM address for a CPU or ANTIC request, or -1 when MEMAC does not claim it. */
s32 Vbxe_MemacAddress(const Vbxe_t *pVbxe, u16 sAddress, u8 bAntic);

/* Level-sensitive IRQ line (AHRM 5.7 / 12.4). */
u8 Vbxe_IrqAsserted(const Vbxe_t *pVbxe);

/* Runs the end-of-scanline blitter budget. Returns the local slots left in
 * the line when a completion IRQ was scheduled (for its position), or -1. */
s32 Vbxe_EndOfLine(Vbxe_t *pVbxe);
/* Runs the rest of the current scanline's budget at BLITTER_START. */
s32 Vbxe_StartBlitterMidLine(Vbxe_t *pVbxe, u32 lSlotsLeftInLine);
/* Raises a completion IRQ placed inside the line; returns 1 if raised. */
u8 Vbxe_RaiseScheduledIrq(Vbxe_t *pVbxe);

#endif
