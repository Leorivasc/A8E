; AHRM-08 POKEY diagnostic for jsA8E, native A8E, Altirra, and hardware.
; The displayed values are observation data, not synthetic PASS flags:
;   - loop counts until timer 1/2 IRQST bits assert;
;   - loop counts until SEROUT data-needed/transmission-done events;
;   - POT scan duration and final ALLPOT/POT0 values.
;
; Run the same XEX on each target and record the values. The native/JS
; cycle-level probes cover internal details that a guest program cannot see.

.ORG $2000

DMACTL  = $D400
CHBASE  = $D409
DLISTL  = $D402
DLISTH  = $D403
COLPF0  = $D016
COLPF1  = $D017
COLBK   = $D01A

AUDCTL  = $D208
STIMER  = $D209
POTGO   = $D20B
SEROUT  = $D20D
IRQEN   = $D20E
IRQST   = $D20E
SKCTL   = $D20F
POT0    = $D200
ALLPOT  = $D208

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
POT_FINAL = $89

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

        ; Timer 1, normal clock, AUDF=0.
        JSR RESET_POKEY
        LDA #$00
        STA AUDCTL
        STA $D200
        LDA #$01
        STA MASK
        LDA #$00
        STA STIMER
        LDA #$00
        STA IRQEN
        LDA #$01
        STA IRQEN
        JSR WAIT_IRQ
        JSR STORE_RESULT_1

        ; Timer 1, fast 1.79 MHz clock, AUDF=0.
        JSR RESET_POKEY
        LDA #$40
        STA AUDCTL
        LDA #$00
        STA STIMER
        LDA #$00
        STA IRQEN
        LDA #$01
        STA MASK
        STA IRQEN
        JSR WAIT_IRQ
        JSR STORE_RESULT_2

        ; Timer 1, normal clock, AUDF=5.
        JSR RESET_POKEY
        LDA #$00
        STA AUDCTL
        LDA #$05
        STA $D200
        LDA #$00
        STA STIMER
        LDA #$00
        STA IRQEN
        LDA #$01
        STA MASK
        STA IRQEN
        JSR WAIT_IRQ
        JSR STORE_RESULT_3

        ; Timers 1+2 linked, fast clock, AUDF1/AUDF2=0.
        JSR RESET_POKEY
        LDA #$50
        STA AUDCTL
        LDA #$00
        STA $D200
        STA $D202
        LDA #$00
        STA STIMER
        LDA #$00
        STA IRQEN
        LDA #$02
        STA MASK
        STA IRQEN
        JSR WAIT_IRQ
        JSR STORE_RESULT_4

        ; SEROUT timing. The first value observes data-needed, the second
        ; observes transmission-complete after the same byte.
        JSR RESET_POKEY
        ; AHRM 5.6: SKCTL=$23 selects the serial output clock used by SIO.
        LDA #$28
        STA AUDCTL
        LDA #$28
        STA $D204
        LDA #$00
        STA $D206
        LDA #$23
        STA SKCTL
        LDA #$10
        STA MASK
        STA IRQEN
        LDA #$55
        STA SEROUT
        JSR WAIT_IRQ
        JSR STORE_RESULT_5

        LDA #$08
        STA MASK
        LDA #$08
        STA IRQEN
        JSR WAIT_IRQ
        JSR STORE_RESULT_6

        ; POTGO scan. The result records duration and the final ALLPOT byte.
        JSR RESET_POKEY
        LDA #$00
        STA IRQEN
        STA POTGO
        JSR WAIT_ALLPOT
        JSR STORE_RESULT_7
        LDA POT0
        LDX #<RESULT8_DEST
        LDY #>RESULT8_DEST
        STX DST_LO
        STY DST_HI
        JSR WRITE_HEX

WAIT_FOREVER:
        JMP WAIT_FOREVER

; AHRM 5.2: enter initialization mode, then leave it before configuring the
; individual test. IRQEN is cleared first so an indeterminate power-up IRQ
; cannot contaminate the polling result.
RESET_POKEY:
        LDA #$00
        STA SKCTL
        ; IRQST is not reset by SKCTL initialization. Enable all POKEY
        ; sources once, then disable them, clearing any pending startup state.
        LDA #$7F
        STA IRQEN
        LDA #$00
        STA IRQEN
        LDA #$03
        STA SKCTL
        RTS

; Count polling iterations until the selected IRQST bit becomes active low.
; A timeout is represented by FF in the high byte and remains visible.
WAIT_IRQ:
        LDA #$00
        STA COUNT_LO
        STA COUNT_HI
        STA TIMEOUT
WAIT_IRQ_LOOP:
        LDA IRQST
        AND MASK
        BEQ WAIT_IRQ_DONE
        INC COUNT_LO
        BNE WAIT_IRQ_LOOP
        INC COUNT_HI
        LDA COUNT_HI
        CMP #$FF
        BNE WAIT_IRQ_LOOP
        LDA #$01
        STA TIMEOUT
        LDA #$FF
        STA COUNT_LO
WAIT_IRQ_DONE:
        LDA #$00
        STA IRQEN
        RTS

; Count until ALLPOT reaches zero, or until the high byte wraps to FF.
WAIT_ALLPOT:
        LDA #$00
        STA COUNT_LO
        STA COUNT_HI
        STA TIMEOUT
WAIT_ALLPOT_LOOP:
        LDA ALLPOT
        STA POT_FINAL
        BEQ WAIT_ALLPOT_DONE
        INC COUNT_LO
        BNE WAIT_ALLPOT_LOOP
        INC COUNT_HI
        LDA COUNT_HI
        CMP #$FF
        BNE WAIT_ALLPOT_LOOP
        LDA #$01
        STA TIMEOUT
        LDA #$FF
        STA COUNT_LO
