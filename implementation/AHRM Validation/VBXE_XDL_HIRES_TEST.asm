; FX 1.26 hires XDL overlay: solid blue 640x192 field.
; Assemble in jsA8E, then compare with Altirra configured for VBXE FX 1.26
; at $D600. The expected field is centered and top-aligned like the existing
; standard/lores diagnostics, but has hires source resolution.
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
 ; Fill the 320-byte hires row at local $00000 with color 1 in both nibbles.
 LDA #$11
 LDX #0
FILL256:
 STA $4000,X
 INX
 BNE FILL256
 LDX #0
FILL64:
 STA $4100,X
 INX
 CPX #64
 BNE FILL64
 ; Palette 1, color 1 = blue.
 LDA #1
 STA CSEL
 STA PSEL
 LDA #0
 STA CR
 STA CG
 LDA #$FE
 STA CB
 ; XDL local $1000: graphics + repeat + address, hires graphics mode.
 LDA #$62
 STA $5000
 LDA #$10
 STA $5001
 LDA #$BF
 STA $5002
 LDA #0
 STA $5003
 STA $5004
 STA $5005
 STA $5006
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
 LDA #1
 STA VIDEO
LOOP: JMP LOOP
.RUN START
