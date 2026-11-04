; FX 1.26 Attribute Map PF3-mask diagnostic, without an overlay.
; Expected: a normal-width mode-F field. PF2 is blue; bit 7-0 of every
; 8-pixel cell's byte 0 ($AA) alternates PF3 green with PF2 blue.
.ifndef GTIA_MODE
.define GTIA_MODE $00
.endif
.ifndef SOURCE_BYTE
.define SOURCE_BYTE $00
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
 STA COLBK
 STA COLPF1
 STA COLPF2
 LDA #GTIA_MODE
 STA PRIOR
 ; PF3 supplies the color selected by a set attribute-map mask bit.
 LDA #$26
 STA COLPF3
 ; Map local VRAM bank 0 at $4000-$7FFF for CPU and ANTIC.
 LDA #$C0
 STA MEMACB
; Fill the 192x40-byte Graphics 8 source. The default zero bits are PF2;
; GTIA-special wrappers select a visible non-zero raw source instead.
LDA #SOURCE_BYTE
 STA $80
 LDA #$40
 STA $81
 LDA #0
 LDX #30
 LDY #0
CLEARSCREEN:
 STA ($80),Y
 INY
 BNE CLEARSCREEN
 INC $81
 DEX
 BNE CLEARSCREEN
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
 ; Palette 0: PF2 blue and PF3 green. CB increments CSEL.
 LDA #0
 STA PSEL
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
; Initialize forty 8-pixel map cells. Map stride zero reuses this row.
 LDX #0
 LDY #40
FILLMAP:
 LDA #$AA
 STA $6000,X
 LDA #0
 STA $6001,X
 LDA #$84
 STA $6002,X
 LDA #0
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
 LDA #5
 STA VIDEO
LOOP: JMP LOOP
.RUN START