WAIT_ALLPOT_DONE:
        RTS

STORE_RESULT_1:
        LDA #<RESULT1_DEST
        STA DST_LO
        LDA #>RESULT1_DEST
        STA DST_HI
        JSR WRITE_COUNT
        RTS
STORE_RESULT_2:
        LDA #<RESULT2_DEST
        STA DST_LO
        LDA #>RESULT2_DEST
        STA DST_HI
        JSR WRITE_COUNT
        RTS
STORE_RESULT_3:
        LDA #<RESULT3_DEST
        STA DST_LO
        LDA #>RESULT3_DEST
        STA DST_HI
        JSR WRITE_COUNT
        RTS
STORE_RESULT_4:
        LDA #<RESULT4_DEST
        STA DST_LO
        LDA #>RESULT4_DEST
        STA DST_HI
        JSR WRITE_COUNT
        RTS
STORE_RESULT_5:
        LDA #<RESULT5_DEST
        STA DST_LO
        LDA #>RESULT5_DEST
        STA DST_HI
        JSR WRITE_COUNT
        RTS
STORE_RESULT_6:
        LDA #<RESULT6_DEST
        STA DST_LO
        LDA #>RESULT6_DEST
        STA DST_HI
        JSR WRITE_COUNT
        RTS
STORE_RESULT_7:
        LDA POT_FINAL
        LDX #<RESULT7_DEST
        LDY #>RESULT7_DEST
        STX DST_LO
        STY DST_HI
        JSR WRITE_HEX
        LDA #<RESULT7_DEST
        CLC
        ADC #$03
        STA DST_LO
        LDA #>RESULT7_DEST
        ADC #$00
        STA DST_HI
        JSR WRITE_COUNT
        RTS

WRITE_COUNT:
        LDA COUNT_LO
        JSR WRITE_HEX
        RTS

; Write the low byte in A as two hexadecimal screen characters.
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

        LDA #<TIMER1_TEXT
        STA SRC_LO
        LDA #>TIMER1_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 80)
        STA DST_LO
        LDA #>(SCREEN + 80)
        STA DST_HI
        JSR DRAW_TEXT

        LDA #<TIMER1_FAST_TEXT
        STA SRC_LO
        LDA #>TIMER1_FAST_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 120)
        STA DST_LO
        LDA #>(SCREEN + 120)
        STA DST_HI
        JSR DRAW_TEXT

        LDA #<TIMER1_AUDF5_TEXT
        STA SRC_LO
        LDA #>TIMER1_AUDF5_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 160)
        STA DST_LO
        LDA #>(SCREEN + 160)
        STA DST_HI
        JSR DRAW_TEXT

        LDA #<TIMER2_LINK_TEXT
        STA SRC_LO
        LDA #>TIMER2_LINK_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 200)
        STA DST_LO
        LDA #>(SCREEN + 200)
        STA DST_HI
        JSR DRAW_TEXT

        LDA #<SIO_NEED_TEXT
        STA SRC_LO
        LDA #>SIO_NEED_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 280)
        STA DST_LO
        LDA #>(SCREEN + 280)
        STA DST_HI
        JSR DRAW_TEXT

        LDA #<SIO_DONE_TEXT
        STA SRC_LO
        LDA #>SIO_DONE_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 320)
        STA DST_LO
        LDA #>(SCREEN + 320)
        STA DST_HI
        JSR DRAW_TEXT

        LDA #<POT_TEXT
        STA SRC_LO
        LDA #>POT_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 400)
        STA DST_LO
        LDA #>(SCREEN + 400)
        STA DST_HI
        JSR DRAW_TEXT

        LDA #<POT0_TEXT
        STA SRC_LO
        LDA #>POT0_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 440)
        STA DST_LO
        LDA #>(SCREEN + 440)
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
        .BYTE "AHRM08 POKEY TIMER SIO POT TEST", $00
TIMER1_TEXT:
        .BYTE "T1 NORMAL AUDF0 LOOPS:", $00
TIMER1_FAST_TEXT:
        .BYTE "T1 FAST AUDF0 LOOPS:", $00
TIMER1_AUDF5_TEXT:
        .BYTE "T1 NORMAL AUDF5 LOOPS:", $00
TIMER2_LINK_TEXT:
        .BYTE "T1+T2 LINK FAST 00 LOOPS:", $00
SIO_NEED_TEXT:
        .BYTE "SEROUT DATA NEEDED LOOPS:", $00
SIO_DONE_TEXT:
        .BYTE "SEROUT TX COMPLETE LOOPS:", $00
POT_TEXT:
        .BYTE "POT SCAN ALLPOT FINAL / LOOPS:", $00
POT0_TEXT:
        .BYTE "POT0 VALUE:", $00

HEX_DIGITS:
        ; Atari screen codes, not ASCII: digits $10-$19, letters $21-$26.
        .BYTE $10, $11, $12, $13, $14, $15, $16, $17
        .BYTE $18, $19, $21, $22, $23, $24, $25, $26

RESULT1_DEST = SCREEN + 103
RESULT2_DEST = SCREEN + 143
RESULT3_DEST = SCREEN + 183
RESULT4_DEST = SCREEN + 223
RESULT5_DEST = SCREEN + 303
RESULT6_DEST = SCREEN + 343
RESULT7_DEST = SCREEN + 431
RESULT8_DEST = SCREEN + 451

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
