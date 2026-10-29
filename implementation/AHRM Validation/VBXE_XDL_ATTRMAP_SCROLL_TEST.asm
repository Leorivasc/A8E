; FX 1.26 XDL attribute-map scroll diagnostic.
; Expected: a green/blue 8x8-cell checkerboard, shifted by four standard
; pixels horizontally and vertically. The top-left partial green cell is
; therefore 8 display pixels wide by 4 scan lines high; full cells are 16x8.
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
 LDA #$C0
 STA MEMACB
 ; One 80-character text row, reused by the zero text stride.
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
 ; Palette 2, color 1 = green; palette 3, color 1 = blue.
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
 LDA #1
 STA CSEL
 LDA #3
 STA PSEL
 LDA #0
 STA CR
 STA CG
 LDA #$FE
 STA CB
 LDA #$FF
 STA P0
 ; Clear 24 rows of 40 cells at local $02000 (15 pages).
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
 ; Write a checkerboard to byte 3 of every four-byte cell block.
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
 EOR #$10
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
 ; Text + AtMapOn + repeat + overlay address. AttrLayout stores 3, which
 ; encodes a four-pixel scroll because AHRM fields are pixel counts minus one.
 LDA #$69
 STA $5000
 LDA #$07
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
 LDA #3
 STA $500E
 STA $500F
 LDA #7
 STA $5010
 STA $5011
 LDA #0
 STA XDL0
 LDA #$10
 STA XDL1
 STA DMACTL
 LDA #0
 STA XDL2
 LDA #1
 STA VIDEO
LOOP: JMP LOOP
.RUN START
