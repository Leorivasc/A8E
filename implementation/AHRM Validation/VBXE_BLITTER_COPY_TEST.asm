; FX 1.26 VBXE blitter functional diagnostic.
; It fills a local-VRAM source field with $FF, clears a second field, then
; uses one 40x192 mode-0 blit to copy it. Both jsA8E and Altirra should settle
; to a centered normal-width solid PF1-blue Graphics 8 field.
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

PTRLO=$80
PTRHI=$81

START:
 LDA #0
 STA NMIEN
 ; Map local VRAM bank 0 into $4000-$7FFF for CPU and ANTIC.
 LDA #$C0
 STA MEMACB
 ; ANTIC displays the destination at local $00000 / CPU $4000.
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
 ; Clear the 40x192 destination field (30 pages at local $00000).
 LDA #0
 STA PTRLO
 LDA #$40
 STA PTRHI
 LDX #30
 JSR FILL_PAGES
 ; Fill the source field (local $01000 / CPU $5000) with Graphics 8 PF1.
 LDA #0
 STA PTRLO
 LDA #$50
 STA PTRHI
 LDA #$FF
 LDX #30
 JSR FILL_PAGES
 ; Copy the 21-byte control block into local $03000 / CPU $7000.
 LDY #0
COPY_BLOCK:
 LDA BLIT_BLOCK,Y
 STA $7000,Y
 INY
 CPY #21
 BNE COPY_BLOCK
 ; Start the local $03000 blit list.
 LDA #0
 STA BLT0
 LDA #$30
 STA BLT1
 STA BLT2
 LDA #1
 STA BLTSTART
WAIT:
 LDA BLTSTART
 ; AHRM 12.4: D0 means control-block load and D1 means active blit.
 ; Continue waiting until neither state is active.
 AND #3
 BNE WAIT
READY:
 JMP READY

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
