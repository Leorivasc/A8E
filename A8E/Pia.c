/********************************************************************
*
*
*
* PIA
*
* (c) 2004 Sascha Springer
*
*
*
*
********************************************************************/

#include <string.h>

#include "6502.h"
#include "AtariIo.h"
#include "Pia.h"
#include "Pokey.h"

#define PIA_IRQ1_STATUS 0x80
#define PIA_IRQ2_STATUS 0x40

static u8 Pia_ControlMode(u8 cControl)
{
	return (u8)((cControl >> 3) & 0x07);
}

static u8 Pia_PokeyIrqAsserted(_6502_Context_t *pContext)
{
	return (u8)((~RAM[IO_IRQEN_IRQST] & SRAM[IO_IRQEN_IRQST] & 0x7f) != 0);
}

u8 Pia_IrqAsserted(_6502_Context_t *pContext)
{
	IoData_t *pIoData = (IoData_t *)pContext->pIoData;
	u8 cModeA = Pia_ControlMode(SRAM[IO_PACTL]);
	u8 cModeB = Pia_ControlMode(SRAM[IO_PBCTL]);
	u8 bIrqA = (u8)(((pIoData->cPiaStatusA & PIA_IRQ1_STATUS) && (SRAM[IO_PACTL] & 0x01)) ||
		((pIoData->cPiaStatusA & PIA_IRQ2_STATUS) && cModeA < 4 && (cModeA & 0x01)));
	u8 bIrqB = (u8)(((pIoData->cPiaStatusB & PIA_IRQ1_STATUS) && (SRAM[IO_PBCTL] & 0x01)) ||
		((pIoData->cPiaStatusB & PIA_IRQ2_STATUS) && cModeB < 4 && (cModeB & 0x01)));

	return (u8)(bIrqA || bIrqB);
}

static void Pia_ReconcileIrq(_6502_Context_t *pContext)
{
	_6502_ReconcileIrq(pContext, (u8)(Pia_PokeyIrqAsserted(pContext) ||
		Pia_IrqAsserted(pContext)));
}

static void Pia_UpdateControlReadback(_6502_Context_t *pContext, u16 sAddress)
{
	IoData_t *pIoData = (IoData_t *)pContext->pIoData;
	if(sAddress == IO_PACTL)
		RAM[IO_PACTL] = (u8)((SRAM[IO_PACTL] & 0x3f) | (pIoData->cPiaStatusA & 0xc0));
	else
		RAM[IO_PBCTL] = (u8)((SRAM[IO_PBCTL] & 0x3f) | (pIoData->cPiaStatusB & 0xc0));
}

static void Pia_LatchLineTransition(
	_6502_Context_t *pContext,
	u8 *pLevel,
	u8 *pStatus,
	u8 cControl,
	u8 bControlLine2,
	u16 sControlAddress,
	u8 cLevel)
{
	u8 cOldLevel = *pLevel;
	u8 cMode = Pia_ControlMode(cControl);
	u8 bPositive = (u8)(cLevel > cOldLevel);
	u8 bEdgePositive = (u8)(bControlLine2 ? (cMode >= 2) : ((cControl & 0x02) != 0));

	*pLevel = cLevel ? 1 : 0;
	if(cOldLevel == *pLevel)
		return;

	if(bControlLine2)
	{
		if(cMode < 4 && bPositive == bEdgePositive)
			*pStatus |= PIA_IRQ2_STATUS;
	}
	else if(bPositive == bEdgePositive)
	{
		*pStatus |= PIA_IRQ1_STATUS;
	}

	Pia_UpdateControlReadback(pContext, sControlAddress);
	if(bControlLine2 ? (cMode < 4 && (cMode & 0x01)) : (cControl & 0x01))
		_6502_Irq(pContext);
}

