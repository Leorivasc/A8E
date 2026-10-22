; AHRM-18 POKEY RANDOM and timer diagnostic.
; Captures a fixed RANDOM sequence after initialization, then measures a
; timer-1 IRQ polling boundary with AUDF1=$05.

.ORG $2000

AUDF1   = $D200
AUDCTL  = $D208
STIMER  = $D209
RANDOM  = $D20A
IRQEN   = $D20E
IRQST   = $D20E
SKCTL   = $D20F
WSYNC   = $D40A
DMACTL  = $D400
CHBASE  = $D409
DLISTL  = $D402
DLISTH  = $D403
SDLSTL  = $0230

SRC_LO  = $80
SRC_HI  = $81
DST_LO  = $82
DST_HI  = $83
VALUE   = $84
RANDOM_RESULTS = $2FF0
TIMER_COUNT = $2FF8

START:
        SEI
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
        JSR CLEAR_SCREEN
        JSR DRAW_LABELS

        JSR RESET_POKEY
        LDX #$00
CAPTURE_RANDOM:
        LDA RANDOM
        STA RANDOM_RESULTS,X
        STA WSYNC
        INX
        CPX #$08
        BCC CAPTURE_RANDOM
        JSR DRAW_RANDOM_RESULTS

        JSR RESET_POKEY
        LDA #$00
        STA AUDCTL
        LDA #$05
        STA AUDF1
        LDA #$00
        STA STIMER
        LDA #$01
        STA IRQEN
        LDA #$00
        STA TIMER_COUNT
WAIT_TIMER:
        LDA IRQST
        AND #$01
        BEQ TIMER_DONE
        INC TIMER_COUNT
        BNE WAIT_TIMER
TIMER_DONE:
        LDA #$00
        STA IRQEN
        LDA TIMER_COUNT
        LDX #<(SCREEN + 423)
        LDY #>(SCREEN + 423)
        STX DST_LO
        STY DST_HI
        JSR WRITE_HEX
WAIT:
        JMP WAIT

RESET_POKEY:
        LDA #$00
        STA SKCTL
        LDA #$7F
        STA IRQEN
        LDA #$00
        STA IRQEN
        LDA #$03
        STA SKCTL
        RTS

DRAW_RANDOM_RESULTS:
        LDX #$00
DRAW_RANDOM_LOOP:
        LDA RANDOM_RESULTS,X
        LDA RESULT_DEST_LO,X
        STA DST_LO
        LDA RESULT_DEST_HI,X
        STA DST_HI
        LDA RANDOM_RESULTS,X
        JSR WRITE_HEX
        INX
        CPX #$08
        BCC DRAW_RANDOM_LOOP
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
        LDA #<RANDOM_TEXT
        STA SRC_LO
        LDA #>RANDOM_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 40)
        STA DST_LO
        LDA #>(SCREEN + 40)
        STA DST_HI
        JSR DRAW_TEXT
        LDA #<TIMER_TEXT
        STA SRC_LO
        LDA #>TIMER_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 400)
        STA DST_LO
        LDA #>(SCREEN + 400)
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

RESULT_DEST_LO:
        .BYTE <(SCREEN + 83), <(SCREEN + 123), <(SCREEN + 163), <(SCREEN + 203)
        .BYTE <(SCREEN + 243), <(SCREEN + 283), <(SCREEN + 323), <(SCREEN + 363)
RESULT_DEST_HI:
        .BYTE >(SCREEN + 83), >(SCREEN + 123), >(SCREEN + 163), >(SCREEN + 203)
        .BYTE >(SCREEN + 243), >(SCREEN + 283), >(SCREEN + 323), >(SCREEN + 363)
HEX_DIGITS:
        .BYTE $10,$11,$12,$13,$14,$15,$16,$17
        .BYTE $18,$19,$21,$22,$23,$24,$25,$26
TITLE_TEXT:
        .BYTE "AHRM18 POKEY RANDOM TIMER", $00
RANDOM_TEXT:
        .BYTE "RANDOM SEQUENCE AFTER INIT", $00
TIMER_TEXT:
        .BYTE "TIMER1 AUDF5 IRQ LOOPS", $00

.ORG $3000
DISPLAY_LIST:
        .BYTE $70, $70, $70
        .BYTE $42, <SCREEN, >SCREEN
        .REPT 23
        .BYTE $02
        .ENDR
        .BYTE $41, <DISPLAY_LIST, >DISPLAY_LIST

.ORG $4000
SCREEN:
        .REPT 960
        .BYTE $00
        .ENDR

.RUN START
