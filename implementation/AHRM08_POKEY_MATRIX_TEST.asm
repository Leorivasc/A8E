; AHRM-08 POKEY phase matrix diagnostic.
; Each case resets POKEY, then measures DATA NEEDED after a controlled
; STIMER-to-SEROUT delay. The same cases run in normal and reverse order so
; order-dependent phase state is visible without changing production timing.

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

NORMAL_P0 = $8A
NORMAL_P1 = $8B
NORMAL_P2 = $8C
NORMAL_P4 = $8D
REVERSE_P4 = $8E
REVERSE_P2 = $8F
REVERSE_P1 = $90
REVERSE_P0 = $91
TX_NORMAL = $92
TX_REVERSE = $93

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

        LDA #$00
        STA PAD_INDEX
        JSR TEST_COMPLETE
        STA TX_NORMAL

        LDA #$00
        STA PAD_INDEX
        JSR TEST_DATA
        LDA COUNT_LO
        STA NORMAL_P0

        LDA #$01
        STA PAD_INDEX
        JSR TEST_DATA
        LDA COUNT_LO
        STA NORMAL_P1

        LDA #$02
        STA PAD_INDEX
        JSR TEST_DATA
        LDA COUNT_LO
        STA NORMAL_P2

        LDA #$03
        STA PAD_INDEX
        JSR TEST_DATA
        LDA COUNT_LO
        STA NORMAL_P4

        LDA #$03
        STA PAD_INDEX
        JSR TEST_DATA
        LDA COUNT_LO
        STA REVERSE_P4

        LDA #$02
        STA PAD_INDEX
        JSR TEST_DATA
        LDA COUNT_LO
        STA REVERSE_P2

        LDA #$01
        STA PAD_INDEX
        JSR TEST_DATA
        LDA COUNT_LO
        STA REVERSE_P1

        LDA #$00
        STA PAD_INDEX
        JSR TEST_DATA
        LDA COUNT_LO
        STA REVERSE_P0

        LDA #$00
        STA PAD_INDEX
        JSR TEST_COMPLETE
        STA TX_REVERSE

        JSR DRAW_RESULTS
        LDA #$22
        STA DMACTL

WAIT_FOREVER:
        JMP WAIT_FOREVER

; Measure DATA NEEDED after the selected STIMER-to-SEROUT padding.
TEST_DATA:
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
        RTS

; Measure the completion interval after DATA NEEDED for each order pass.
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
        LDA COUNT_LO
        RTS

; Initialization mode clears the serial state machines. Leaving it establishes
; the slow-clock phase; STIMER later reloads timers without resetting it.
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

        LDA #<NORMAL_TEXT
        STA SRC_LO
        LDA #>NORMAL_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 80)
        STA DST_LO
        LDA #>(SCREEN + 80)
        STA DST_HI
        JSR DRAW_TEXT

        LDA #<NORMAL2_TEXT
        STA SRC_LO
        LDA #>NORMAL2_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 120)
        STA DST_LO
        LDA #>(SCREEN + 120)
        STA DST_HI
        JSR DRAW_TEXT

        LDA #<REVERSE_TEXT
        STA SRC_LO
        LDA #>REVERSE_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 160)
        STA DST_LO
        LDA #>(SCREEN + 160)
        STA DST_HI
        JSR DRAW_TEXT

        LDA #<REVERSE2_TEXT
        STA SRC_LO
        LDA #>REVERSE2_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 200)
        STA DST_LO
        LDA #>(SCREEN + 200)
        STA DST_HI
        JSR DRAW_TEXT

        LDA #<TX_TEXT
        STA SRC_LO
        LDA #>TX_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 240)
        STA DST_LO
        LDA #>(SCREEN + 240)
        STA DST_HI
        JSR DRAW_TEXT
        RTS

DRAW_RESULTS:
        LDA #<(SCREEN + 80 + 8)
        STA DST_LO
        LDA #>(SCREEN + 80 + 8)
        STA DST_HI
        LDA NORMAL_P0
        JSR WRITE_HEX

        LDA #<(SCREEN + 80 + 14)
        STA DST_LO
        LDA #>(SCREEN + 80 + 14)
        STA DST_HI
        LDA NORMAL_P1
        JSR WRITE_HEX

        LDA #<(SCREEN + 120 + 8)
        STA DST_LO
        LDA #>(SCREEN + 120 + 8)
        STA DST_HI
        LDA NORMAL_P2
        JSR WRITE_HEX

        LDA #<(SCREEN + 120 + 14)
        STA DST_LO
        LDA #>(SCREEN + 120 + 14)
        STA DST_HI
        LDA NORMAL_P4
        JSR WRITE_HEX

        LDA #<(SCREEN + 160 + 7)
        STA DST_LO
        LDA #>(SCREEN + 160 + 7)
        STA DST_HI
        LDA REVERSE_P4
        JSR WRITE_HEX

        LDA #<(SCREEN + 160 + 13)
        STA DST_LO
        LDA #>(SCREEN + 160 + 13)
        STA DST_HI
        LDA REVERSE_P2
        JSR WRITE_HEX

        LDA #<(SCREEN + 200 + 7)
        STA DST_LO
        LDA #>(SCREEN + 200 + 7)
        STA DST_HI
        LDA REVERSE_P1
        JSR WRITE_HEX

        LDA #<(SCREEN + 200 + 13)
        STA DST_LO
        LDA #>(SCREEN + 200 + 13)
        STA DST_HI
        LDA REVERSE_P0
        JSR WRITE_HEX

        LDA #<(SCREEN + 240 + 8)
        STA DST_LO
        LDA #>(SCREEN + 240 + 8)
        STA DST_HI
        LDA TX_NORMAL
        JSR WRITE_HEX

        LDA #<(SCREEN + 240 + 15)
        STA DST_LO
        LDA #>(SCREEN + 240 + 15)
        STA DST_HI
        LDA TX_REVERSE
        JSR WRITE_HEX
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
        .BYTE "AHRM08 POKEY MATRIX TEST", $00
HELP_TEXT:
        .BYTE "DATA POLLS  NORMAL THEN REVERSE", $00
NORMAL_TEXT:
        .BYTE "NORM P0:00 P1:00", $00
NORMAL2_TEXT:
        .BYTE "NORM P2:00 P4:00", $00
REVERSE_TEXT:
        .BYTE "REV  P4:00 P2:00", $00
REVERSE2_TEXT:
        .BYTE "REV  P1:00 P0:00", $00
TX_TEXT:
        .BYTE "TX NORM:00 REV:00", $00

HEX_DIGITS:
        .BYTE $10, $11, $12, $13, $14, $15, $16, $17
        .BYTE $18, $19, $21, $22, $23, $24, $25, $26

PHASE_DELAYS:
        .BYTE $00, $01, $02, $04

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
