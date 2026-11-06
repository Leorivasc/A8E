; FX 1.26 Attribute Map PF1/PF2 diagnostic, without an overlay.
; Expected: a normal-width ANTIC mode-F field with 16-display-pixel cells
; alternating red/blue and green/magenta one-pixel PF1/PF2 stripes.
.ORG $2000
DMACTL=$D400
DLISTL=$D402
DLISTH=$D403
NMIEN=$D40E
COLBK=$D01A
PRIOR=$D01B
COLPF1=$D017
COLPF2=$D018
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
 STA PRIOR
 STA COLPF1
 STA COLPF2
 ; Map local VRAM bank 0 at $4000-$7FFF for both CPU and ANTIC. The complete
 ; 7.5 KiB mode-F source then has one unambiguous backing store.
 LDA #$C0
 STA MEMACB
 ; Fill 192 mode-F rows (40 bytes per row) with alternating PF1/PF2 bits.
 LDA #0
 STA $80
 LDA #$40
 STA $81
 LDA #$AA
 LDX #30
 LDY #0
FILLPAGE:
 STA ($80),Y
 INY
 BNE FILLPAGE
 INC $81
 DEX
 BNE FILLPAGE
 ; LMS mode F, 191 additional mode-F lines, then JVB.
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
 ; Define palette 0 colors.
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
 ; Screen data occupy local $00000-$01DFF. Write the XDL at $01E00 and the
 ; map at $02000 through that same MEMAC B window.
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
 ; Clear one 40-cell map row. Hardware local VRAM is not initially zero.
 LDA #0
 LDX #0
CLEARMAP:
 STA $6000,X
 INX
 CPX #160
 BNE CLEARMAP
 ; Cell pairs override PF1/PF2 with red/blue then green/magenta. Map stride
 ; stays zero, so this initialized row is used throughout the whole field.
 LDX #0
 LDY #20
FILLMAP:
 LDA #$42
 STA $6001,X
 LDA #$84
 STA $6002,X
 LDA #$26
 STA $6005,X
 LDA #$C8
 STA $6006,X
 TXA
 CLC
 ADC #8
 TAX
 DEY
 BNE FILLMAP
 ; XDL local $01E00: AtMapOn + repeat; attribute address/stride only.
 LDA #0
 STA XDL0
 LDA #$1E
 STA XDL1
 LDA #0
 STA XDL2
 ; Enable XDL after both its descriptor and map row are initialized.
 LDA #$22
 STA DMACTL
 LDA #5
 STA VIDEO
LOOP: JMP LOOP
.RUN START
