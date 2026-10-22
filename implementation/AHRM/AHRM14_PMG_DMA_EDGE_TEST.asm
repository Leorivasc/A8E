; AHRM-14 player/missile DMA edge diagnostic.
; Cycles PMBASE, one-line/two-line resolution, VDELAY, HPOS, and graphic
; patterns. Each phase is held for 32 frames for hardware comparison.

.ORG $2000

DMACTL  = $D400
PMBASE  = $D407
CHBASE  = $D409
NMIEN   = $D40E
NMIRES  = $D40F
DLISTL  = $D402
DLISTH  = $D403
VDELAY  = $D01C
GRACTL  = $D01D
HITCLR  = $D01E
HPOSP0  = $D000
HPOSP1  = $D001
HPOSP2  = $D002
HPOSP3  = $D003
SIZEP0  = $D008
SIZEP1  = $D009
SIZEP2  = $D00A
SIZEP3  = $D00B
COLPM0  = $D012
COLPM1  = $D013
COLPM2  = $D014
COLPM3  = $D015
COLBK   = $D01A
COLPF0  = $D016
COLPF1  = $D017

SDLSTL  = $0230
VDSLST  = $0200
SRC_LO  = $80
SRC_HI  = $81
DST_LO  = $82
DST_HI  = $83
PHASE   = $2FF0
PHASE_TICKS = $2FF1

START:
        LDA #$00
        STA NMIEN
        STA PHASE
        STA PHASE_TICKS
        STA VDELAY
        STA COLBK
        LDA #$E0
        STA CHBASE
        LDA #$2E
        STA DMACTL
        LDA #$03
        STA GRACTL
        LDA #$40
        STA PMBASE
        LDA #$30
        STA HPOSP0
        LDA #$50
        STA HPOSP1
        LDA #$70
        STA HPOSP2
        LDA #$90
        STA HPOSP3
        LDA #$00
        STA SIZEP0
        STA SIZEP1
        STA SIZEP2
        STA SIZEP3
        LDA #$34
        STA COLPM0
        LDA #$46
        STA COLPM1
        LDA #$58
        STA COLPM2
        LDA #$6A
        STA COLPM3
        STA HITCLR

        LDA #<DISPLAY_LIST
        STA SDLSTL
        STA DLISTL
        LDA #>DISPLAY_LIST
        STA SDLSTL + 1
        STA DLISTH
        LDA #<DLI_HANDLER
        STA VDSLST
        LDA #>DLI_HANDLER
        STA VDSLST + 1
        JSR CLEAR_SCREEN
        JSR DRAW_LABELS
        LDA #$C0
        STA NMIEN

WAIT:
        JMP WAIT

; Phase 0: two-line PMBASE=$40. Phase 1: one-line PMBASE=$80. Phase 2:
; VDELAY and shifted positions. Phase 3: two-line PMBASE=$80. The final
; phase returns to the initial configuration after another 32 frames.
DLI_HANDLER:
        PHA
        TXA
        PHA
        LDA PHASE_TICKS
        CLC
        ADC #$01
        STA PHASE_TICKS
        CMP #$20
        BCC DLI_DONE
        LDA #$00
        STA PHASE_TICKS
        INC PHASE
        LDA PHASE
        CMP #$04
        BCC APPLY_PHASE
        LDA #$00
        STA PHASE
APPLY_PHASE:
        TAX
        LDA DMA_VALUES,X
        STA DMACTL
        LDA PMBASE_VALUES,X
        STA PMBASE
        LDA VDELAY_VALUES,X
        STA VDELAY
        LDA HPOS_VALUES,X
        STA HPOSP0
        CLC
        ADC #$20
        STA HPOSP1
        CLC
        ADC #$20
        STA HPOSP2
        CLC
        ADC #$20
        STA HPOSP3
DLI_DONE:
        LDA #$80
        STA NMIRES
        PLA
        TAX
        PLA
        RTI

CLEAR_SCREEN:
        LDX #$00
        LDA #$00
CLEAR_LOOP:
        STA SCREEN,X
        STA SCREEN + 256,X
        STA SCREEN + 512,X
        STA SCREEN + 768,X
        INX
        BNE CLEAR_LOOP
        RTS

DRAW_LABELS:
        LDA #<TITLE_TEXT
        STA SRC_LO
        LDA #>TITLE_TEXT
        STA SRC_HI
        LDA #<SCREEN
        STA DST_LO
        LDA #>SCREEN
        STA DST_HI
        JSR DRAW_TEXT
        LDA #<DETAIL_TEXT
        STA SRC_LO
        LDA #>DETAIL_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 40)
        STA DST_LO
        LDA #>(SCREEN + 40)
        STA DST_HI
        JSR DRAW_TEXT
        RTS

DRAW_TEXT:
        LDY #$00
DRAW_TEXT_NEXT:
        LDA (SRC_LO),Y
        BEQ DRAW_TEXT_DONE
        CMP #' '
        BEQ DRAW_TEXT_SPACE
        CMP #'0'
        BCC DRAW_TEXT_LETTER
        SEC
        SBC #$20
        BCS DRAW_TEXT_STORE
DRAW_TEXT_LETTER:
        AND #$1F
        ORA #$20
        BNE DRAW_TEXT_STORE
DRAW_TEXT_SPACE:
        LDA #$00
DRAW_TEXT_STORE:
        STA (DST_LO),Y
        INY
        BNE DRAW_TEXT_NEXT
DRAW_TEXT_DONE:
        RTS

DMA_VALUES:
        .BYTE $2E, $3E, $2E, $2E
PMBASE_VALUES:
        .BYTE $40, $80, $80, $80
VDELAY_VALUES:
        .BYTE $00, $00, $0F, $00
HPOS_VALUES:
        .BYTE $30, $28, $40, $58
TITLE_TEXT:
        .BYTE "AHRM14 PMG DMA EDGE TEST", $00
DETAIL_TEXT:
        .BYTE "2LINE 1LINE VDELAY PMBASE", $00

.ORG $3000
DISPLAY_LIST:
        .BYTE $70, $70, $70
        .BYTE $42, <SCREEN, >SCREEN
        .REPT 23
        .BYTE $02
        .ENDR
        .BYTE $82
        .BYTE $41, <DISPLAY_LIST, >DISPLAY_LIST

; Two-line PMG data at PMBASE=$40: missiles at +$180 and players at +$200.
.ORG $4000
        .REPT 384
        .BYTE $00
        .ENDR
        .REPT 128
        .BYTE $FF
        .ENDR
        .REPT 128
        .BYTE $F0
        .ENDR
        .REPT 128
        .BYTE $0F
        .ENDR
        .REPT 128
        .BYTE $AA
        .ENDR
        .REPT 128
        .BYTE $55
        .ENDR

.ORG $5000
SCREEN:
        .REPT 960
        .BYTE $00
        .ENDR

; One-line PMG data at PMBASE=$80: missiles at +$300 and players at +$400.
.ORG $8000
        .REPT 768
        .BYTE $00
        .ENDR
        .REPT 256
        .BYTE $FF
        .ENDR
        .REPT 256
        .BYTE $F0
        .ENDR
        .REPT 256
        .BYTE $0F
        .ENDR
        .REPT 256
        .BYTE $AA
        .ENDR
        .REPT 256
        .BYTE $55
        .ENDR

.RUN START
