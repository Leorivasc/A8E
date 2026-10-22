; AHRM-08 Stage 3 POKEY STIMER/SEROUT phase diagnostic.
; The result is an observation of the first DATA NEEDED poll after four
; controlled delays between STIMER and SEROUT, plus one TX COMPLETE result.
; It intentionally does not manufacture a PASS/FAIL decision.

.ORG $2000

DMACTL  = $D400
CHBASE  = $D409
DLISTL  = $D402
DLISTH  = $D403
COLPF0  = $D016
COLPF1  = $D017
COLBK   = $D01A

AUDCTL  = $D208
AUDF4   = $D206
STIMER  = $D209
SEROUT  = $D20D
IRQEN   = $D20E
IRQST   = $D20E
SKCTL   = $D20F

SDLSTL  = $0230
SCREEN  = $4000

SRC_LO  = $80
SRC_HI  = $81
DST_LO  = $82
DST_HI  = $83
VALUE   = $84
MASK    = $85
COUNT_LO = $86
COUNT_HI = $87
TIMEOUT = $88
PAD_INDEX = $89

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
        LDA #$00
        STA COLBK
        LDA #$0E
        STA COLPF0
        LDA #$0A
        STA COLPF1

        JSR CLEAR_SCREEN
        JSR DRAW_LABELS
        LDA #$00
        STA DMACTL

        LDX #$00
PHASE_LOOP:
        STX PAD_INDEX
        JSR TEST_PHASE
        LDX PAD_INDEX
        INX
        CPX #$04
        BNE PHASE_LOOP

        JSR TEST_COMPLETE
        LDA #$22
        STA DMACTL

WAIT_FOREVER:
        JMP WAIT_FOREVER

; Timer-4 mode 2, AUDF4=1. Delay values are loop steps, not CPU cycles.
TEST_PHASE:
        JSR RESET_POKEY
        LDA #$00
        STA AUDCTL
        LDA #$01
        STA AUDF4
        LDA #$23
        STA SKCTL
        LDA #$18
        STA IRQEN
        LDA #$00
        STA STIMER

        LDX PAD_INDEX
        LDA PHASE_DELAYS,X
        JSR DELAY_STEPS

        LDA #$55
        STA SEROUT
        LDA #$10
        STA MASK
        JSR WAIT_EVENT

        LDX PAD_INDEX
        LDA PHASE_RESULT_LO,X
        STA DST_LO
        LDA PHASE_RESULT_HI,X
        STA DST_HI
        JSR WRITE_COUNT
        RTS

TEST_COMPLETE:
        JSR RESET_POKEY
        LDA #$00
        STA AUDCTL
        LDA #$01
        STA AUDF4
        LDA #$23
        STA SKCTL
        LDA #$18
        STA IRQEN
        LDA #$00
        STA STIMER
        LDA #$55
        STA SEROUT
        LDA #$10
        STA MASK
        JSR WAIT_EVENT
        LDA #$08
        STA MASK
        JSR WAIT_EVENT
        LDA #<COMPLETE_RESULT
        STA DST_LO
        LDA #>COMPLETE_RESULT
        STA DST_HI
        JSR WRITE_COUNT
        RTS

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

DELAY_STEPS:
        TAX
        BEQ DELAY_DONE
DELAY_LOOP:
        NOP
        DEX
        BNE DELAY_LOOP
DELAY_DONE:
        RTS

WAIT_EVENT:
        LDA #$00
        STA COUNT_LO
        STA COUNT_HI
        STA TIMEOUT
WAIT_EVENT_LOOP:
        LDA IRQST
        AND MASK
        BEQ WAIT_EVENT_DONE
        INC COUNT_LO
        BNE WAIT_EVENT_LOOP
        INC COUNT_HI
        LDA COUNT_HI
        CMP #$FF
        BNE WAIT_EVENT_LOOP
        LDA #$01
        STA TIMEOUT
        LDA #$FF
        STA COUNT_LO
