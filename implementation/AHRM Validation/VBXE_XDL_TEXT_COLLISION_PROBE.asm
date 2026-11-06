; FX 1.26 VBXE text collision source probe.
; A text glyph (character $21, attribute $41, glyph byte $FF) overlays a
; nonzero ANTIC Graphics 8 field. It samples COLDETECT with COLMASK selecting
; the character, attribute, and glyph byte ranges respectively, and stores
; the three values at $0082-$0084 for debugger inspection.
.ORG $2000
DMACTL=$D400
DLISTL=$D402
DLISTH=$D403
NMIEN=$D40E
VCOUNT=$D40B
MEMACB=$D65D
VIDEO=$D640
XDL0=$D641
XDL1=$D642
XDL2=$D643
COLMASK=$D649
COLDETECT=$D64A
COLCLR=$D64A
RESULTS=$82

START:
 LDA #0
 STA NMIEN
 STA RESULTS
 STA RESULTS+1
 STA RESULTS+2
 LDA #$C0
 STA MEMACB
 LDA #<DISPLAY_LIST
 STA DLISTL
 LDA #>DISPLAY_LIST
 STA DLISTH
 LDA #$22
 STA DMACTL
 ; Local $00000: nonzero Graphics 8 source for ANTIC through MEMAC B.
 LDA #$FF
 LDX #0
FILL_FIELD:
 STA $4000,X
 STA $4100,X
 STA $4200,X
 STA $4300,X
 INX
 BNE FILL_FIELD
 ; Local $03000: 80 text cells, character $21 with foreground attribute $41.
 LDX #0
FILL_TEXT:
 LDA #$21
 STA $7000,X
 INX
 LDA #$41
 STA $7000,X
 INX
 CPX #160
 BNE FILL_TEXT
 ; Local $03800: character $21 is a solid 8x8 glyph ($FF).
 LDA #$FF
 LDX #7
FILL_FONT:
 STA $7908,X
 DEX
 BPL FILL_FONT
 ; XDL local $01000: text + repeat + address, ChBase local $03800.
 LDA #$61
 STA $5000
 LDA #$01
 STA $5001
 LDA #$BF
 STA $5002
 LDA #0
 STA $5003
 LDA #$30
 STA $5004
 LDA #0
 STA $5005
 STA $5006
 STA $5007
 LDA #7
 STA $5008
 LDA #0
 STA XDL0
 LDA #$10
 STA XDL1
 LDA #0
 STA XDL2
 LDA #5
 STA VIDEO
 ; $20-$3F: character byte $21.
 LDA #2
 JSR SAMPLE
 STA RESULTS
 ; $40-$5F: attribute byte $41.
 LDA #4
 JSR SAMPLE
 STA RESULTS+1
 ; $E0-$FF: glyph byte $FF.
 LDA #$80
 JSR SAMPLE
 STA RESULTS+2
READY:
 JMP READY

; Clear COLDETECT, wait through VSync and into active XDL lines, return it.
SAMPLE:
 STA COLMASK
 STA COLCLR
WAIT_ZERO:
 LDA VCOUNT
 BNE WAIT_ZERO
WAIT_ACTIVE:
 LDA VCOUNT
 CMP #$10
 BCC WAIT_ACTIVE
 LDA COLDETECT
 RTS

.ORG $3000
DISPLAY_LIST:
 .BYTE $70,$70,$70
 .BYTE $4F,$00,$40
 .REPT 191
 .BYTE $0F
 .ENDR
 .BYTE $41,<DISPLAY_LIST,>DISPLAY_LIST

.RUN START
