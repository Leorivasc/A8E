; FX 1.26 text XDL overlay: transparent vs opaque cell backgrounds.
; Expected: alternating 8-pixel cells show yellow/red stripes (opaque
; background, attribute $81) and yellow/black stripes (transparent background,
; attribute $01) over the blank Atari frame.
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
 ; 80 character/attribute pairs: alternate transparent and opaque cells.
 LDX #0
FILLROW:
 LDA #1
 STA $4000,X
 INX
 TXA
 AND #2
 BEQ TRANSPARENT
 LDA #$81
 BNE STORE_ATTRIBUTE
TRANSPARENT:
 LDA #1
STORE_ATTRIBUTE:
 STA $4000,X
 INX
 CPX #160
 BNE FILLROW
 ; Local font $00800, character 1 = vertical yellow/ground stripes.
 LDA #$AA
 LDX #7
FILLFONT:
 STA $4808,X
 DEX
 BPL FILLFONT
 ; Palette 1: foreground 1 yellow, opaque background $81 red.
 LDA #1
 STA CSEL
 STA PSEL
 LDA #$FE
 STA CR
 STA CG
 LDA #0
 STA CB
 LDA #$81
 STA CSEL
 LDA #$FE
 STA CR
 LDA #0
 STA CG
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
 ; Enable XDL plus color-0 transparency: clear text backgrounds are transparent.
 LDA #$05
 STA VIDEO
LOOP: JMP LOOP
.RUN START