static void Pia_WriteControl(_6502_Context_t *pContext, u16 sAddress, u8 cValue)
{
	IoData_t *pIoData = (IoData_t *)pContext->pIoData;
	u8 *pStatus = sAddress == IO_PACTL ? &pIoData->cPiaStatusA : &pIoData->cPiaStatusB;
	u8 *pLevel = sAddress == IO_PACTL ? &pIoData->cPiaCa2Level : &pIoData->cPiaCb2Level;
	u8 cOldControl = SRAM[sAddress];
	u8 cOldMode = Pia_ControlMode(cOldControl);
	u8 cNewMode = Pia_ControlMode(cValue);

	SRAM[sAddress] = cValue & 0x3f;
	if(cNewMode >= 4)
		*pStatus &= (u8)~PIA_IRQ2_STATUS;

	/* AHRM 2.5 documents the CA2/CB2 input-mode transition glitches. */
	if(sAddress == IO_PACTL && cOldMode == 6 && cNewMode >= 2 && cNewMode <= 3 &&
	   *pLevel == 0)
		*pStatus |= PIA_IRQ2_STATUS;
	if(sAddress == IO_PBCTL && cOldMode == 7 && cNewMode < 4 &&
	   pIoData->bPiaCb2WasRaisedOutput)
		*pStatus |= PIA_IRQ2_STATUS;

	if(cNewMode >= 4)
	{
		*pLevel = (u8)(cNewMode == 7);
		if(sAddress != IO_PACTL)
			pIoData->bPiaCb2WasRaisedOutput = (u8)(cNewMode == 7 && cOldMode == 6);
	}

	Pia_UpdateControlReadback(pContext, sAddress);
	Pia_ReconcileIrq(pContext);
}

static void Pia_AcknowledgePortRead(_6502_Context_t *pContext, u8 bPortB)
{
	IoData_t *pIoData = (IoData_t *)pContext->pIoData;
	u8 cControl = bPortB ? SRAM[IO_PBCTL] : SRAM[IO_PACTL];
	u8 cMode = Pia_ControlMode(cControl);

	if(bPortB)
		pIoData->cPiaStatusB = 0;
	else
		pIoData->cPiaStatusA = 0;

	/* Output handshake modes are driven by the corresponding port read. */
	if(cMode == 4 || cMode == 5)
	{
		if(bPortB)
		{
			pIoData->cPiaCb2Level = 0;
			pIoData->llPiaCb2PulseEndCycle = cMode == 5
				? pContext->llCycleCounter + 1 : CYCLE_NEVER;
		}
		else
		{
			pIoData->cPiaCa2Level = 0;
			pIoData->llPiaCa2PulseEndCycle = cMode == 5
				? pContext->llCycleCounter + 1 : CYCLE_NEVER;
		}
	}
	Pia_UpdateControlReadback(pContext, bPortB ? IO_PBCTL : IO_PACTL);
	Pia_ReconcileIrq(pContext);
}

/********************************************************************
*
*
* Funktionen
*
*
********************************************************************/

/***********************************************/
/* $D300 - $D3FF (PIA) */
/***********************************************/

/* $D300 PORTA */
u8 *Pia_PORTA(_6502_Context_t *pContext, u8 *pValue)
{
	IoData_t *pIoData = (IoData_t *)pContext->pIoData;

	if(!(SRAM[IO_PACTL] & 0x04))
	{
		if(pValue)
		{
			pIoData->cValuePortA = *pValue;
		}

		return &pIoData->cValuePortA;
	}
	if(!pValue)
		Pia_AcknowledgePortRead(pContext, 0);

	if(pValue)
	{
		SRAM[IO_PORTA] = *pValue;
#ifdef VERBOSE_REGISTER
		printf("             [%16llu]", pContext->llCycleCounter);
		printf(" PORTA: %02X\n", *pValue);
#endif
	}

	return &RAM[IO_PORTA];
}

static u8 Pia_PortBEffectiveValue(const IoData_t *pIoData)
{
	return (u8)((pIoData->cOutputPortB & pIoData->cDirectionPortB) |
				(u8)~pIoData->cDirectionPortB);
}

