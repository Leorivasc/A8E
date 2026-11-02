; FX 1.26 VBXE standard-overlay local-bus timing probe.
; A transparent standard overlay runs over a Graphics 8 field sourced through
; MEMAC B. A 512x128 mode-0 blit records its completion VCOUNT as a black/blue
; split after the blit. Compare that split between jsA8E and Altirra.
.ORG $2000
DMACTL=$D400
DLISTL=$D402
DLISTH=$D403
NMIEN=$D40E
VCOUNT=$D40B
COLBK=$D01A
COLPF1=$D017
VIDEO=$D640
XDL0=$D641
XDL1=$D642
XDL2=$D643
MEMACB=$D65D
BLT0=$D650
BLT1=$D651
BLT2=$D652
BLTSTART=$D653
IRQCONTROL=$D654
IRQVEC=$0216

PTRLO=$80
PTRHI=$81
ROWS=$82
ZERO=$83

START:
 LDA #0
 STA NMIEN
 STA ROWS
 STA ZERO
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
 LDA #$96
 STA COLPF1
 ; Visible Graphics 8 field begins blue.
 LDA #0
 STA PTRLO
 LDA #$40
 STA PTRHI
 LDA #$FF
 LDX #30
 JSR FILL_PAGES
 ; XDL at local $01000: standard graphics, 192 lines, source $20000.
 ; VIDEO bit 2 makes the all-zero source transparent, but its DMA remains
 ; active and therefore competes with the blitter.
 LDA #$62
 STA $5000
 LDA #0
 STA $5001
 LDA #$BF
 STA $5002
 LDA #0
 STA $5003
 STA $5004
 LDA #2
 STA $5005
 STA $5006
 STA $5007
 LDA #4
 STA $5008
 LDA #0
 STA $5009
 STA XDL0
 LDA #$10
 STA XDL1
 LDA #0
 STA XDL2
 LDA #5
 STA VIDEO
 ; Standard OS immediate IRQ vector records completion timing.
 LDA #<IRQ_HANDLER
 STA IRQVEC
 LDA #>IRQ_HANDLER
 STA IRQVEC+1
 ; Copy 512x128 bytes from zero local $30000 to local 0.
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
 ; Start at a VCOUNT frame boundary, after VIDEO/XDL latch at vertical sync.
WAIT_NOT_ZERO:
 LDA VCOUNT
 BEQ WAIT_NOT_ZERO
WAIT_ZERO:
 LDA VCOUNT
 BNE WAIT_ZERO
 LDA #1
 STA BLTSTART
WAIT:
 LDA BLTSTART
 AND #3
 BNE WAIT
 SEI
 ; Disable XDL and wait for its VSync latch before exposing the base marker.
 ; This makes the result independent of how an emulator presents a fully
 ; transparent overlay after the measurement has already completed.
 LDA #0
 STA VIDEO
WAIT_DISABLE_NOT_ZERO:
 LDA VCOUNT
 BEQ WAIT_DISABLE_NOT_ZERO
WAIT_DISABLE_ZERO:
 LDA VCOUNT
 BNE WAIT_DISABLE_ZERO
 ; Restore blue then use the saved VCOUNT for the visible marker.
 LDA #0
 STA PTRLO
 LDA #$40
 STA PTRHI
 LDA #$FF
 LDX #30
 JSR FILL_PAGES
 LDA ROWS
 CMP #193
 BCC HAVE_ROWS
 LDA #192
HAVE_ROWS:
 JSR CLEAR_ROWS
READY:
 JMP READY

IRQ_HANDLER:
 PHA
 LDA VCOUNT
 STA ROWS
 LDA #0
 STA IRQCONTROL
 PLA
 RTI

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

CLEAR_ROWS:
 TAX
 BEQ CLEAR_DONE
 LDA #0
 STA PTRLO
 LDA #$40
 STA PTRHI
CLEAR_ROW:
 LDY #0
CLEAR_BYTE:
 LDA ZERO
 STA (PTRLO),Y
 INY
 CPY #40
 BNE CLEAR_BYTE
 CLC
 LDA PTRLO
 ADC #40
 STA PTRLO
 BCC CLEAR_NEXT
 INC PTRHI
CLEAR_NEXT:
 DEX
 BNE CLEAR_ROW
CLEAR_DONE:
 RTS

; Source $30000, destination $00000, 512 bytes x 128 rows, copy mode.
BLIT_BLOCK:
 .BYTE $00,$00,$03, $00,$00,$00, $00,$00,$00, $00,$02,$01
 .BYTE $FF,$01,$7F, $FF,$00,$00, $00,$00,$00

.ORG $3000
DISPLAY_LIST:
 .BYTE $70,$70,$70
 .BYTE $4F,$00,$40
 .REPT 191
 .BYTE $0F
 .ENDR
 .BYTE $41,<DISPLAY_LIST,>DISPLAY_LIST

.RUN START
