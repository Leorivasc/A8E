; AHRM-06 ANTIC visual diagnostic for jsA8E, A8E, Altirra, and hardware.
; This program exercises a chained display list with:
;   1. Normal-width mode 2 and a DLI boundary.
;   2. Wide-width mode 2 selected by that DLI.
;   3. Mode 3 with VSCROL and a final DLI before the display-list replay.
;
; The exact DMA cycle and VSCROL deadline assertions remain in the native/JS
; probes. This XEX is intended to expose visible raster regressions on a real
; Atari or a second emulator.

.ORG $2000

DMACTL  = $D400
CHBASE  = $D409
WSYNC   = $D40A
NMIEN   = $D40E
NMIRES  = $D40F
VSCROL  = $D405
DLISTL  = $D402
DLISTH  = $D403
COLPF0  = $D016
COLPF1  = $D017
COLPF2  = $D018
COLPF3  = $D019
COLBK   = $D01A

SDLSTL  = $0230
VDSLST  = $0200

SRC_LO  = $80
SRC_HI  = $81
DST_LO  = $82
DST_HI  = $83
DLI_PHASE = $2FF0

START:
        ; Use the OS character set for the labels and enable ANTIC DMA.
        LDA #$E0
        STA CHBASE
        LDA #$22
        STA DMACTL
        LDA #$00
        STA VSCROL
        STA DLI_PHASE
        STA COLBK
        LDA #$0E
        STA COLPF0
        LDA #$04
        STA COLPF1
        LDA #$08
        STA COLPF2
        LDA #$0A
        STA COLPF3

        ; Install the display list in both the OS shadow and ANTIC register.
        LDA #<DISPLAY_LIST
        STA SDLSTL
        STA DLISTL
        LDA #>DISPLAY_LIST
        STA SDLSTL + 1
        STA DLISTH

        ; Install a small DLI handler. The OS VBI remains enabled.
        LDA #<DLI_HANDLER
        STA VDSLST
        LDA #>DLI_HANDLER
        STA VDSLST + 1
        LDA #$C0
        STA NMIEN

        JSR DRAW_LABELS

WAIT:
        JMP WAIT

; Each DLI marks a section boundary. The first one switches the next section
; to wide mode; the second restores normal width and starts VSCROL mode 3.
DLI_HANDLER:
        PHA
        TXA
        PHA
        TYA
        PHA
        LDA DLI_PHASE
        CMP #$02
        BCS DLI_DONE
        INC DLI_PHASE
        LDA DLI_PHASE
        CMP #$01
        BNE DLI_SECOND
        LDA #$23
        STA DMACTL
        LDA #$06
        STA COLBK
        LDA #$0A
        STA COLPF0
        ; Persist a visible proof of the first DLI in screen RAM. The OS VBI
        ; may restore GTIA color registers, but it cannot erase this marker.
        LDA #$24
        STA SCREEN_WIDE + 48
        LDA #$2C
        STA SCREEN_WIDE + 49
        LDA #$29
        STA SCREEN_WIDE + 50
        LDA #$11
        STA SCREEN_WIDE + 51
        JMP DLI_DONE

DLI_SECOND:
        CMP #$02
        BNE DLI_DONE
        LDA #$22
        STA DMACTL
        LDA #$04
        STA VSCROL
        LDA #$0A
        STA COLBK
        LDA #$0C
        STA COLPF0
        ; Persist a visible proof of the second DLI after the two partial
        ; VSCROL lines, on the same full-height row as the mode-3 label.
        LDA #$24
        STA SCREEN_VSCROLL + 120
        LDA #$2C
        STA SCREEN_VSCROLL + 121
        LDA #$29
        STA SCREEN_VSCROLL + 122
        LDA #$12
        STA SCREEN_VSCROLL + 123

DLI_DONE:
        LDA #$80
        STA NMIRES
        PLA
        TAY
        PLA
        TAX
        PLA
        RTI

; Put readable labels in each diagnostic screen.
DRAW_LABELS:
        LDA #<TITLE_TEXT
        STA SRC_LO
        LDA #>TITLE_TEXT
        STA SRC_HI
        LDA #<SCREEN_NORMAL
        STA DST_LO
        LDA #>SCREEN_NORMAL
        STA DST_HI
        JSR DRAW_TEXT

        LDA #<WIDE_TEXT
        STA SRC_LO
        LDA #>WIDE_TEXT
        STA SRC_HI
        LDA #<SCREEN_WIDE
        STA DST_LO
        LDA #>SCREEN_WIDE
        STA DST_HI
        JSR DRAW_TEXT

        LDA #<VSCROLL_TEXT
        STA SRC_LO
        LDA #>VSCROLL_TEXT
        STA SRC_HI
        ; VSCROL=4 produces two partial mode-3 lines: the entry line starts
        ; at row 4 and the exit line ends at row 4. Place the label after
        ; both, on the following full-height character row.
        LDA #<(SCREEN_VSCROLL + 80)
        STA DST_LO
        LDA #>(SCREEN_VSCROLL + 80)
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

TITLE_TEXT:
        .BYTE "AHRM06 ANTIC MODE 2", $00
WIDE_TEXT:
        .BYTE "AHRM06 ANTIC MODE 2 WIDE", $00
VSCROLL_TEXT:
        .BYTE "AHRM06 ANTIC MODE 3 VSCROL", $00

; Three sections of one frame. The DLI bits are on the final line of each
; section so the handler controls the following section.
.ORG $3000
DISPLAY_LIST:
        .BYTE $70, $70, $70
        .BYTE $42, <SCREEN_NORMAL, >SCREEN_NORMAL
        .REPT 6
        .BYTE $02
        .ENDR
        .BYTE $82

        .BYTE $42, <SCREEN_WIDE, >SCREEN_WIDE
        .REPT 6
        .BYTE $02
        .ENDR
        .BYTE $82

        .BYTE $63, <SCREEN_VSCROLL, >SCREEN_VSCROLL
        .REPT 6
        .BYTE $03
        .ENDR
        .BYTE $83
        .BYTE $41, <DISPLAY_LIST, >DISPLAY_LIST

; Normal mode-2 screen: 40 bytes per character row, eight rows.
.ORG $4000
SCREEN_NORMAL:
        .REPT 320
        .BYTE $00
        .ENDR

; Mode-3 screen: the same 40-byte geometry, with VSCROL applied to its first
; line. The label is written at runtime before ANTIC begins displaying it.
.ORG $4400
SCREEN_VSCROLL:
        .REPT 320
        .BYTE $00
        .ENDR

; Wide mode-2 screen: 48 bytes per row, exercising the wide fetch window.
.ORG $4800
SCREEN_WIDE:
        .REPT 384
        .BYTE $00
        .ENDR

.RUN START
