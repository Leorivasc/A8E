; AHRM-08 POKEY edge diagnostic.
; The four padding cases record the first visible timer-4 IRQ and DATA NEEDED
; observations from the same polling loop. This separates timer phase from
; serial divide-by-two phase before the final STIMER/SEROUT certification.

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

SRC_LO      = $80
SRC_HI      = $81
DST_LO      = $82
DST_HI      = $83
VALUE       = $84
MASK        = $85
COUNT_LO    = $86
COUNT_HI    = $87
TIMEOUT     = $88
PAD_INDEX   = $89

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

        JSR TEST_COMPLETE

        LDX #$00
EDGE_LOOP:
        STX PAD_INDEX
        JSR TEST_TIMER_PHASE
        JSR TEST_DATA_PHASE
        LDX PAD_INDEX
        INX
        CPX #$04
        BNE EDGE_LOOP

        LDA #$22
        STA DMACTL

WAIT_FOREVER:
        JMP WAIT_FOREVER

; Measure timer-4 independently. AUDF4=5 gives a 168-cycle period, leaving
; enough room for the first polling read to observe the phase difference.
TEST_TIMER_PHASE:
        JSR RESET_POKEY
        LDA #$00
        STA AUDCTL
        LDA #$05
        STA AUDF4
        LDA #$23
        STA SKCTL
        LDA #$04
        STA IRQEN
        LDA #$00
        STA STIMER

        LDX PAD_INDEX
        LDA PHASE_DELAYS,X
        JSR DELAY_STEPS

        LDA #$04
        STA MASK
        JSR WAIT_EVENT

        LDX PAD_INDEX
        LDA EDGE_T4_RESULT_LO,X
        STA DST_LO
        LDA EDGE_T4_RESULT_HI,X
        STA DST_HI
        LDA COUNT_LO
        JSR WRITE_COUNT
        RTS

; Measure DATA NEEDED with the original single-event polling loop and the
; original AUDF4=1 phase-test configuration.
TEST_DATA_PHASE:
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
        LDA EDGE_DATA_RESULT_LO,X
        STA DST_LO
        LDA EDGE_DATA_RESULT_HI,X
        STA DST_HI
        LDA COUNT_LO
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
        LDA COUNT_LO
        JSR WRITE_COUNT
        RTS

; Initialization resets the serial state machines. SKCTL=$23 selects timer 4
; as the synchronous output clock and AUDCTL=$00 selects the 64 kHz clock.
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
DRAW_EDGE_LABELS:
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
        BNE DRAW_EDGE_LABELS

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
DRAW_TEXT_LETTER:
        STA (DST_LO),Y
        INY
        BNE DRAW_TEXT_NEXT
        INC DST_HI
        JMP DRAW_TEXT_NEXT
DRAW_TEXT_SPACE:
        LDA #$00
        STA (DST_LO),Y
        INY
        BNE DRAW_TEXT_NEXT
        INC DST_HI
        JMP DRAW_TEXT_NEXT
DRAW_TEXT_DONE:
        RTS

CLEAR_SCREEN:
        LDA #$00
        LDX #$00
CLEAR_SCREEN_PAGE:
        STA SCREEN,X
        STA SCREEN + 256,X
        STA SCREEN + 512,X
        STA SCREEN + 768,X
        INX
        BNE CLEAR_SCREEN_PAGE
        RTS

TITLE_TEXT:
        .BYTE "AHRM08 POKEY EDGE TEST", $00
HELP_TEXT:
        .BYTE "T4=FIRST TIMER4 IRQ  DATA=DATA NEEDED", $00
PHASE0_TEXT:
        .BYTE "P0 PAD 00 T4:00 DATA:00", $00
PHASE1_TEXT:
        .BYTE "P1 PAD 01 T4:00 DATA:00", $00
PHASE2_TEXT:
        .BYTE "P2 PAD 02 T4:00 DATA:00", $00
PHASE3_TEXT:
        .BYTE "P3 PAD 04 T4:00 DATA:00", $00
COMPLETE_TEXT:
        .BYTE "TX COMPLETE AFTER N:00", $00

HEX_DIGITS:
        .BYTE $10, $11, $12, $13, $14, $15, $16, $17
        .BYTE $18, $19, $21, $22, $23, $24, $25, $26

PHASE_DELAYS:
        .BYTE $00, $01, $02, $04
EDGE_T4_RESULT_LO:
        .BYTE <(SCREEN + 120 + 13), <(SCREEN + 160 + 13)
        .BYTE <(SCREEN + 200 + 13), <(SCREEN + 240 + 13)
EDGE_T4_RESULT_HI:
        .BYTE >(SCREEN + 120 + 13), >(SCREEN + 160 + 13)
        .BYTE >(SCREEN + 200 + 13), >(SCREEN + 240 + 13)
EDGE_DATA_RESULT_LO:
        .BYTE <(SCREEN + 120 + 21), <(SCREEN + 160 + 21)
        .BYTE <(SCREEN + 200 + 21), <(SCREEN + 240 + 21)
EDGE_DATA_RESULT_HI:
        .BYTE >(SCREEN + 120 + 21), >(SCREEN + 160 + 21)
        .BYTE >(SCREEN + 200 + 21), >(SCREEN + 240 + 21)
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
