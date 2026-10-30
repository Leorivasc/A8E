; FX 1.26 attribute-map Rev diagnostic for ANTIC hires character mode 2.
; AHRM identifies modes 2, 3, and F as hires. Each $1B glyph row supplies
; bit pairs 00,01,10,11, which Rev must decode as PF0,PF1,PF2,PF3.
.ifndef GTIA_MODE
.define GTIA_MODE $00
.endif
.ifndef ANTIC_MODE
.define ANTIC_MODE $02
.endif
.ifndef DISPLAY_ROWS
.define DISPLAY_ROWS 24
.endif
.ifndef XDL_REPEAT
.define XDL_REPEAT $BF
.endif
.ORG $2000
DMACTL=$D400
DLISTL=$D402
DLISTH=$D403
NMIEN=$D40E
CHBASE=$D409
COLBK=$D01A
COLPF1=$D017
COLPF2=$D018
COLPF3=$D019
PRIOR=$D01B
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
 STA COLPF1
 STA COLPF2
 LDA #GTIA_MODE
 STA PRIOR
 LDA #$C8
 STA COLPF3
 LDA #$C0
 STA MEMACB

 ; Character 0 is the repeating 00,01,10,11 source pattern on every row.
 LDA #$1B
 LDX #7
CHAR0:
 STA $2400,X
 DEX
 BPL CHAR0

 ; All 24 rows of the normal-width mode-2 field use character 0.
 LDA #0
 LDX #0
CLEARSCREEN:
 STA $3200,X
 STA $3300,X
 STA $3400,X
 INX
 BNE CLEARSCREEN

 ; LMS hires character mode, then its remaining rows, then JVB.
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

 ; Palette 0: PF0 red, PF1 blue, PF2 green, PF3 magenta.
 LDA #0
 STA PSEL
 LDA #$42
 STA CSEL
 LDA #$FE
 STA CR
 LDA #0
 STA CG
 STA CB
 LDA #$84
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
 LDA #$C8
 STA CSEL
 LDA #$FE
 STA CR
 LDA #0
 STA CG
 LDA #$FE
 STA CB

 ; XDL local $01E00: AtMapOn + repeat; map address/stride only.
 LDA #$28
 STA $5E00
 LDA #$02
 STA $5E01
 LDA #XDL_REPEAT
 STA $5E02
 LDA #0
 STA $5E03
 LDA #$20
 STA $5E04
 LDA #0
 STA $5E05
 STA $5E06
 STA $5E07

 ; All cells reuse the same reverse colors.
 LDX #0
 LDY #40
FILLMAP:
 LDA #$42
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
 LDA #1
 STA VIDEO
LOOP: JMP LOOP