/* Apply the electrical PORTB value to the selected memory expansion. */
static void Pia_ApplyPortBValue(_6502_Context_t *pContext, u8 cEffectivePortB)
{
	IoData_t *pIoData = (IoData_t *)pContext->pIoData;
	u8 cOldBank = pIoData->cExtendedBank;
	u8 bOldCpu = pIoData->bCpuExtendedWindow;
	u8 cNewPortB;
	u8 bU1mbSharedWindow = 0;
	u8 bNewCpu = 0;
	u8 bOldBasic;
	u8 bOldSelfTest;
	u8 bNewBasic;
	u8 bNewSelfTest;
	AtariMemoryExpansion_t eProfile = pIoData->eMemoryExpansion;

	/* Before the first expansion write, the persistent ROM state is the
	 * state represented by the current PORTB value. Subsequent writes use
	 * the state retained by the expansion model, as in jsA8E. */
	bOldBasic = pIoData->bMemoryExpansionInitialized
		? pIoData->bBasicRomEnabled
		: (u8)((SRAM[IO_PORTB] & 0x02) == 0);
	bOldSelfTest = pIoData->bMemoryExpansionInitialized
		? pIoData->bSelfTestRomEnabled
		: (u8)((SRAM[IO_PORTB] & 0x80) == 0);

	if(eProfile == ATARI_MEMORY_ULTIMATE1MB)
	{
		switch(pIoData->cU1mbUctl & 0x03)
		{
		case 0: eProfile = ATARI_MEMORY_NONE; break;
		case 1: eProfile = ATARI_MEMORY_RAMBO_320K; break;
		case 2: eProfile = ATARI_MEMORY_COMPY_576K; break;
		default: eProfile = ATARI_MEMORY_RAMBO_1088K; bU1mbSharedWindow = 1; break;
		}
	}
	if(eProfile != ATARI_MEMORY_NONE)
	{
		u8 cBankMask = 0x0c;
		u8 cBankBits = 2;
		u8 bSharedWindow = 0;
		switch(eProfile)
		{
		case ATARI_MEMORY_RAMBO_192K: cBankMask = 0x4c; cBankBits = 3; bSharedWindow = 1; break;
		case ATARI_MEMORY_RAMBO_256K: cBankMask = 0x6c; cBankBits = 4; bSharedWindow = 1; break;
		case ATARI_MEMORY_RAMBO_320K: cBankMask = 0x6c; cBankBits = 4; bSharedWindow = 1; break;
		case ATARI_MEMORY_COMPY_320K: cBankMask = 0xcc; cBankBits = 4; break;
		case ATARI_MEMORY_RAMBO_576K: cBankMask = 0x6e; cBankBits = 5; bSharedWindow = 1; break;
		case ATARI_MEMORY_COMPY_576K: cBankMask = 0xce; cBankBits = 5; break;
		case ATARI_MEMORY_RAMBO_1088K: cBankMask = 0xee; cBankBits = 6; bSharedWindow = 1; break;
		default: break;
		}
		cNewPortB = cEffectivePortB;
		u8 cNewBank = 0;
		u8 cBankIndex;
		u8 cBankPosition = 0;
		for(cBankIndex = 0; cBankIndex < 8; cBankIndex++)
			if(cBankMask & (1u << cBankIndex))
				cNewBank |= (u8)(((cNewPortB >> cBankIndex) & 1u) << cBankPosition++);
		if(cBankBits < 6) cNewBank &= (u8)((1u << cBankBits) - 1u);
		bNewCpu = (u8)((cNewPortB & 0x10) == 0);
		if(!bOldCpu && bNewCpu)
			memcpy(pIoData->pMainWindowShadow, &RAM[0x4000], 0x4000);
		if(bOldCpu)
		{
			if(eProfile == ATARI_MEMORY_RAMBO_256K && cOldBank < 4)
				memcpy(pIoData->pMainWindowShadow, &RAM[0x4000], 0x4000);
			else
				memcpy(&pIoData->pExtendedMemory[cOldBank * 0x4000u], &RAM[0x4000], 0x4000);
		}
		pIoData->cExtendedBank = cNewBank;
		pIoData->bCpuExtendedWindow = bNewCpu;
		pIoData->bAnticExtendedWindow = bU1mbSharedWindow || bSharedWindow
			? bNewCpu
			: (eProfile == ATARI_MEMORY_130XE_128K ||
			   eProfile == ATARI_MEMORY_COMPY_320K ||
			   eProfile == ATARI_MEMORY_COMPY_576K)
				? (u8)((cNewPortB & 0x20) == 0) : 0;
		if(bOldCpu && !bNewCpu)
			memcpy(&RAM[0x4000], pIoData->pMainWindowShadow, 0x4000);
		else if(bNewCpu)
		{
			if(eProfile == ATARI_MEMORY_RAMBO_256K && pIoData->cExtendedBank < 4)
				memcpy(&RAM[0x4000], pIoData->pMainWindowShadow, 0x4000);
			else
				memcpy(&RAM[0x4000], &pIoData->pExtendedMemory[pIoData->cExtendedBank * 0x4000u], 0x4000);
		}
	}
	else
		cNewPortB = cEffectivePortB;

	/* jsA8E keeps BASIC/Self-Test state separately when PORTB bits are
	 * reused for bank selection. Physical expansions that force a ROM off
	 * do so only while the CPU window is enabled; U1MB has no such force
	 * because its shadow PIA allows the ROMs to remain visible. */
	bNewBasic = (u8)((cEffectivePortB & 0x02) == 0);
	bNewSelfTest = (u8)((cEffectivePortB & 0x80) == 0);
	if(pIoData->eMemoryExpansion == ATARI_MEMORY_ULTIMATE1MB)
	{
		if(bNewCpu && (pIoData->cU1mbUctl & 0x03) != 0)
		{
			bNewBasic = bOldBasic;
			bNewSelfTest = bOldSelfTest;
		}
	}
	else
	{
		if(bNewCpu && (pIoData->eMemoryExpansion == ATARI_MEMORY_RAMBO_576K ||
					   pIoData->eMemoryExpansion == ATARI_MEMORY_COMPY_576K ||
					   pIoData->eMemoryExpansion == ATARI_MEMORY_RAMBO_1088K))
			bNewBasic = 0;
		if(bNewCpu && (pIoData->eMemoryExpansion == ATARI_MEMORY_COMPY_320K ||
					   pIoData->eMemoryExpansion == ATARI_MEMORY_COMPY_576K ||
					   pIoData->eMemoryExpansion == ATARI_MEMORY_RAMBO_1088K))
			bNewSelfTest = 0;
	}
#ifdef VERBOSE_ROM_SWITCH
	printf("$%04X: PORTB ", pContext->tCpu.pc);
#endif
	if((SRAM[IO_PORTB] & 0x01) != (cEffectivePortB & 0x01))
	{
		if(cEffectivePortB & 0x01) /* OS area */
		{
#ifdef VERBOSE_ROM_SWITCH
			printf("(OS ROM enabled) ");
#endif
			memcpy(&SRAM[0xc000], &RAM[0xc000], 0x1000);
			_6502_SetRom(pContext, 0xc000, 0xcfff);
			memcpy(&RAM[0xc000], pIoData->pOsRom, 0x1000);

			memcpy(&SRAM[0xd800], &RAM[0xd800], 0x2800);
			_6502_SetRom(pContext, 0xd800, 0xffff);
			memcpy(&RAM[0xd800], pIoData->pFloatingPointRom, 0x2800);
		}
		else
		{
#ifdef VERBOSE_ROM_SWITCH
			printf("(OS ROM disabled) ");
#endif
			memcpy(&RAM[0xc000], &SRAM[0xc000], 0x1000);
			_6502_SetRam(pContext, 0xc000, 0xcfff);

			memcpy(&RAM[0xd800], &SRAM[0xd800], 0x2800);
			_6502_SetRam(pContext, 0xd800, 0xffff);
		}
	}

	if(bOldBasic != bNewBasic)
	{
		if(!bNewBasic) /* BASIC disabled */
		{
#ifdef VERBOSE_ROM_SWITCH
			printf("(BASIC ROM disabled) ");
#endif
			memcpy(&RAM[0xa000], &SRAM[0xa000], 0x2000);
			_6502_SetRam(pContext, 0xa000, 0xbfff);
		}
		else
		{
#ifdef VERBOSE_ROM_SWITCH
			printf("(BASIC ROM enabled) ");
#endif
			memcpy(&SRAM[0xa000], &RAM[0xa000], 0x2000);
			_6502_SetRom(pContext, 0xa000, 0xbfff);
			memcpy(&RAM[0xa000], pIoData->pBasicRom, 0x2000);
		}
	}

	if(bOldSelfTest != bNewSelfTest)
	{
		if(!bNewSelfTest) /* Self-test disabled */
		{
#ifdef VERBOSE_ROM_SWITCH
			printf("(Self Test ROM disabled)");
#endif
			memcpy(&RAM[0x5000], &SRAM[0x5000], 0x0800);
			_6502_SetRam(pContext, 0x5000, 0x57ff);
		}
		else
		{
#ifdef VERBOSE_ROM_SWITCH
			printf("(Self Test ROM enabled)");
#endif
			memcpy(&SRAM[0x5000], &RAM[0x5000], 0x0800);
			_6502_SetRom(pContext, 0x5000, 0x57ff);
			memcpy(&RAM[0x5000], pIoData->pSelfTestRom, 0x0800);
		}
	}
	pIoData->bBasicRomEnabled = bNewBasic;
	pIoData->bSelfTestRomEnabled = bNewSelfTest;
	pIoData->bMemoryExpansionInitialized = 1;

#ifdef VERBOSE_ROM_SWITCH
	printf("\n");
#endif
	RAM[IO_PORTB] = SRAM[IO_PORTB] = cNewPortB;
#ifdef VERBOSE_REGISTER
	printf("             [%16llu]", pContext->llCycleCounter);
	printf(" PORTB: %02X\n", cEffectivePortB);
#endif
}

