; FX 1.26 VBXE blitter-complete IRQ observation diagnostic.
; It copies a local 40x192 Graphics 8 field and enables IRQ_CONTROL before
; starting. The screen has black/blue vertical stripes if the handler ran, or
; remains solid blue if completion was only observable through polling. It
; deliberately uses the standard Atari OS
; immediate IRQ vector at $0216; it does not claim a PBI routing model.
.ORG $2000
DMACTL=$D400
DLISTL=$D402
DLISTH=$D403
NMIEN=$D40E
COLBK=$D01A
COLPF1=$D017
MEMACB=$D65D
BLT0=$D650
BLT1=$D651
BLT2=$D652
BLTSTART=$D653
IRQCONTROL=$D654
IRQVEC=$0216

PTRLO=$80
PTRHI=$81
IRQFLAG=$82

START:
 LDA #0
 STA NMIEN
 STA IRQFLAG
 ; Map local VRAM bank 0 into $4000-$7FFF for CPU and ANTIC.
 LDA #$C0
 STA MEMACB
 LDA #<DISPLAY_LIST
 STA DLISTL
 LDA #>DISPLAY_LIST
 STA DLISTH
 LDA #$22
 STA DMACTL
 LDA #0
 STA COLBK
 ; Start with a blue field while the copy is in flight.
 LDA #$96
 STA COLPF1
 ; Clear destination local $00000 and fill source local $01000.
 LDA #0
 STA PTRLO
 LDA #$40
 STA PTRHI
 LDX #30
 JSR FILL_PAGES
 LDA #0
 STA PTRLO
 LDA #$50
 STA PTRHI
 LDA #$FF
 LDX #30
 JSR FILL_PAGES
 ; Install the normal OS IRQ callback before enabling the VBXE source.
 LDA #<IRQ_HANDLER
 STA IRQVEC
 LDA #>IRQ_HANDLER
 STA IRQVEC+1
 ; Control block is local $03000.
 LDY #0
COPY_BLOCK:
 LDA BLIT_BLOCK,Y
 STA $7000,Y
 INY
 CPY #21
 BNE COPY_BLOCK
 LDA #0
 STA BLT0
 LDA #$30
 STA BLT1
 STA BLT2
 LDA #1
 STA IRQCONTROL
 CLI
 LDA #1
 STA BLTSTART
WAIT:
 LDA BLTSTART
 AND #3
 BNE WAIT
 SEI
 LDA IRQFLAG
 BEQ POLL_ONLY
 ; Visible black/blue stripes mean the CPU entered IRQ_HANDLER and
 ; acknowledged IRQ_STATUS.
 JSR MARK_IRQ
POLL_ONLY:
 ; Solid blue means no CPU IRQ was observed before the same blit completed by
 ; polling.
READY:
 JMP READY

IRQ_HANDLER:
 PHA
 INC IRQFLAG
 LDA #0
 STA IRQCONTROL
 PLA
 RTI

; Clear every second Graphics 8 byte in the copied local-memory field. This
; creates an unambiguous black/blue stripe result independent of GTIA palette
; calibration.
MARK_IRQ:
 LDA #0
 STA PTRLO
 LDA #$40
 STA PTRHI
 LDX #192
MARK_ROW:
 LDY #0
MARK_BYTE:
 LDA #0
 STA (PTRLO),Y
 INY
 INY
 CPY #40
 BNE MARK_BYTE
 CLC
 LDA PTRLO
 ADC #40
 STA PTRLO
 BCC MARK_NEXT_ROW
 INC PTRHI
MARK_NEXT_ROW:
 DEX
 BNE MARK_ROW
 RTS

; A contains the fill value and X the number of 256-byte pages.
FILL_PAGES:
 LDY #0
FILL_BYTE:
 STA (PTRLO),Y
 INY
 BNE FILL_BYTE
 INC PTRHI
 DEX
 BNE FILL_PAGES
 RTS

; Source $01000, destination $00000, 40 bytes x 192 rows, copy mode.
BLIT_BLOCK:
 .BYTE $00,$10,$00, $28,$00,$01, $00,$00,$00, $28,$00,$01
 .BYTE $27,$00,$BF, $FF,$00,$00, $00,$00,$00

.ORG $3000
DISPLAY_LIST:
 .BYTE $70,$70,$70
 .BYTE $4F,$00,$40
 .REPT 191
 .BYTE $0F
 .ENDR
 .BYTE $41,<DISPLAY_LIST,>DISPLAY_LIST

.RUN START
