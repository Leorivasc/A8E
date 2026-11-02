; Shared FX 1.26 attribute-map horizontal-phase diagnostic. The map is active
; only at the start of the frame, where the restarted wrapper forces one extra
; buffered-row fetch. A fully initialised opaque standard XDL plane supplies a
; single visible palette entry. Each DLI paints that entry blue; the
; blitter-complete IRQ paints its remainder red and disables further DLIs.
; Compare the blue/red edge between the continuous and restarted wrappers.
.ORG $2000
DMACTL=$D400
DLISTL=$D402
DLISTH=$D403
NMIEN=$D40E
VCOUNT=$D40B
VIDEO=$D640
XDL0=$D641
XDL1=$D642
XDL2=$D643
CSEL=$D644
PSEL=$D645
CR=$D646
CG=$D647
CB=$D648
MEMACB=$D65D
BLT0=$D650
BLT1=$D651
BLT2=$D652
BLTSTART=$D653
IRQCONTROL=$D654
IRQVEC=$0216
DLIVEC=$0200
ROWS=$82
PTRLO=$80
PTRHI=$81
IRQSEEN=$83
POLLSEEN=$84
STARTED=$85
INITIAL=$86

START:
 LDA #0
 STA NMIEN
 STA ROWS
 STA IRQSEEN
 STA POLLSEEN
 STA STARTED
 STA INITIAL
 LDA #$C0
 STA MEMACB
 LDA #<DISPLAY_LIST
 STA DLISTL
 LDA #>DISPLAY_LIST
 STA DLISTH
 LDA #$22
 STA DMACTL
 ; Give the ANTIC field, opaque overlay, and attribute-map row deterministic
 ; input. MEMAC B $CA maps CPU $4000 to local $28000, the repeated opaque
 ; standard-overlay source. MEMAC B $C0 maps CPU $6000 to local $02000, the
 ; XDL. $C8 maps CPU $6000 to local $22000, the map address used below.
 ; MEMAC B $C0 maps CPU $4000-$7FFF to local $00000-$03FFF, which is
 ; the Graphics 8 source. The 8-pixel map cells use 24 rows at stride $00A0;
 ; clear all 4 KiB they can fetch, not only the first 172-byte line buffer.
 ; Otherwise an Altirra cold/warm start can expose prior local VRAM.
 LDA #0
 STA PTRLO
 LDA #$40
 STA PTRHI
 LDA #$FF
 LDX #30
 JSR FILL_PAGES
 LDA #$CA
 STA MEMACB
 LDA #0
 STA PTRLO
 LDA #$40
 STA PTRHI
 LDA #$FF
 LDX #2
 JSR FILL_PAGES
 LDA #$C8
 STA MEMACB
 LDA #0
 STA PTRLO
 LDA #$60
 STA PTRHI
 LDA #0
 LDX #16
 JSR FILL_PAGES
 LDA #$C0
 STA MEMACB
 ; Attribute map starts at line 8. After four lines the continuous form turns
 ; it off, while the restarted form readdresses it for one line first. This
 ; preserves the single extra 172-byte buffered fetch. Build the corresponding
 ; XDL at local $02000 after the map is initialised; its standard source is
 ; local $28000 and repeats with zero stride.
 LDA #$C0
 STA MEMACB
 LDA #$6A
 STA $6000
 LDA #2
 STA $6001
 LDA #3
 STA $6002
 LDA #0
 STA $6003
 LDA #$80
 STA $6004
 LDA #2
 STA $6005
 LDA #0
 STA $6006
 STA $6007
 LDA #0
 STA $6008
 LDA #$20
 STA $6009
 LDA #2
 STA $600A
 LDA #$A0
 STA $600B
 LDA #0
 STA $600C
.ifdef RESTART_MAP
 LDA #$08
 STA $600D
 LDA #2
 STA $600E
 LDA #0
 STA $600F
 LDA #$20
 STA $6010
 LDA #2
 STA $6011
 LDA #$A0
 STA $6012
 LDA #0
 STA $6013
 LDA #$30
 STA $6014
 LDA #0
 STA $6015
 LDA #$FF
 STA $6016