WAIT_EVENT_DONE:
        RTS

WRITE_COUNT:
        LDA COUNT_LO
        JSR WRITE_HEX
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

        LDA #<HELP_TEXT
        STA SRC_LO
        LDA #>HELP_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 40)
        STA DST_LO
        LDA #>(SCREEN + 40)
        STA DST_HI
        JSR DRAW_TEXT

        LDX #$00
DRAW_PHASE_LABELS:
        LDA PHASE_TEXT_LO,X
        STA SRC_LO
        LDA PHASE_TEXT_HI,X
        STA SRC_HI
        LDA PHASE_SCREEN_LO,X
        STA DST_LO
        LDA PHASE_SCREEN_HI,X
        STA DST_HI
        JSR DRAW_TEXT
        INX
        CPX #$04
        BNE DRAW_PHASE_LABELS

        LDA #<COMPLETE_TEXT
        STA SRC_LO
        LDA #>COMPLETE_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 280)
        STA DST_LO
        LDA #>(SCREEN + 280)
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

CLEAR_SCREEN:
        LDX #$00
        LDA #$00
CLEAR_SCREEN_LOOP:
        STA SCREEN,X
        STA SCREEN + 256,X
        STA SCREEN + 512,X
        STA SCREEN + 768,X
        INX
        BNE CLEAR_SCREEN_LOOP
        RTS

TITLE_TEXT:
        .BYTE "AHRM08 STIMER PHASE TEST", $00
HELP_TEXT:
        .BYTE "PADDING=STIMER TO SEROUT  N=DATA NEEDED", $00
PHASE0_TEXT:
        .BYTE "P0 PAD 00 NEEDED:00", $00
PHASE1_TEXT:
        .BYTE "P1 PAD 01 NEEDED:00", $00
PHASE2_TEXT:
        .BYTE "P2 PAD 02 NEEDED:00", $00
PHASE3_TEXT:
        .BYTE "P3 PAD 04 NEEDED:00", $00
COMPLETE_TEXT:
        .BYTE "TX COMPLETE AFTER N:00", $00

HEX_DIGITS:
        .BYTE $10, $11, $12, $13, $14, $15, $16, $17
        .BYTE $18, $19, $21, $22, $23, $24, $25, $26

PHASE_DELAYS:
        .BYTE $00, $01, $02, $04
PHASE_RESULT_LO:
        .BYTE <(SCREEN + 120 + 17), <(SCREEN + 160 + 17)
        .BYTE <(SCREEN + 200 + 17), <(SCREEN + 240 + 17)
PHASE_RESULT_HI:
        .BYTE >(SCREEN + 120 + 17), >(SCREEN + 160 + 17)
        .BYTE >(SCREEN + 200 + 17), >(SCREEN + 240 + 17)
PHASE_TEXT_LO:
        .BYTE <PHASE0_TEXT, <PHASE1_TEXT, <PHASE2_TEXT, <PHASE3_TEXT
PHASE_TEXT_HI:
        .BYTE >PHASE0_TEXT, >PHASE1_TEXT, >PHASE2_TEXT, >PHASE3_TEXT
PHASE_SCREEN_LO:
        .BYTE <(SCREEN + 120), <(SCREEN + 160)
        .BYTE <(SCREEN + 200), <(SCREEN + 240)
PHASE_SCREEN_HI:
        .BYTE >(SCREEN + 120), >(SCREEN + 160)
        .BYTE >(SCREEN + 200), >(SCREEN + 240)
COMPLETE_RESULT = SCREEN + 280 + 20

.ORG $3000
DISPLAY_LIST:
        .BYTE $70, $70, $70
        .BYTE $42, <SCREEN, >SCREEN
        .REPT 23
        .BYTE $02
        .ENDR
        .BYTE $41, <DISPLAY_LIST, >DISPLAY_LIST

.ORG SCREEN
        .REPT 960
        .BYTE $00
        .ENDR

.ORG $02E0
        .WORD START
