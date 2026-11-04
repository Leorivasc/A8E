; FX 1.26 XDL attribute-map palette and priority diagnostic.
; Expected: a centered normal-width 640-pixel text field of alternating
; 16-pixel green and blue vertical stripes for the whole field. This proves that each 8x8
; standard-resolution attribute cell selects its own overlay palette.
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
P0=$D655
START:
 LDA #0
 STA NMIEN
 ; Map local VRAM bank 0 to $4000-$7FFF for CPU and ANTIC.
 LDA #$C0
 STA MEMACB
 ; 80 text character/attribute pairs, character 1 in palette color 1.
 LDX #0
FILLTEXT:
 LDA #1
 STA $4000,X
 INX
 STA $4000,X
 INX
 CPX #160
 BNE FILLTEXT
 ; Character 1 is a fully set 8x8 glyph at local $00800.
 LDA #$FF
 LDX #7
FILLFONT:
 STA $4808,X
 DEX
 BPL FILLFONT
 ; Palette 2, color 1 = green.
 LDA #1
 STA CSEL
 LDA #2
 STA PSEL
 LDA #0
 STA CR
 LDA #$FE
 STA CG
 LDA #0
 STA CB
 ; Palette 3, color 1 = blue.
 LDA #1
 STA CSEL
 LDA #3
 STA PSEL
 LDA #0
 STA CR
 STA CG
 LDA #$FE
 STA CB
 ; Attribute cells choose P0, which stays above every GTIA layer.
 LDA #$FF
 STA P0
 ; One 40-cell attribute row at local $02000. MAPSTEP is zero below, so this
 ; row is reused for the complete field rather than reading uninitialized
 ; VRAM after every 8 scan lines. Control $20 selects palette 2; $30 selects
 ; palette 3. Each pair covers 16 standard pixels.
 LDX #0
 LDY #20
FILLATTR:
 LDA #$20
 STA $6003,X
 LDA #$30
 STA $6007,X
 TXA
 CLC
 ADC #8
 TAX
 DEY
 BNE FILLATTR
 ; XDL local $01000: text + AtMapOn + repeat + overlay address.
; c1 loads ChBase and attribute address/stride. The reset default is 8x8
; cells with zero map scroll, so no AttrLayout block is needed here.
 LDA #$69
 STA $5000
LDA #$03
 STA $5001
 LDA #$BF
 STA $5002
 LDA #0
 STA $5003
 STA $5004
 STA $5005
 ; Reuse the one initialized 80-character text row on every 8-line glyph row.
 ; A nonzero stride would make later rows fetch uninitialized text data.
 LDA #0
 STA $5006
 STA $5007
 LDA #1
 STA $5008
 LDA #0
 STA $5009
 LDA #$20
 STA $500A
 LDA #0
 STA $500B
 STA $500C
 STA $500D
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
