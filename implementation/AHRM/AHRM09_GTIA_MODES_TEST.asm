; AHRM-09 GTIA special-mode visual diagnostic.
; The complete visible playfield is a deterministic ramp. The program cycles
; GTIA modes 9, 10, and 11, holding each mode for 128 frames. There is no
; text overlay: the full-screen colour change is the diagnostic output.

.ORG $2000

PRIOR   = $D01B
COLBK   = $D01A
DMACTL  = $D400
NMIEN   = $D40E
NMIRES  = $D40F
DLISTL  = $D402
DLISTH  = $D403

SDLSTL  = $0230
VDSLST  = $0200
SRC_LO  = $80
SRC_HI  = $81
DST_LO  = $82
DST_HI  = $83
MODE_TICKS = $2FF0
MODE_INDEX = $2FF1
ROW_COUNT  = $2FF2
PHASE_FRAMES = $80

START:
        LDA #$00
        STA NMIEN
        STA MODE_TICKS
        STA MODE_INDEX
        STA COLBK
        LDA #$40
        STA PRIOR
        LDA #$22
        STA DMACTL

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

        JSR DRAW_PATTERN
        LDA #$80
        STA NMIEN

WAIT:
        JMP WAIT

; One DLI per frame. The phase is held for 128 frames before the next mode
; and background colour are selected.
DLI_HANDLER:
        PHA
        TXA
        PHA
        INC MODE_TICKS
        LDA MODE_TICKS
        CMP #PHASE_FRAMES
        BCC DLI_DONE
        LDA #$00
        STA MODE_TICKS
        INC MODE_INDEX
        LDA MODE_INDEX
        CMP #$03
        BCC DLI_SELECT
        LDA #$00
        STA MODE_INDEX

DLI_SELECT:
        TAX
        LDA GTIA_MODES,X
        STA PRIOR
        LDA GTIA_BACKGROUNDS,X
        STA COLBK

DLI_DONE:
        LDA #$80
        STA NMIRES
        PLA
        TAX
        PLA
        RTI

; Fill all 24 screen rows with the same 40-byte colour ramp.
DRAW_PATTERN:
        LDA #<SCREEN
        STA DST_LO
        LDA #>SCREEN
        STA DST_HI
        LDA #$18
        STA ROW_COUNT

DRAW_PATTERN_ROW:
        LDX #$00
        LDY #$00

DRAW_PATTERN_BYTE:
        LDA RAMP_DATA,X
        STA (DST_LO),Y
        INX
        INY
        CPY #$28
        BCC DRAW_PATTERN_BYTE

        CLC
        LDA DST_LO
        ADC #$28
        STA DST_LO
        BCC DRAW_PATTERN_NEXT_ROW
        INC DST_HI

DRAW_PATTERN_NEXT_ROW:
        DEC ROW_COUNT
        BNE DRAW_PATTERN_ROW
        RTS

GTIA_MODES:
        .BYTE $40, $80, $C0
GTIA_BACKGROUNDS:
        .BYTE $00, $24, $52
RAMP_DATA:
        .BYTE $00,$11,$22,$33,$44,$55,$66,$77
        .BYTE $88,$99,$AA,$BB,$CC,$DD,$EE,$FF
        .BYTE $00,$11,$22,$33,$44,$55,$66,$77
        .BYTE $88,$99,$AA,$BB,$CC,$DD,$EE,$FF
        .BYTE $00,$11,$22,$33,$44,$55,$66,$77

.ORG $3000
DISPLAY_LIST:
        .BYTE $70, $70, $70
        .BYTE $42, <SCREEN, >SCREEN
        .REPT 22
        .BYTE $02
        .ENDR
        .BYTE $82
        .BYTE $41, <DISPLAY_LIST, >DISPLAY_LIST

.ORG $4000
SCREEN:
        .REPT 960
        .BYTE $00
        .ENDR

.RUN START
