; AHRM-08 Stage 2 POKEY serial clock and STIMER diagnostic.
; The displayed values are observations, not synthetic PASS flags:
;   - one SEROUT data-needed and transmission-complete pair for each SKCTL mode;
;   - IRQST immediately after STIMER and the first timer-1 IRQ polling count.
;
; Mode routing follows AHRM 5.6:
;   SKCTL 0-1: external output clock;
;   SKCTL 2/4: timer 4 output clock;
;   SKCTL 3/5: asynchronous input; no output clock until a start bit;
;   SKCTL 6-7: timer 2 output clock.
;
.ORG $2000

DMACTL  = $D400
CHBASE  = $D409
DLISTL  = $D402
DLISTH  = $D403
COLPF0  = $D016
COLPF1  = $D017
COLBK   = $D01A

AUDCTL  = $D208
AUDF1   = $D200
AUDF2   = $D202
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
MODE    = $89

START:
        SEI

        ; Install a simple 40-column mode-2 display list.
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

        ; Keep the diagnostic screen prepared, then remove ANTIC CPU steals
        ; while measuring POKEY so N/D counts expose serial timing only.
        LDA #$00
        STA DMACTL
        JSR TEST_STIMER

        LDX #$00
MODE_LOOP:
        STX MODE
        JSR TEST_SERIAL_MODE
        LDX MODE
        INX
        CPX #$08
        BNE MODE_LOOP

        ; Show the completed results after the timing-critical section.
        LDA #$22
        STA DMACTL

WAIT_FOREVER:
        JMP WAIT_FOREVER

; Record IRQST immediately after STIMER, then the first timer-1 IRQ polling
; count. The status byte is written as hex; the count is written as two digits.
TEST_STIMER:
        JSR RESET_POKEY
        LDA #$00
        STA AUDCTL
        LDA #$05
        STA AUDF1
        LDA #$00
        STA STIMER

        LDA IRQST
        LDX #<RESULT_STIMER_STATUS
        LDY #>RESULT_STIMER_STATUS
        STX DST_LO
        STY DST_HI
        JSR WRITE_HEX

        LDA #$01
        STA IRQEN
        LDA #$01
        STA MASK
        JSR WAIT_EVENT
        LDA #<RESULT_TIMER_IRQ
        STA DST_LO
        LDA #>RESULT_TIMER_IRQ
        STA DST_HI
        JSR WRITE_COUNT
        RTS

; Test one SKCTL mode. AUDF4=1 gives a 56-cycle timer-4 period and AUDF2=2
; gives an 84-cycle timer-2 period with AUDCTL=0. The displayed N/D values
; are polling-loop counts until IRQST bits 4/3 become active.
TEST_SERIAL_MODE:
        JSR RESET_POKEY

        LDA #$00
        STA AUDCTL
        LDA #$02
        STA AUDF2
        LDA #$01
        STA AUDF4

        LDA MODE
        ASL A
        ASL A
        ASL A
        ASL A
        ORA #$03
        STA SKCTL
        LDA #$00
        STA STIMER

        LDA #$18
        STA IRQEN
        LDA #$55
        STA SEROUT

        LDA #$10
        STA MASK
        JSR WAIT_EVENT
        LDX MODE
        LDA MODE_NEED_LO,X
        STA DST_LO
        LDA MODE_NEED_HI,X
        STA DST_HI
        JSR WRITE_COUNT

        LDA #$08
        STA MASK
        JSR WAIT_EVENT
        LDX MODE
        LDA MODE_DONE_LO,X
        STA DST_LO
        LDA MODE_DONE_HI,X
        STA DST_HI
        JSR WRITE_COUNT
        RTS

; Enter initialization mode and clear all POKEY interrupt sources before each
; scenario. Initialization also resets the serial state machines.
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

; Count polling iterations until MASK becomes active low in IRQST. A timeout
; is represented by FF in the low byte, so an external-clock mode remains
; visible instead of being mistaken for a normal timing result.
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

