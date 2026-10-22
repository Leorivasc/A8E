; AHRM-12 ANTIC display-list and scrolling diagnostic.
; The display list uses LMS, DLI, HSCROL, VSCROL, and JVB sections. The DLI
; changes scroll registers only at section boundaries so the result is stable
; enough to compare on hardware.

.ORG $2000

DMACTL  = $D400
HSCROL  = $D404
VSCROL  = $D405
CHBASE  = $D409
NMIEN   = $D40E
NMIRES  = $D40F
DLISTL  = $D402
DLISTH  = $D403
COLBK   = $D01A
COLPF0  = $D016
COLPF1  = $D017

SDLSTL  = $0230
VDSLST  = $0200
SRC_LO  = $80
SRC_HI  = $81
DST_LO  = $82
DST_HI  = $83
DLI_SECTION = $2FF0
SCROLL_PHASE = $2FF1
SCROLL_TICKS = $2FF2

START:
        LDA #$00
        STA NMIEN
        STA DLI_SECTION
        STA SCROLL_PHASE
        STA SCROLL_TICKS
        STA HSCROL
        STA VSCROL
        STA COLBK
        LDA #$E0
        STA CHBASE
        LDA #$22
        STA DMACTL
        LDA #$0E
        STA COLPF0
        LDA #$04
        STA COLPF1

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
        JSR DRAW_LABELS
        JSR DRAW_SCROLL_PATTERN
        LDA #$C0
        STA NMIEN

WAIT:
        JMP WAIT

; DLI 0 prepares the HSCROL section. DLI 1 prepares the VSCROL section.
; DLI 2 closes the frame and advances the horizontal-scroll phase.
DLI_HANDLER:
        PHA
        TXA
        PHA
        TYA
        PHA
        LDX DLI_SECTION
        CPX #$00
        BEQ DLI_NORMAL_END
        CPX #$01
        BEQ DLI_HSCROLL_END

; End of the VSCROL section.
        LDA #$00
        STA VSCROL
        STA HSCROL
        INC SCROLL_TICKS
        LDA SCROLL_TICKS
        CMP #$10
        BCC DLI_SET_THIRD
        LDA #$00
        STA SCROLL_TICKS
        INC SCROLL_PHASE
        LDA SCROLL_PHASE
        CMP #$04
        BCC DLI_SET_THIRD
        LDA #$00
        STA SCROLL_PHASE
DLI_SET_THIRD:
        LDA #$00
        STA DLI_SECTION
        JMP DLI_DONE

DLI_NORMAL_END:
        LDX SCROLL_PHASE
        LDA HSCROLL_VALUES,X
        STA HSCROL
        LDA #$01
        STA DLI_SECTION
        JMP DLI_DONE

DLI_HSCROLL_END:
        LDA #$04
        STA VSCROL
        LDA #$02
        STA DLI_SECTION

DLI_DONE:
        LDA #$80
        STA NMIRES
        PLA
        TAY
        PLA
        TAX
        PLA
        RTI

CLEAR_SCREENS:
        LDX #$00
        LDA #$00
CLEAR_LOOP:
        STA SCREEN_NORMAL,X
        STA SCREEN_NORMAL + 256,X
        STA SCREEN_HSCROLL,X
        STA SCREEN_HSCROLL + 256,X
        STA SCREEN_VSCROLL,X
        STA SCREEN_VSCROLL + 256,X
        INX
        BNE CLEAR_LOOP
        RTS

DRAW_LABELS:
        LDA #<NORMAL_TEXT
        STA SRC_LO
        LDA #>NORMAL_TEXT
        STA SRC_HI
        LDA #<SCREEN_NORMAL
        STA DST_LO
        LDA #>SCREEN_NORMAL
        STA DST_HI
        JSR DRAW_TEXT
        LDA #<HSCROLL_TEXT
        STA SRC_LO
        LDA #>HSCROLL_TEXT
        STA SRC_HI
        LDA #<SCREEN_HSCROLL
        STA DST_LO
        LDA #>SCREEN_HSCROLL
        STA DST_HI
        JSR DRAW_TEXT
        LDA #<VSCROLL_TEXT
        STA SRC_LO
        LDA #>VSCROLL_TEXT
        STA SRC_HI
        LDA #<SCREEN_VSCROLL
        STA DST_LO
        LDA #>SCREEN_VSCROLL
        STA DST_HI
        JSR DRAW_TEXT
        RTS

DRAW_SCROLL_PATTERN:
        LDX #$00
        LDY #$00
DRAW_PATTERN_LOOP:
        LDA SCROLL_PATTERN,X
        STA SCREEN_HSCROLL + 160,Y
        STA SCREEN_VSCROLL + 160,Y
        INX
        INY
        CPY #$28
        BCC DRAW_PATTERN_LOOP
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

HSCROLL_VALUES:
        .BYTE $00, $04, $08, $0C
SCROLL_PATTERN:
        .BYTE $00,$11,$22,$33,$44,$55,$66,$77,$88,$99,$AA,$BB,$CC,$DD,$EE,$FF
        .BYTE $00,$11,$22,$33,$44,$55,$66,$77,$88,$99,$AA,$BB,$CC,$DD,$EE,$FF
        .BYTE $00,$11,$22,$33,$44,$55,$66,$77
NORMAL_TEXT:
        .BYTE "AHRM12 ANTIC LMS JVB", $00
HSCROLL_TEXT:
        .BYTE "HSCROL 0 4 8 C", $00
VSCROLL_TEXT:
        .BYTE "VSCROL 4", $00

.ORG $3000
DISPLAY_LIST:
        .BYTE $70, $70, $70
        .BYTE $42, <SCREEN_NORMAL, >SCREEN_NORMAL
        .REPT 5
        .BYTE $02
        .ENDR
        .BYTE $82

        .BYTE $52, <SCREEN_HSCROLL, >SCREEN_HSCROLL
        .REPT 5
        .BYTE $12
        .ENDR
        .BYTE $92

        .BYTE $63, <SCREEN_VSCROLL, >SCREEN_VSCROLL
        .REPT 5
        .BYTE $23
        .ENDR
        .BYTE $A3
        .BYTE $41, <DISPLAY_LIST, >DISPLAY_LIST

.ORG $4000
SCREEN_NORMAL:
        .REPT 320
        .BYTE $00
        .ENDR
.ORG $4400
SCREEN_HSCROLL:
        .REPT 320
        .BYTE $00
        .ENDR
.ORG $4800
SCREEN_VSCROLL:
        .REPT 320
        .BYTE $00
        .ENDR

.RUN START
