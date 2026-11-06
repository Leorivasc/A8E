; FX 1.26 AttrMap Rev diagnostic for ANTIC mode 4.
; AHRM defines mode 4 as two-bit lores character data. A $1B glyph row has
; 00,01,10,11 source values; Rev must produce the respective hires pairs.
.ifndef GTIA_MODE
.define GTIA_MODE $00
.endif
.ifndef VBXE_VIDEO
.define VBXE_VIDEO $01
.endif
.ifndef MAP_PF0
.define MAP_PF0 $42
.endif
.ifndef GLYPH_DATA
.define GLYPH_DATA $1B
.endif
.ifndef ANTIC_MODE
.define ANTIC_MODE $04
.endif
.ifndef DISPLAY_ROWS
.define DISPLAY_ROWS 24
.endif
.ORG $2000
DMACTL=$D400
DLISTL=$D402
DLISTH=$D403
NMIEN=$D40E
CHBASE=$D409
COLBK=$D01A
COLPF0=$D016
COLPF1=$D017
COLPF2=$D018
COLPF3=$D019
PRIOR=$D01B
COLPM1=$D013
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

START:
 LDA #0
 STA NMIEN
 STA COLBK
 STA COLPF0
 STA COLPF1
 STA COLPF2
 STA COLPF3
 LDA #GTIA_MODE
 STA PRIOR
.ifdef M10_COLOR1
 LDA #M10_COLOR1
 STA COLPM1
.endif
 LDA #$C0
 STA MEMACB

 ; Character 0 provides four distinct two-bit lores source values per row.
 LDA #GLYPH_DATA
 LDX #7
CHAR0:
 STA $2400,X
 DEX
 BPL CHAR0

 LDA #0
 LDX #0
CLEARSCREEN:
 STA $3200,X
 STA $3300,X
 STA $3400,X
 INX
 BNE CLEARSCREEN

 ; LMS lores character mode, then its remaining rows, then JVB.
 LDA #($40+ANTIC_MODE)
 STA $3000
 LDA #0
 STA $3001
 LDA #$32
 STA $3002
 LDX #(DISPLAY_ROWS-1)
 LDA #ANTIC_MODE
FILLDL:
 DEX
 STA $3003,X
 BNE FILLDL
 LDA #$41
 STA $3003+DISPLAY_ROWS-1
 LDA #0
 STA $3004+DISPLAY_ROWS-1
 LDA #$30
 STA $3005+DISPLAY_ROWS-1
 LDA #0
 STA DLISTL
 LDA #$30
 STA DLISTH
 LDA #$24
 STA CHBASE

 ; PF2 is green. The hires set-bit result is PF2 hue plus PF1 luminance,
 ; index $24, explicitly programmed blue.
 LDA #0
 STA PSEL
 LDA #$24
 STA CSEL
 LDA #0
 STA CR
 STA CG
 LDA #$FE
 STA CB
 LDA #$26
 STA CSEL
 LDA #0
 STA CR
 LDA #$FE
 STA CG
 LDA #0
 STA CB

 ; XDL local $01E00: AtMapOn + repeat; map address/stride only.
 LDA #$28
 STA $5E00
 LDA #$02
 STA $5E01
 LDA #$BF
 STA $5E02
 LDA #0
 STA $5E03
 LDA #$20
 STA $5E04
 LDA #0
 STA $5E05
 STA $5E06
 STA $5E07

 LDX #0
 LDY #40
FILLMAP:
 LDA #MAP_PF0
 STA $6000,X
 LDA #$84
 STA $6001,X
 LDA #$26
 STA $6002,X
 LDA #$04
 STA $6003,X
 TXA
 CLC
 ADC #4
 TAX
 DEY
 BNE FILLMAP

 LDA #0
 STA XDL0
 LDA #$1E
 STA XDL1
 LDA #0
 STA XDL2
 LDA #$22
 STA DMACTL
 LDA #VBXE_VIDEO
 STA VIDEO
LOOP: JMP LOOP
