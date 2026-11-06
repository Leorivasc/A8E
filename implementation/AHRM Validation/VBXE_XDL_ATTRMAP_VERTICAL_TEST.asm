; FX 1.26 XDL attribute-map vertical-step diagnostic.
; Expected: a centered normal-width 640-pixel text field with alternating
; green and blue horizontal bands, eight pixels high. This proves that an
; 8x8 attribute map advances by MAPSTEP after each cell row.
.ORG $2000
DMACTL=$D400
NMIEN=$D40E
MEMACB=$D65D
VIDEO=$D640
XDL0=$D641
XDL1=$D642
XDL2=$D643
CSEL=$D644
PSEL=$D645
CR=$D646
CG=$D647
CB=$D648
P0=$D655
START:
 LDA #0
 STA NMIEN
 ; Map local VRAM bank 0 to $4000-$7FFF for CPU and ANTIC.
 LDA #$C0
 STA MEMACB
 ; One 80-character text row, reused by the zero text stride below.
 LDX #0
FILLTEXT:
 LDA #1
 STA $4000,X
 INX
 STA $4000,X
 INX
 CPX #160
 BNE FILLTEXT
 ; Character 1 is a fully set 8x8 glyph at local $00800.
 LDA #$FF
 LDX #7
FILLFONT:
 STA $4808,X
 DEX
 BPL FILLFONT
 ; Palette 2, color 1 = green.
 LDA #1
 STA CSEL
 LDA #2
 STA PSEL
 LDA #0
 STA CR
 LDA #$FE
 STA CG
 LDA #0
 STA CB
 ; Palette 3, color 1 = blue.
 LDA #1
 STA CSEL
 LDA #3
 STA PSEL
 LDA #0
 STA CR
 STA CG
 LDA #$FE
 STA CB
 ; Attribute cells choose P0, which stays above every GTIA layer.
 LDA #$FF
 STA P0
 ; Clear 24 rows of 40 four-byte cells: 24 * 160 = 15 pages at local $02000.
 LDA #0
 STA $80
 LDA #$60
 STA $81
 LDX #15
 LDY #0
FILLZERO:
 STA ($80),Y
 INY
 BNE FILLZERO
 INC $81
 DEX
 BNE FILLZERO
 ; Set each row's control byte. $20 selects palette 2; $30 selects palette 3.
 ; The pointer addresses byte 3 of cell 0 and moves by MAPSTEP ($A0) per row.
 LDA #3
 STA $80
 LDA #$60
 STA $81
 LDX #24
ATTRROW:
 TXA
 AND #1
 BEQ ATTRGREEN
 LDA #$30
 BNE ATTRREADY
ATTRGREEN:
 LDA #$20
ATTRREADY:
 LDY #0
ATTRCELL:
 STA ($80),Y
 INY
 INY
 INY
 INY
 CPY #160
 BNE ATTRCELL
 CLC
 LDA $80
 ADC #$A0
 STA $80
 LDA $81
 ADC #0
 STA $81
 DEX
 BNE ATTRROW
 ; XDL local $01000: text + AtMapOn + repeat + overlay address.
 ; c1 loads ChBase and attribute address/stride. The reset default is 8x8
 ; cells with zero map scroll, so no AttrLayout block is needed here.
 LDA #$69
 STA $5000
 LDA #$03
 STA $5001
 LDA #$BF
 STA $5002
 LDA #0
 STA $5003
 STA $5004
 STA $5005
 STA $5006
 STA $5007
 LDA #1
 STA $5008
 LDA #0
 STA $5009
 LDA #$20
 STA $500A
 LDA #0
 STA $500B
 LDA #$A0
 STA $500C
 LDA #0
 STA $500D
 STA XDL0
 LDA #$10
 STA XDL1
 STA DMACTL
 LDA #0
 STA XDL2
 LDA #5
 STA VIDEO
LOOP: JMP LOOP
.RUN START
