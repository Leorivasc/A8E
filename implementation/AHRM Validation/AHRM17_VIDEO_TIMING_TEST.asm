; AHRM-17 PAL/NTSC video timing diagnostic.
; Samples VCOUNT continuously while a DLI counts four complete frames, then
; displays the observed minimum, maximum, and frame count.

.ORG $2000

DMACTL  = $D400
VCOUNT  = $D40B
NMIEN   = $D40E
NMIRES  = $D40F
DLISTL  = $D402
DLISTH  = $D403
CHBASE  = $D409

SDLSTL  = $0230
VDSLST  = $0200
SRC_LO  = $80
SRC_HI  = $81
DST_LO  = $82
DST_HI  = $83
VALUE   = $84
VCOUNT_MIN = $2FF0
VCOUNT_MAX = $2FF1
FRAME_COUNT = $2FF2
DONE    = $2FF3

START:
        LDA #$00
        STA NMIEN
        STA FRAME_COUNT
        STA DONE
        LDA #$FF
        STA VCOUNT_MIN
        LDA #$00
        STA VCOUNT_MAX
        LDA #$E0
        STA CHBASE
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
        JSR CLEAR_SCREEN
        JSR DRAW_LABELS
        LDA #$C0
        STA NMIEN

SAMPLE_LOOP:
        LDA VCOUNT
        CMP VCOUNT_MIN
        BCS SAMPLE_MAX
        STA VCOUNT_MIN
SAMPLE_MAX:
        CMP VCOUNT_MAX
        BCC SAMPLE_DONE
        STA VCOUNT_MAX
SAMPLE_DONE:
        STA VALUE
        LDX #<(SCREEN + 123)
        LDY #>(SCREEN + 123)
        STX DST_LO
        STY DST_HI
        JSR WRITE_HEX
        LDA DONE
        BEQ SAMPLE_LOOP
        LDA VCOUNT_MIN
        LDX #<(SCREEN + 163)
        LDY #>(SCREEN + 163)
        STX DST_LO
        STY DST_HI
        JSR WRITE_HEX
        LDA VCOUNT_MAX
        LDX #<(SCREEN + 203)
        LDY #>(SCREEN + 203)
        STX DST_LO
        STY DST_HI
        JSR WRITE_HEX
        LDA FRAME_COUNT
        LDX #<(SCREEN + 243)
        LDY #>(SCREEN + 243)
        STX DST_LO
        STY DST_HI
        JSR WRITE_HEX
WAIT:
        JMP WAIT

DLI_HANDLER:
        PHA
        LDA FRAME_COUNT
        CLC
        ADC #$01
        STA FRAME_COUNT
        CMP #$04
        BCC DLI_DONE
        LDA #$01
        STA DONE
DLI_DONE:
        LDA #$80
        STA NMIRES
        PLA
        RTI

WRITE_HEX:
        STA VALUE
        LSR A
        LSR A
        LSR A
        LSR A
        AND #$0F
        TAX
        LDA HEX_DIGITS,X
        LDY #$00
        STA (DST_LO),Y
        LDA VALUE
        AND #$0F
        TAX
        LDA HEX_DIGITS,X
        LDY #$01
        STA (DST_LO),Y
        RTS

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

HEX_DIGITS:
        .BYTE $10,$11,$12,$13,$14,$15,$16,$17
        .BYTE $18,$19,$21,$22,$23,$24,$25,$26
TITLE_TEXT:
        .BYTE "AHRM17 PAL NTSC VCOUNT", $00
DETAIL_TEXT:
        .BYTE "NOW MIN MAX FRAMES", $00

.ORG $3000
DISPLAY_LIST:
        .BYTE $70, $70, $70
        .BYTE $42, <SCREEN, >SCREEN
        .REPT 23
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