/* $D301 PORTB */
u8 *Pia_PORTB(_6502_Context_t *pContext, u8 *pValue)
{
	IoData_t *pIoData = (IoData_t *)pContext->pIoData;
	const u8 bDdrMode = (u8)((SRAM[IO_PBCTL] & 0x04) == 0);

	if(!pValue)
	{
		if(bDdrMode)
			return &pIoData->cDirectionPortB;
		Pia_AcknowledgePortRead(pContext, 1);
		return &RAM[IO_PORTB];
	}

	if(bDdrMode)
		pIoData->cDirectionPortB = *pValue;
	else
		pIoData->cOutputPortB = *pValue;

	Pia_ApplyPortBValue(pContext, Pia_PortBEffectiveValue(pIoData));
	return bDdrMode ? &pIoData->cDirectionPortB : &RAM[IO_PORTB];
}

/* $D302 PACTL */
u8 *Pia_PACTL(_6502_Context_t *pContext, u8 *pValue)
{
	if(pValue)
	{
		Pia_WriteControl(pContext, IO_PACTL, *pValue);
#ifdef VERBOSE_REGISTER
		printf("             [%16llu]", pContext->llCycleCounter);
		printf(" PACTL: %02X\n", *pValue);
#endif
	}

	return &RAM[IO_PACTL];
}

