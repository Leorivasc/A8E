; AHRM-13 ANTIC character-set diagnostic.
; Displays an OS-font section followed by a custom 1K character set. DLI
; changes CHBASE and CHACTL to exercise inversion and vertical reflection.

.ORG $2000

DMACTL  = $D400
CHACTL  = $D401
CHBASE  = $D409
NMIEN   = $D40E
NMIRES  = $D40F
DLISTL  = $D402
DLISTH  = $D403
COLBK   = $D01A
COLPF0  = $D016

SDLSTL  = $0230
VDSLST  = $0200
SRC_LO  = $80
SRC_HI  = $81
DST_LO  = $82
DST_HI  = $83
DLI_SECTION = $2FF0

START:
        LDA #$00
        STA NMIEN
        STA DLI_SECTION
        STA CHACTL
        LDA #$E0
        STA CHBASE
        LDA #$22
        STA DMACTL
        STA COLBK
        LDA #$0E
        STA COLPF0

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

        JSR CLEAR_SCREENS
        JSR DRAW_OS_LABEL
        JSR DRAW_CUSTOM_NAMES
        LDA #$C0
        STA NMIEN

WAIT:
        JMP WAIT

; The first section uses the OS font. The second selects the custom font.
; The third keeps the custom font and enables vertical reflection plus
; inversion for character names with bit 7 set.
DLI_HANDLER:
        PHA
        TXA
        PHA
        LDX DLI_SECTION
        CPX #$00
        BEQ SET_CUSTOM_FONT
        CPX #$01
        BEQ SET_REFLECTED_FONT
        LDA #$00
        STA CHACTL
        LDA #$E0
        STA CHBASE
        LDA #$00
        STA DLI_SECTION
        JMP DLI_DONE

SET_CUSTOM_FONT:
        LDA #$50
        STA CHBASE
        LDA #$00
        STA CHACTL
        LDA #$01
        STA DLI_SECTION
        JMP DLI_DONE

SET_REFLECTED_FONT:
        LDA #$50
        STA CHBASE
        LDA #$06
        STA CHACTL
        LDA #$02
        STA DLI_SECTION

DLI_DONE:
        LDA #$80
        STA NMIRES
        PLA
        TAX
        PLA
        RTI

CLEAR_SCREENS:
        LDX #$00
        LDA #$00
CLEAR_LOOP:
        STA SCREEN_OS,X
        STA SCREEN_OS + 256,X
        STA SCREEN_CUSTOM,X
        STA SCREEN_CUSTOM + 256,X
        STA SCREEN_REFLECTED,X
        STA SCREEN_REFLECTED + 256,X
        INX
        BNE CLEAR_LOOP
        RTS

DRAW_OS_LABEL:
        LDA #<OS_TEXT
        STA SRC_LO
        LDA #>OS_TEXT
        STA SRC_HI
        LDA #<SCREEN_OS
        STA DST_LO
        LDA #>SCREEN_OS
        STA DST_HI
        JSR DRAW_TEXT
        RTS

; The custom screen shows character IDs 00-0F. The reflected screen uses the
; same IDs with bit 7 set, activating CHACTL inversion.
DRAW_CUSTOM_NAMES:
        LDX #$00
        LDY #$00
DRAW_NAMES_LOOP:
        TXA
        AND #$0F
        STA SCREEN_CUSTOM + 160,Y
        ORA #$80
        STA SCREEN_REFLECTED + 160,Y
        INX
        INY
        CPY #$28
        BCC DRAW_NAMES_LOOP
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

OS_TEXT:
        .BYTE "AHRM13 OS FONT CHBASE", $00

.ORG $3000
DISPLAY_LIST:
        .BYTE $70, $70, $70
        .BYTE $42, <SCREEN_OS, >SCREEN_OS
        .REPT 5
        .BYTE $02
        .ENDR
        .BYTE $82

        .BYTE $42, <SCREEN_CUSTOM, >SCREEN_CUSTOM
        .REPT 5
        .BYTE $02
        .ENDR
        .BYTE $82

        .BYTE $42, <SCREEN_REFLECTED, >SCREEN_REFLECTED
        .REPT 5
        .BYTE $02
        .ENDR
        .BYTE $82
        .BYTE $41, <DISPLAY_LIST, >DISPLAY_LIST

.ORG $4000
SCREEN_OS:
        .REPT 320
        .BYTE $00
        .ENDR
.ORG $4400
SCREEN_CUSTOM:
        .REPT 320
        .BYTE $00
        .ENDR
.ORG $4800
SCREEN_REFLECTED:
        .REPT 320
        .BYTE $00
        .ENDR

; 16 eight-byte patterns followed by zero-filled unused character entries.
.ORG $5000
CUSTOM_CHARSET:
        .BYTE $18,$3C,$7E,$FF,$FF,$7E,$3C,$18
        .BYTE $81,$42,$24,$18,$18,$24,$42,$81
        .BYTE $FF,$81,$BD,$A5,$A5,$BD,$81,$FF
        .BYTE $00,$18,$18,$FF,$FF,$18,$18,$00
        .BYTE $FF,$00,$FF,$00,$FF,$00,$FF,$00
        .BYTE $00,$FF,$00,$FF,$00,$FF,$00,$FF
        .BYTE $AA,$55,$AA,$55,$AA,$55,$AA,$55
        .BYTE $55,$AA,$55,$AA,$55,$AA,$55,$AA
        .BYTE $80,$C0,$E0,$F0,$F8,$FC,$FE,$FF
        .BYTE $01,$03,$07,$0F,$1F,$3F,$7F,$FF
        .BYTE $FF,$FE,$FC,$F8,$F0,$E0,$C0,$80
        .BYTE $FF,$7F,$3F,$1F,$0F,$07,$03,$01
        .BYTE $11,$22,$44,$88,$11,$22,$44,$88
        .BYTE $88,$44,$22,$11,$88,$44,$22,$11
        .BYTE $3C,$42,$A5,$81,$A5,$99,$42,$3C
        .BYTE $00,$00,$FF,$FF,$FF,$FF,$00,$00
        .REPT 896
        .BYTE $00
        .ENDR

.RUN START
