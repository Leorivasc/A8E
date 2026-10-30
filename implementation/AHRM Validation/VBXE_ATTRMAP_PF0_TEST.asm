; FX 1.26 Attribute Map PF0 diagnostic, without an overlay.
; Expected: a normal-width ANTIC mode-9 field whose central VBXE map area has
; alternating 16-display-pixel red and blue vertical stripes.
.ORG $2000
DMACTL=$D400
DLISTL=$D402
DLISTH=$D403
NMIEN=$D40E
COLBK=$D01A
COLPF0=$D016
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
 ; Keep the ordinary Atari PF0 black outside the normal-width map aperture.
 LDA #0
 STA COLPF0
 ; Fill the 48 ANTIC mode-9 rows with foreground pixels (only 480 bytes are
 ; consumed; the page fill below deliberately leaves extra initialized data).
 LDA #$FF
 LDA #0
 STA $80
 LDA #$32
 STA $81
 LDA #$FF
 LDX #3
 LDY #0
FILLPAGE:
 STA ($80),Y
 INY
 BNE FILLPAGE
 INC $81
 DEX
 BNE FILLPAGE
 LDY #0
FILLTAIL:
 STA ($80),Y
 INY
 CPY #192
 BNE FILLTAIL
 ; 48 4-scanline mode-9 rows, with LMS on the first and JVB at the end.
 LDA #$49
 STA $3000
 LDA #0
 STA $3001
 LDA #$32
 STA $3002
 LDX #46
 LDA #$09
FILLDL:
 STA $3003,X
 DEX
 BPL FILLDL
 LDA #$41
 STA $3032
 LDA #0
 STA $3033
 LDA #$30
 STA $3034
 LDA #0
 STA DLISTL
 LDA #$30
 STA DLISTH
 ; Map local VRAM bank 0 to $4000-$7FFF and define palette 0 colors.
 LDA #$C0
 STA MEMACB
 LDA #$42
 STA CSEL
 LDA #0
 STA PSEL
 LDA #$FE
 STA CR
 LDA #0
 STA CG
 STA CB
 LDA #$84
 STA CSEL
 LDA #0
 STA PSEL
 LDA #0
 STA CR
 STA CG
 LDA #$FE
 STA CB
 ; Clear one 40-cell map row at local $02000. Hardware local VRAM is not
 ; guaranteed to start at zero, and bytes 1-3 include the palette control.
 LDA #0
 LDX #0
CLEARMAP:
 STA $6000,X
 INX
 CPX #160
 BNE CLEARMAP
 ; PF0 alternates red/blue; the map stride is zero so that row applies to all
 ; 192 scanlines.
 LDX #0
 LDY #20
FILLMAP:
 LDA #$42
 STA $6000,X
 LDA #$84
 STA $6004,X
 TXA
 CLC
 ADC #8
 TAX
 DEY
 BNE FILLMAP
 ; XDL local $01000: AtMapOn + repeat; attribute address/stride only.
 LDA #$28
 STA $5000
 LDA #$02
 STA $5001
 LDA #$BF
 STA $5002
 LDA #0
 STA $5003
 LDA #$20
 STA $5004
 LDA #0
 STA $5005
 STA $5006
 STA $5007
 LDA #0
 STA XDL0
 LDA #$10
 STA XDL1
 LDA #$22
 STA DMACTL
 LDA #0
 STA XDL2
 LDA #1
 STA VIDEO
LOOP: JMP LOOP
.RUN START
