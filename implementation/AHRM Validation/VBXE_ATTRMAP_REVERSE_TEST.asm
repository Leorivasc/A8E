; FX 1.26 Attribute Map Rev diagnostic, without an overlay.
; Mode-F bits are $1B = 00,01,10,11. Rev reinterprets each adjacent bit pair
; as PF0, PF1, PF2, PF3: doubled red, blue, green, magenta stripes.
.ifndef GTIA_MODE
.define GTIA_MODE $00
.endif
.ifndef VBXE_VIDEO
.define VBXE_VIDEO $01
.endif
.ifndef COLBK_COLOR
.define COLBK_COLOR $00
.endif
.ORG $2000
DMACTL=$D400
DLISTL=$D402
DLISTH=$D403
NMIEN=$D40E
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
 STA COLPF1
 STA COLPF2
 LDA #COLBK_COLOR
 STA COLBK
 LDA #GTIA_MODE
 STA PRIOR
 ; PF3 remains supplied by GTIA when the reinterpreted pair is %11.
 LDA #$C8
 STA COLPF3
 LDA #$C0
 STA MEMACB
 ; Fill the complete Graphics 8 source in local VRAM with 00/01/10/11 pairs.
 LDA #0
 STA $80
 LDA #$40
 STA $81
 LDA #$1B
 LDX #30
 LDY #0
FILLSCREEN:
 STA ($80),Y
 INY
 BNE FILLSCREEN
 INC $81
 DEX
 BNE FILLSCREEN
 ; LMS mode F, 191 more lines, then JVB.
 LDA #$4F
 STA $3000
 LDA #0
 STA $3001
 LDA #$40
 STA $3002
 LDX #191
 LDA #$0F
FILLDL:
 DEX
 STA $3003,X
 BNE FILLDL
 LDA #$41
 STA $30C2
 LDA #0
 STA $30C3
 LDA #$30
 STA $30C4
 LDA #0
 STA DLISTL
 LDA #$30
 STA DLISTH
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
 ; Close the 192-line field explicitly. The XDL does not terminate at the
 ; end of a repeat, so disable the map and set End before subsequent VRAM.
 LDA #$10
 STA $5E08
 LDA #$80
 STA $5E09
 ; All cells share the same reverse colors. Map stride zero reuses this row.
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
 LDA #VBXE_VIDEO
 STA VIDEO
LOOP: JMP LOOP
.RUN START
