; FX 1.26 VBXE local-bus throughput observation diagnostic.
; A 512x256 mode-0 blit from a zero source runs while ANTIC reads the first
; local-VRAM bank through MEMAC B. The completion IRQ saves VCOUNT; after the
; blit, the visible 40x192 Graphics 8 field is restored blue and its top N
; lines are cleared black, where N is the captured VCOUNT (clamped to 192).
; Compare the horizontal black/blue split between jsA8E and Altirra.
.ORG $2000
DMACTL=$D400
DLISTL=$D402
DLISTH=$D403
NMIEN=$D40E
VCOUNT=$D40B
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
 ; Give the visible field a known blue initial state.
 LDA #0
 STA PTRLO
 LDA #$40
 STA PTRHI
 LDA #$FF
 LDX #30
 JSR FILL_PAGES
 ; The standard OS immediate IRQ vector records completion timing.
 LDA #<IRQ_HANDLER
 STA IRQVEC
 LDA #>IRQ_HANDLER
 STA IRQVEC+1
 ; Copy 512x256 bytes from the initially-zero local $10000 source to local 0.
 ; The source remains zero even when the destination sweep reaches it.
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
; Align the start to the beginning of a video frame. The one-line VCOUNT=0
; window is sufficient here: the comparison is an external timing probe, not
; a cycle-exact CPU benchmark.
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
 ; Restore a blue screen, then encode captured VCOUNT as black top rows.
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

; A is the number of 40-byte Graphics 8 rows to clear at CPU $4000.
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

; Source $10000, destination $00000, 512 bytes x 256 rows, copy mode.
BLIT_BLOCK:
 .BYTE $00,$00,$01, $00,$00,$00, $00,$00,$00, $00,$02,$01
 .BYTE $FF,$01,$FF, $FF,$00,$00, $00,$00,$00

.ORG $3000
DISPLAY_LIST:
 .BYTE $70,$70,$70
 .BYTE $4F,$00,$40
 .REPT 191
 .BYTE $0F
 .ENDR
 .BYTE $41,<DISPLAY_LIST,>DISPLAY_LIST

.RUN START
