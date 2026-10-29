; FX 1.26 text XDL overlay: solid yellow 80-column 640x192 field.
; Character/attribute pairs at local $00000 are both color/character 1.
; Character 1 in the local font at $00800 is an 8x8 solid bitmap.
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
 ; 80 character/attribute pairs, all character 1 and foreground color 1.
 LDA #1
 LDX #0
FILLROW:
 STA $4000,X
 INX
 CPX #160
 BNE FILLROW
 ; Local font $00800, character 1, all eight pixels foreground.
 LDA #$FF
 LDX #7
FILLFONT:
 STA $4808,X
 DEX
 BPL FILLFONT
 ; Palette 1, color 1 = yellow.
 LDA #1
 STA CSEL
 STA PSEL
 LDA #$FE
 STA CR
 STA CG
 LDA #0
 STA CB
 ; XDL local $1000: text + repeat + address, ChBase $00800.
 LDA #$61
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
 LDA #1
 STA $5008
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
