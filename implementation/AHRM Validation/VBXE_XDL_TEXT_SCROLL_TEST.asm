; FX 1.26 text XDL overlay: horizontal/vertical text scroll diagnostic.
; Expected: an 80-column cyan stripe field with 4-pixel horizontal offset and
; a two-scanline vertical offset. Compare the phase and the centered aperture
; between Altirra and jsA8E.
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
START:
 LDA #0
 STA NMIEN
 LDA #$C0
 STA MEMACB
 ; 80 character/attribute pairs alternating character 1 and 2, color 1.
 LDX #0
 LDY #40
FILLROW:
 LDA #1
 STA $4000,X
 INX
 STA $4000,X
 INX
 LDA #2
 STA $4000,X
 INX
 LDA #1
 STA $4000,X
 INX
 DEY
 BNE FILLROW
 ; Character 1 alternates $F0/$0F by font row; character 2 is its inverse.
 LDX #0
FILLFONT:
 TXA
 AND #1
 BEQ EVENROW
 LDA #$0F
 BNE STORE_FONT
EVENROW:
 LDA #$F0
STORE_FONT:
 STA $4808,X
 EOR #$FF
 STA $4810,X
 INX
 CPX #8
 BNE FILLFONT
 ; Palette 1, color 1 = cyan.
 LDA #1
 STA CSEL
 STA PSEL
 LDA #0
 STA CR
 LDA #$FE
 STA CG
 STA CB
 ; XDL local $1000: text + repeat + address + scroll, ChBase $00800.
 LDA #$E1
 STA $5000
 LDA #$01
 STA $5001
 LDA #$BF
 STA $5002
 LDA #0
 STA $5003
 STA $5004
 STA $5005
 STA $5006
 STA $5007
 LDA #4
 STA $5008
 LDA #2
 STA $5009
 LDA #1
 STA $500A
 LDA #0
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
