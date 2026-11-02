; FX 1.26 VBXE overlay collision probe for GTIA multicolor and P5.
; $0082 receives COLDETECT for overlapping P0+P1 with PRIOR bit 5.
; $0083 receives COLDETECT for missile 0 as P5 with PRIOR bit 4.
.ORG $2000
DMACTL=$D400
DLISTL=$D402
DLISTH=$D403
NMIEN=$D40E
VCOUNT=$D40B
HPOSP0=$D000
HPOSP1=$D001
HPOSM0=$D004
GRAFP0=$D00D
GRAFP1=$D00E
GRAFM=$D011
PRIOR=$D01B
GRACTL=$D01D
HITCLR=$D01E
MEMACB=$D65D
VIDEO=$D640
XDL0=$D641
XDL1=$D642
XDL2=$D643
COLMASK=$D649
COLDETECT=$D64A
COLCLR=$D64A
RESULTS=$82

START:
 LDA #0
 STA NMIEN
 STA RESULTS
 STA RESULTS+1
 LDA #$C0
 STA MEMACB
 LDA #<DISPLAY_LIST
 STA DLISTL
 LDA #>DISPLAY_LIST
 STA DLISTH
 LDA #$22
 STA DMACTL
 LDA #3
 STA GRACTL
 ; Solid standard overlay source at local $00000.
 LDA #1
 LDX #0
FILL:
 STA $4000,X
 STA $4100,X
 INX
 BNE FILL
 ; XDL at $01000: standard graphics, normal width, repeat 192 lines.
 LDA #$62
 STA $5000
 LDA #8
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
 STA XDL2
 LDA #1
 STA VIDEO
 LDA #$60
 STA HPOSP0
 STA HPOSP1
 STA HPOSM0
 LDA #1
 STA COLMASK
 ; P0+P1 overlap in multicolor mode must expose both contributors.
 LDA #$FF
 STA GRAFP0
 STA GRAFP1
 LDA #$20
 JSR SAMPLE
 STA RESULTS
 ; P5 uses the PF3/P5 contributor bit after players are removed.
 LDA #0
 STA GRAFP0
 STA GRAFP1
 STA HPOSP0
 STA HPOSP1
 LDA #3
 STA GRAFM
 LDA #$10
 JSR SAMPLE
 STA RESULTS+1
READY:
 JMP READY

; A=GTIA PRIOR. Clear both collision latches, wait for active XDL, return VBXE.
SAMPLE:
 STA PRIOR
 STA HITCLR
 STA COLCLR
; A complete new field is required: GTIA's line priority plane has already
; been composed when the previous measurement returns.
WAIT_FRAME:
 LDA VCOUNT
 BNE WAIT_FRAME
WAIT_ZERO:
 LDA VCOUNT
 BNE WAIT_ZERO
WAIT_ACTIVE:
 LDA VCOUNT
 CMP #$10
 BCC WAIT_ACTIVE
 LDA COLDETECT
 RTS

.ORG $3000
DISPLAY_LIST:
 .BYTE $70,$70,$70
 ; ANTIC fetches local $02000, which is left at zero.  The XDL source
 ; remains local $00000, so the backdrop cannot add PF collision bits.
 .BYTE $4F,$00,$60
 .REPT 191
 .BYTE $0F
 .ENDR
 .BYTE $41,<DISPLAY_LIST,>DISPLAY_LIST

.RUN START
