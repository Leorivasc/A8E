; Minimal FX 1.26 standard-resolution XDL overlay: solid red 320x192 field.
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
 LDA #1
 LDX #0
FILL:
 STA $4000,X
 STA $4100,X
 INX
 BNE FILL
 LDX #0
FILL64:
 STA $4200,X
 INX
 CPX #64
 BNE FILL64
 ; Palette 1, color 1 = red.
 LDA #1
 STA CSEL
 STA PSEL
 LDA #$FE
 STA CR
 LDA #0
 STA CG
 STA CB
 ; XDL at local $1000 (CPU $5000): graphics, address, repeat 192 lines.
 LDA #$62
 STA $5000
 LDA #$08
 STA $5001
 LDA #$BF
 STA $5002
 LDA #0
 STA $5003
 STA $5004
 STA $5005
 ; A repeated XDL mode line still advances by its stride. Keep it at zero so
 ; all 192 scan lines deliberately reuse the 320-byte row at local $00000.
 LDA #$00
 STA $5006
 LDA #0
 STA $5007
 LDA #$14
 STA $5008
 LDA #$FF
 STA $5009
 LDA #0
 STA $500A
 LDA #$80
 STA $500B
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