/* $D303 PBCTL */
u8 *Pia_PBCTL(_6502_Context_t *pContext, u8 *pValue)
{
	if(pValue)
	{
		Pia_WriteControl(pContext, IO_PBCTL, *pValue);
#ifdef VERBOSE_REGISTER
		printf("             [%16llu]", pContext->llCycleCounter);
		printf(" PBCTL: %02X\n", *pValue);
#endif
	}

	return &RAM[IO_PBCTL];
}

void Pia_SetCa1Line(_6502_Context_t *pContext, u8 cLevel)
{
	IoData_t *pIoData = (IoData_t *)pContext->pIoData;
	u8 cOldLevel = pIoData->cPiaCa1Level;
	Pia_LatchLineTransition(pContext, &pIoData->cPiaCa1Level,
		&pIoData->cPiaStatusA, SRAM[IO_PACTL], 0, IO_PACTL, cLevel);
	if(cOldLevel != pIoData->cPiaCa1Level && Pia_ControlMode(SRAM[IO_PACTL]) == 4)
		pIoData->cPiaCa2Level = 1;
	Pia_UpdateControlReadback(pContext, IO_PACTL);
}

void Pia_SetCa2Line(_6502_Context_t *pContext, u8 cLevel)
{
	IoData_t *pIoData = (IoData_t *)pContext->pIoData;
	Pia_LatchLineTransition(pContext, &pIoData->cPiaCa2Level,
		&pIoData->cPiaStatusA, SRAM[IO_PACTL], 1, IO_PACTL, cLevel);
}

