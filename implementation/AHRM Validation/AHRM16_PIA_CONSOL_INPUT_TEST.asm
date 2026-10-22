; AHRM-16 PIA, GTIA CONSOL, joystick, and trigger input diagnostic.
; Values are displayed live so physical keys and joysticks can be compared
; against the emulator input mapping.

.ORG $2000

PORTA   = $D300
PORTB   = $D301
PACTL   = $D302
PBCTL   = $D303
TRIG0   = $D010
TRIG1   = $D011
TRIG2   = $D012
TRIG3   = $D013
CONSOL  = $D01F
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

START:
        LDA #$E0
        STA CHBASE
        LDA #$22
        STA DMACTL
        LDA #$34
        STA PACTL
        STA PBCTL
        LDA #<DISPLAY_LIST
        STA SDLSTL
        STA DLISTL
        LDA #>DISPLAY_LIST
        STA SDLSTL + 1
        STA DLISTH
        JSR CLEAR_SCREEN
        JSR DRAW_LABELS

LOOP:
        LDA PORTA
        LDX #<(SCREEN + 123)
        LDY #>(SCREEN + 123)
        STX DST_LO
        STY DST_HI
        JSR WRITE_HEX
        LDA PORTB
        LDX #<(SCREEN + 163)
        LDY #>(SCREEN + 163)
        STX DST_LO
        STY DST_HI
        JSR WRITE_HEX
        LDA PACTL
        LDX #<(SCREEN + 203)
        LDY #>(SCREEN + 203)
        STX DST_LO
        STY DST_HI
        JSR WRITE_HEX
        LDA PBCTL
        LDX #<(SCREEN + 243)
        LDY #>(SCREEN + 243)
        STX DST_LO
        STY DST_HI
        JSR WRITE_HEX
        LDA CONSOL
        LDX #<(SCREEN + 283)
        LDY #>(SCREEN + 283)
        STX DST_LO
        STY DST_HI
        JSR WRITE_HEX
        LDA TRIG0
        LDX #<(SCREEN + 323)
        LDY #>(SCREEN + 323)
        STX DST_LO
        STY DST_HI
        JSR WRITE_HEX
        LDA TRIG1
        LDX #<(SCREEN + 363)
        LDY #>(SCREEN + 363)
        STX DST_LO
        STY DST_HI
        JSR WRITE_HEX
        LDA TRIG2
        LDX #<(SCREEN + 403)
        LDY #>(SCREEN + 403)
        STX DST_LO
        STY DST_HI
        JSR WRITE_HEX
        LDA TRIG3
        LDX #<(SCREEN + 443)
        LDY #>(SCREEN + 443)
        STX DST_LO
        STY DST_HI
        JSR WRITE_HEX
        JMP LOOP

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
        .BYTE "AHRM16 PIA CONSOL INPUT", $00
DETAIL_TEXT:
        .BYTE "PA PB PACTL PBCTL CONSOL T0 T1 T2 T3", $00

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
