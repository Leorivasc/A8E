; AHRM-15 CPU contention diagnostic.
; Counts a tight loop during fixed 16-frame phases with display DMA disabled,
; normal playfield DMA, PMG DMA, one-line PMG, and wide playfield DMA.

.ORG $2000

DMACTL  = $D400
CHBASE  = $D409
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
COUNT_LO = $84
COUNT_HI = $85
VALUE = $87
LAST_PHASE = $86
PHASE = $2FF0
PHASE_TICKS = $2FF1
FRAME_COUNT = $2FF2

START:
        LDA #$00
        STA NMIEN
        STA PHASE
        STA PHASE_TICKS
        STA FRAME_COUNT
        STA LAST_PHASE
        STA COUNT_LO
        STA COUNT_HI
        LDA #$E0
        STA CHBASE
        LDA #$20
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

; Count loop iterations until the DLI advances to the next DMA phase.
MEASURE_LOOP:
        INC COUNT_LO
        BNE MEASURE_CHECK
        INC COUNT_HI
MEASURE_CHECK:
        LDA PHASE
        CMP LAST_PHASE
        BEQ MEASURE_LOOP
        LDX LAST_PHASE
        JSR STORE_RESULT
        LDA PHASE
        STA LAST_PHASE
        LDA #$00
        STA COUNT_LO
        STA COUNT_HI
        LDA PHASE
        CMP #$05
        BCC MEASURE_LOOP

; Restore a visible normal display and leave the final result on screen.
        LDA #$22
        STA DMACTL
        JSR DRAW_RESULTS
WAIT:
        JMP WAIT

; A DLI occurs once per frame. Each configuration lasts 16 frames.
DLI_HANDLER:
        PHA
        TXA
        PHA
        LDA FRAME_COUNT
        CLC
        ADC #$01
        STA FRAME_COUNT
        LDA FRAME_COUNT
        CMP #$10
        BCC DLI_DONE
        LDA #$00
        STA FRAME_COUNT
        INC PHASE
        LDA PHASE
        CMP #$06
        BCC DLI_APPLY
        LDA #$05
        STA PHASE
DLI_APPLY:
        TAX
        LDA DMA_VALUES,X
        STA DMACTL
DLI_DONE:
        LDA #$80
        STA NMIRES
        PLA
        TAX
        PLA
        RTI

STORE_RESULT:
        LDA COUNT_LO
        STA RESULT_LO,X
        LDA COUNT_HI
        STA RESULT_HI,X
        RTS

DRAW_RESULTS:
        LDX #$00
DRAW_RESULTS_LOOP:
        LDA RESULT_LO,X
        STA VALUE
        LDA RESULT_DEST_LO,X
        STA DST_LO
        LDA RESULT_DEST_HI,X
        STA DST_HI
        LDA VALUE
        JSR WRITE_HEX
        LDA RESULT_HI,X
        STA VALUE
        LDA RESULT_DEST_LO,X
        CLC
        ADC #$02
        STA DST_LO
        LDA RESULT_DEST_HI,X
        ADC #$00
        STA DST_HI
        LDA VALUE
        JSR WRITE_HEX
        INX
        CPX #$05
        BCC DRAW_RESULTS_LOOP
        RTS

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

DMA_VALUES:
        .BYTE $20, $22, $2E, $3E, $2F, $22
RESULT_LO:
        .REPT 6
        .BYTE $00
        .ENDR
RESULT_HI:
        .REPT 6
        .BYTE $00
        .ENDR
RESULT_DEST_LO:
        .BYTE <(SCREEN + 123), <(SCREEN + 163), <(SCREEN + 203), <(SCREEN + 243), <(SCREEN + 283)
RESULT_DEST_HI:
        .BYTE >(SCREEN + 123), >(SCREEN + 163), >(SCREEN + 203), >(SCREEN + 243), >(SCREEN + 283)
HEX_DIGITS:
        .BYTE $10,$11,$12,$13,$14,$15,$16,$17
        .BYTE $18,$19,$21,$22,$23,$24,$25,$26
TITLE_TEXT:
        .BYTE "AHRM15 CPU DMA CONTENTION", $00
DETAIL_TEXT:
        .BYTE "00 22 2E 3E 2F ITERATIONS", $00

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
