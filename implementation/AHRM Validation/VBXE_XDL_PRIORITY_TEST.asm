; XDL priority: top 96 green-overlay lines hidden behind Atari background,
; bottom 96 lines visible over it.
.ORG $2000
NMIEN=$D40E
COLBK=$D01A
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
 LDA #$84
 STA COLBK
 LDA #$C0
 STA MEMACB
 LDA #0
 LDX #0
CLEAR: STA $4000,X
 STA $4100,X
 INX
 BNE CLEAR
 LDA #1
 LDX #0
FILL: STA $4000,X
 INX
 CPX #160
 BNE FILL
 LDA #1
 STA CSEL
 STA PSEL
 LDA #0
 STA CR
 LDA #$FE
 STA CG
 LDA #0
 STA CB
 ; First 96 lines: lores, address, repeat, palette 1, priority 00.
 LDA #$62
 STA $5000
 LDA #$28
 STA $5001
 LDA #95
 STA $5002
 LDA #0
 STA $5003
 STA $5004
 STA $5005
 STA $5006
 STA $5007
 LDA #$14
 STA $5008
 LDA #0
 STA $5009
 ; Second 96 lines: retain address/mode, change repeat and priority FF.
 LDA #$22
 STA $500A
 LDA #$28
 STA $500B
 LDA #95
 STA $500C
 LDA #$14
 STA $500D
 LDA #$FF
 STA $500E
 LDA #0
 STA $500F
 LDA #$80
 STA $5010
 LDA #0
 STA XDL0
 LDA #$10
 STA XDL1
 LDA #0
 STA XDL2
 LDA #5
 STA VIDEO
LOOP: JMP LOOP
.RUN START