void Pia_SetCb1Line(_6502_Context_t *pContext, u8 cLevel)
{
	IoData_t *pIoData = (IoData_t *)pContext->pIoData;
	u8 cOldLevel = pIoData->cPiaCb1Level;
	Pia_LatchLineTransition(pContext, &pIoData->cPiaCb1Level,
		&pIoData->cPiaStatusB, SRAM[IO_PBCTL], 0, IO_PBCTL, cLevel);
	if(cOldLevel != pIoData->cPiaCb1Level && Pia_ControlMode(SRAM[IO_PBCTL]) == 4)
		pIoData->cPiaCb2Level = 1;
	Pia_UpdateControlReadback(pContext, IO_PBCTL);
}

void Pia_SetCb2Line(_6502_Context_t *pContext, u8 cLevel)
{
	IoData_t *pIoData = (IoData_t *)pContext->pIoData;
	Pia_LatchLineTransition(pContext, &pIoData->cPiaCb2Level,
		&pIoData->cPiaStatusB, SRAM[IO_PBCTL], 1, IO_PBCTL, cLevel);
}

void Pia_CycleTimedEvent(_6502_Context_t *pContext)
{
	IoData_t *pIoData = (IoData_t *)pContext->pIoData;
	if(pIoData->llPiaCa2PulseEndCycle != CYCLE_NEVER &&
	   pContext->llCycleCounter >= pIoData->llPiaCa2PulseEndCycle)
	{
		pIoData->cPiaCa2Level = 1;
		pIoData->llPiaCa2PulseEndCycle = CYCLE_NEVER;
	}
	if(pIoData->llPiaCb2PulseEndCycle != CYCLE_NEVER &&
	   pContext->llCycleCounter >= pIoData->llPiaCb2PulseEndCycle)
	{
		pIoData->cPiaCb2Level = 1;
		pIoData->llPiaCb2PulseEndCycle = CYCLE_NEVER;
	}
}

/* U1MB configuration registers. Configuration writes are accepted only
 * while unlocked; UCTL bit 7 permanently locks the register block until the
 * next cold reset. */
u8 *Pia_U1mbRegister(_6502_Context_t *pContext, u8 *pValue)
{
	IoData_t *pIoData = (IoData_t *)pContext->pIoData;
	u16 sAddress = pContext->sAccessAddress;
	if(pIoData->eMemoryExpansion != ATARI_MEMORY_ULTIMATE1MB)
		return &RAM[sAddress];
	if(!pValue)
	{
		/* jsA8E models UCTL/UAUX/UPBI and PBI-button as write-only
		 * registers. COLDF is the only readable register in this surface. */
		if(sAddress == IO_U1MB_COLDF)
			return &pIoData->cU1mbColdf;
		RAM[sAddress] = 0xff;
		return &RAM[sAddress];
	}

	if(!pIoData->bU1mbConfigLocked)
	{
		if(sAddress == IO_U1MB_UCTL)
		{
			/* Reconfigure from a clean motherboard-window view, matching
			 * memory.js when UCTL changes the active U1MB memory mode. */
			if(pIoData->bMemoryExpansionInitialized)
			{
				if(pIoData->bCpuExtendedWindow)
				{
					memcpy(&pIoData->pExtendedMemory[pIoData->cExtendedBank * 0x4000u],
						   &RAM[0x4000], 0x4000);
					memcpy(&RAM[0x4000], pIoData->pMainWindowShadow, 0x4000);
				}
				pIoData->bCpuExtendedWindow = 0;
				pIoData->bAnticExtendedWindow = 0;
				pIoData->cExtendedBank = 0;
				pIoData->bMemoryExpansionInitialized = 0;
			}
			pIoData->cU1mbUctl = *pValue;
			if(*pValue & 0x80)
				pIoData->bU1mbConfigLocked = 1;
			Pia_ApplyPortBValue(pContext, Pia_PortBEffectiveValue(pIoData));
		}
		else if(sAddress == IO_U1MB_UAUX)
			pIoData->cU1mbUaux = *pValue;
		else if(sAddress == IO_U1MB_COLDF)
			pIoData->cU1mbColdf = (u8)(*pValue & 0x80);
	}
	return &RAM[sAddress];
}
