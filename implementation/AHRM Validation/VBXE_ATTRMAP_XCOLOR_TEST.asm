; FX 1.26 attribute-map XCOLOR diagnostic, without an overlay.
; Expected: alternating green/magenta PF0 stripes. If XCOLOR were disabled,
; the same odd map codes would be forced to their red/blue even neighbours.
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
 STA COLPF0
 ; 48 mode-9 rows use 480 foreground bytes at $3200.
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
 ; LMS mode 9, then 47 more lines and a JVB.
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
 ; MEMAC B bank 0 exposes local XDL/map memory at $4000-$7FFF.
 LDA #$C0
 STA MEMACB
 LDA #0
 STA PSEL
 ; Even palette neighbours: red/blue.
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
 ; Odd palette entries selected only while VIDEO_CONTROL XCOLOR is enabled.
 LDA #$43
 STA CSEL
 LDA #0
 STA CR
 LDA #$FE
 STA CG
 LDA #0
 STA CB
 LDA #$85
 STA CSEL
 LDA #$FE
 STA CR
 LDA #0
 STA CG
 LDA #$FE
 STA CB
 ; Clear the one 40-cell map row, then alternate odd PF0 color values.
 LDA #0
 LDX #0
CLEARMAP:
 STA $6000,X
 INX
 CPX #160
 BNE CLEARMAP
 LDX #0
 LDY #20
FILLMAP:
 LDA #$43
 STA $6000,X
 LDA #$85
 STA $6004,X
 TXA
 CLC
 ADC #8
 TAX
 DEY
 BNE FILLMAP
 ; XDL local $01000: AtMapOn + repeat; map $02000, stride zero.
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
 ; XDL enable + XCOLOR: odd map codes must remain odd.
 LDA #3
 STA VIDEO
LOOP: JMP LOOP
.RUN START