; Write the low byte in A as two hexadecimal Atari screen codes.
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

        LDA #<MODE0_TEXT
        STA SRC_LO
        LDA #>MODE0_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 120)
        STA DST_LO
        LDA #>(SCREEN + 120)
        STA DST_HI
        JSR DRAW_TEXT

        LDA #<MODE1_TEXT
        STA SRC_LO
        LDA #>MODE1_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 160)
        STA DST_LO
        LDA #>(SCREEN + 160)
        STA DST_HI
        JSR DRAW_TEXT

        LDA #<MODE2_TEXT
        STA SRC_LO
        LDA #>MODE2_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 200)
        STA DST_LO
        LDA #>(SCREEN + 200)
        STA DST_HI
        JSR DRAW_TEXT

        LDA #<MODE3_TEXT
        STA SRC_LO
        LDA #>MODE3_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 240)
        STA DST_LO
        LDA #>(SCREEN + 240)
        STA DST_HI
        JSR DRAW_TEXT

        LDA #<MODE4_TEXT
        STA SRC_LO
        LDA #>MODE4_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 280)
        STA DST_LO
        LDA #>(SCREEN + 280)
        STA DST_HI
        JSR DRAW_TEXT

        LDA #<MODE5_TEXT
        STA SRC_LO
        LDA #>MODE5_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 320)
        STA DST_LO
        LDA #>(SCREEN + 320)
        STA DST_HI
        JSR DRAW_TEXT

        LDA #<MODE6_TEXT
        STA SRC_LO
        LDA #>MODE6_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 360)
        STA DST_LO
        LDA #>(SCREEN + 360)
        STA DST_HI
        JSR DRAW_TEXT

        LDA #<MODE7_TEXT
        STA SRC_LO
        LDA #>MODE7_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 400)
        STA DST_LO
        LDA #>(SCREEN + 400)
        STA DST_HI
        JSR DRAW_TEXT

        LDA #<STIMER_TEXT
        STA SRC_LO
        LDA #>STIMER_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 480)
        STA DST_LO
        LDA #>(SCREEN + 480)
        STA DST_HI
        JSR DRAW_TEXT

        LDA #<TIMER_TEXT
        STA SRC_LO
        LDA #>TIMER_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 520)
        STA DST_LO
        LDA #>(SCREEN + 520)
        STA DST_HI
        JSR DRAW_TEXT
        RTS

; Convert uppercase ASCII text to Atari screen codes.
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
        .BYTE "AHRM08 STIMER SIO CLOCK TEST", $00
HELP_TEXT:
        .BYTE "N=DATA NEEDED  D=TX COMPLETE  FF=TIMEOUT", $00
MODE0_TEXT:
        .BYTE "M0 EXT CLOCK N:00 D:00", $00
MODE1_TEXT:
        .BYTE "M1 EXT CLOCK N:00 D:00", $00
MODE2_TEXT:
        .BYTE "M2 TIMER4 CLK N:00 D:00", $00
MODE3_TEXT:
        .BYTE "M3 ASYNC IN  N:00 D:00", $00
MODE4_TEXT:
        .BYTE "M4 TIMER4 CLK N:00 D:00", $00
MODE5_TEXT:
        .BYTE "M5 ASYNC IN  N:00 D:00", $00
MODE6_TEXT:
        .BYTE "M6 TIMER2 CLK N:00 D:00", $00
MODE7_TEXT:
        .BYTE "M7 TIMER2 CLK N:00 D:00", $00
STIMER_TEXT:
        .BYTE "STIMER IRQST AFTER:00", $00
TIMER_TEXT:
        .BYTE "T1 IRQ POLL LOOPS:00", $00

HEX_DIGITS:
        .BYTE $10, $11, $12, $13, $14, $15, $16, $17
        .BYTE $18, $19, $21, $22, $23, $24, $25, $26

RESULT_STIMER_STATUS = SCREEN + 499
RESULT_TIMER_IRQ = SCREEN + 538

; External-clock labels use N/D columns 15/20. Timer labels are one character
; longer and use columns 16/21.
MODE0_BASE = SCREEN + 120
MODE1_BASE = SCREEN + 160
MODE2_BASE = SCREEN + 200
MODE3_BASE = SCREEN + 240
MODE4_BASE = SCREEN + 280
MODE5_BASE = SCREEN + 320
MODE6_BASE = SCREEN + 360
MODE7_BASE = SCREEN + 400

MODE0_NEED = MODE0_BASE + 15
MODE1_NEED = MODE1_BASE + 15
MODE2_NEED = MODE2_BASE + 16
MODE3_NEED = MODE3_BASE + 16
MODE4_NEED = MODE4_BASE + 16
MODE5_NEED = MODE5_BASE + 16
MODE6_NEED = MODE6_BASE + 16
MODE7_NEED = MODE7_BASE + 16
MODE0_DONE = MODE0_BASE + 20
MODE1_DONE = MODE1_BASE + 20
MODE2_DONE = MODE2_BASE + 21
MODE3_DONE = MODE3_BASE + 21
MODE4_DONE = MODE4_BASE + 21
MODE5_DONE = MODE5_BASE + 21
MODE6_DONE = MODE6_BASE + 21
MODE7_DONE = MODE7_BASE + 21

MODE_NEED_LO:
        .BYTE <MODE0_NEED, <MODE1_NEED, <MODE2_NEED, <MODE3_NEED
        .BYTE <MODE4_NEED, <MODE5_NEED, <MODE6_NEED, <MODE7_NEED
MODE_NEED_HI:
        .BYTE >MODE0_NEED, >MODE1_NEED, >MODE2_NEED, >MODE3_NEED
        .BYTE >MODE4_NEED, >MODE5_NEED, >MODE6_NEED, >MODE7_NEED
MODE_DONE_LO:
        .BYTE <MODE0_DONE, <MODE1_DONE, <MODE2_DONE, <MODE3_DONE
        .BYTE <MODE4_DONE, <MODE5_DONE, <MODE6_DONE, <MODE7_DONE
MODE_DONE_HI:
        .BYTE >MODE0_DONE, >MODE1_DONE, >MODE2_DONE, >MODE3_DONE
        .BYTE >MODE4_DONE, >MODE5_DONE, >MODE6_DONE, >MODE7_DONE

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