.else
 LDA #$30
 STA $600D
 LDA #0
 STA $600E
 LDA #$FF
 STA $600F
.endif
 ; Palette 0/color 0 covers the map's early rows. Palette 1/color $FF is the
 ; opaque standard XDL source and remains selected for the DLI/IRQ marker.
 LDA #0
 STA PSEL
 STA CSEL
 LDA #0
 STA CR
 STA CG
 LDA #$FE
 STA CB
 LDA #1
 STA PSEL
 LDA #$FF
 STA CSEL
 LDA #0
 STA CR
 STA CG
 LDA #$FE
 STA CB
 LDA #$FF
 STA CSEL
 LDA #0
 STA XDL0
 LDA #$20
 STA XDL1
 LDA #0
 STA XDL2
 LDA #5
 STA VIDEO
 LDA #<IRQ_HANDLER
 STA IRQVEC
 LDA #>IRQ_HANDLER
 STA IRQVEC+1
 LDA #<DLI_HANDLER
 STA DLIVEC
 LDA #>DLI_HANDLER
 STA DLIVEC+1
 ; BLT0-2 point at local $03000. It remains outside the displayed 7,680-byte
 ; Graphics-8 source and is reachable through the current $C0 MEMAC mapping.
 LDY #0
COPY_BLOCK:
 LDA BLIT_BLOCK,Y
 STA $7000,Y
 INY
 CPY #21
 BNE COPY_BLOCK
 LDA #0
 STA BLT0
 LDA #$30
 STA BLT1
 STA BLT2
 LDA #$80
 STA NMIEN
 CLI
MAIN:
 LDA BLTSTART
 AND #3
 BNE MAIN
 LDA INITIAL
 BNE START_IF_REQUEST
 LDA IRQSEEN
 BEQ START_IF_REQUEST
 LDA #1
 STA INITIAL
READY:
 JMP MAIN
START_IF_REQUEST:
 LDA STARTED
 BEQ MAIN
 LDA #0
 STA STARTED
 LDA #1
 STA IRQCONTROL
 STA BLTSTART
 STA POLLSEEN
 JMP MAIN

DLI_HANDLER:
 PHA
 ; Palette 1/color $FF remains selected after setup. It is the only visible
 ; marker once the attribute map turns off.
 LDA #$FF
 STA CSEL
 LDA #0
 STA CR
 STA CG
 LDA #$FE
 STA CB
 LDA #1
 STA STARTED
DLI_DONE:
 PLA
 RTI

IRQ_HANDLER:
 PHA
 LDA VCOUNT
 STA ROWS
 INC IRQSEEN
 ; The only DLI in this frame has already painted palette 1/color $FF blue.
 ; Paint it red until the next frame's first DLI restarts the measurement.
 LDA #$FF
 STA CSEL
 LDA #$FE
 STA CR
 LDA #0
 STA CG
 STA CB
 LDA #0
 STA IRQCONTROL
 PLA
 RTI

; A contains the byte to write; X is the number of pages. The pointer is
; in the CPU view selected by MEMAC B.
FILL_PAGES:
 LDY #0
FILL_BYTE:
 STA (PTRLO),Y
 INY
 BNE FILL_BYTE
 INC PTRHI
 DEX
 BNE FILL_PAGES
 RTS

; 512 bytes x 64 rows, mode-0 copy. The destination is local $10000, not
; local $00000: the latter is the concurrently displayed Graphics-8 field.
BLIT_BLOCK:
 .BYTE $00,$00,$03, $00,$00,$01, $00,$00,$01, $00,$02,$01
 .BYTE $FF,$01,$3F, $FF,$00,$00, $00,$00,$00

.ORG $3000
DISPLAY_LIST:
 .BYTE $70,$70,$70
 .BYTE $CF,$00,$40
 .REPT 191
 .BYTE $0F
 .ENDR
 .BYTE $41,<DISPLAY_LIST,>DISPLAY_LIST

.RUN START
