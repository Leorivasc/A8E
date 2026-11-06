; VBXE FX 1.26 MEMAC A-over-B priority diagnostic.
; MEMAC B bank 1 first fills $6000 with $A5. MEMAC A bank 0 then overlays
; the same 4 KiB Atari range and stores $5A. The test temporarily disables A
; to prove B still contains $A5, re-enables A to prove it contains $5A, and
; finally lets ANTIC display text through A. This verifies A priority for both
; the CPU and ANTIC address paths.

.ORG $2000

DMACTL  = $D400
DLISTL  = $D402
DLISTH  = $D403
NMIEN   = $D40E
COLBK   = $D01A
COLPF0  = $D016
SDLSTL  = $0230

SCREEN = $6000

SRC_LO = $80
SRC_HI = $81
DST_LO = $82
DST_HI = $83
VBXE_LO = $84
VBXE_HI = $85

START:
        LDA #$00
        STA NMIEN
        JSR DETECT_VBXE
        BCC CORE_MISSING

; MEMAC B: bank 1, CPU+ANTIC. Write its sentinel through $6000.
        LDA #$C1
        LDY #$1D
        STA (VBXE_LO),Y
        LDA #$A5
        STA SCREEN

; MEMAC A: bank 0, 4 KiB at $6000, CPU+ANTIC. It must override B here.
        LDA #$6C
        INY
        STA (VBXE_LO),Y
        LDA #$80
        INY
        STA (VBXE_LO),Y
        LDA #$5A
        STA SCREEN
        LDA SCREEN
        CMP #$5A
        BNE PRIORITY_FAILED

; With A disabled, the original B-bank sentinel must be exposed again.
        LDA #$00
        STA (VBXE_LO),Y
        LDA SCREEN
        CMP #$A5
        BNE PRIORITY_FAILED

; Re-enable A and keep it active for the ANTIC display-list fetches.
        LDA #$80
        STA (VBXE_LO),Y
        LDA SCREEN
        CMP #$5A
        BNE PRIORITY_FAILED

        JSR CLEAR_SCREEN
        JSR DRAW_PASS_SCREEN
        JMP SETUP_DISPLAY

CORE_MISSING:
        JSR CLEAR_SCREEN
        JSR DRAW_CORE_ERROR
        JMP SETUP_DISPLAY

PRIORITY_FAILED:
        JSR CLEAR_SCREEN
        JSR DRAW_PRIORITY_ERROR

; Altirra's $D600/$D700 device ranges expose the register banks at $D640/$D740.
DETECT_VBXE:
        LDA #<$D640
        STA VBXE_LO
        LDA #>$D640
        STA VBXE_HI
        JSR CHECK_VBXE_PAGE
        BCS DETECT_DONE
        LDA #<$D740
        STA VBXE_LO
        LDA #>$D740
        STA VBXE_HI
        JSR CHECK_VBXE_PAGE
DETECT_DONE:
        RTS

CHECK_VBXE_PAGE:
        LDY #$00
        LDA (VBXE_LO),Y
        AND #$F0
        CMP #$10
        BNE CHECK_VBXE_MISSING
        INY
        LDA (VBXE_LO),Y
        AND #$7F
        CMP #$26
        BNE CHECK_VBXE_MISSING
        SEC
        RTS
CHECK_VBXE_MISSING:
        CLC
        RTS

SETUP_DISPLAY:
        LDA #$00
        STA COLBK
        LDA #$0E
        STA COLPF0
        LDA #<DISPLAY_LIST
        STA SDLSTL
        STA DLISTL
        LDA #>DISPLAY_LIST
        STA SDLSTL + 1
        STA DLISTH
        LDA #$22
        STA DMACTL

WAIT:
        JMP WAIT

CLEAR_SCREEN:
        LDX #$00
        LDA #$00
CLEAR_LOOP:
        STA SCREEN,X
        STA SCREEN + $100,X
        STA SCREEN + $200,X
        STA SCREEN + $300,X
        INX
        BNE CLEAR_LOOP
        RTS

DRAW_PASS_SCREEN:
        LDA #<TEXT_TITLE
        STA SRC_LO
        LDA #>TEXT_TITLE
        STA SRC_HI
        LDA #<SCREEN
        STA DST_LO
        LDA #>SCREEN
        STA DST_HI
        JSR PUT_TEXT

        LDA #<TEXT_CORE
        STA SRC_LO
        LDA #>TEXT_CORE
        STA SRC_HI
        LDA #<(SCREEN + 80)
        STA DST_LO
        LDA #>(SCREEN + 80)
        STA DST_HI
        JSR PUT_TEXT

        LDA #<TEXT_CPU
        STA SRC_LO
        LDA #>TEXT_CPU
        STA SRC_HI
        LDA #<(SCREEN + 160)
        STA DST_LO
        LDA #>(SCREEN + 160)
        STA DST_HI
        JSR PUT_TEXT

        LDA #<TEXT_ANTIC
        STA SRC_LO
        LDA #>TEXT_ANTIC
        STA SRC_HI
        LDA #<(SCREEN + 240)
        STA DST_LO
        LDA #>(SCREEN + 240)
        STA DST_HI
        JMP PUT_TEXT

DRAW_CORE_ERROR:
        LDA #<TEXT_NO_CORE
        STA SRC_LO
        LDA #>TEXT_NO_CORE
        STA SRC_HI
        LDA #<SCREEN
        STA DST_LO
        LDA #>SCREEN
        STA DST_HI
        JMP PUT_TEXT

DRAW_PRIORITY_ERROR:
        LDA #<TEXT_PRIORITY_FAIL
        STA SRC_LO
        LDA #>TEXT_PRIORITY_FAIL
        STA SRC_HI
        LDA #<SCREEN
        STA DST_LO
        LDA #>SCREEN
        STA DST_HI
        JMP PUT_TEXT

PUT_TEXT:
        LDY #$00
PUT_TEXT_NEXT:
        LDA (SRC_LO),Y
        BEQ PUT_TEXT_DONE
        CMP #' '
        BNE PUT_TEXT_CHARACTER
        LDA #$00
        JMP PUT_TEXT_STORE
PUT_TEXT_CHARACTER:
        AND #$1F
        ORA #$20
PUT_TEXT_STORE:
        STA (DST_LO),Y
        INY
        BNE PUT_TEXT_NEXT
PUT_TEXT_DONE:
        RTS

TEXT_TITLE:
        .BYTE "VBXE MEMAC A OVER B PRIORITY", $00
TEXT_CORE:
        .BYTE "FX ONE TWO SIX CORE PASS", $00
TEXT_CPU:
        .BYTE "CPU A OVER B BANK PASS", $00
TEXT_ANTIC:
        .BYTE "ANTIC A WINDOW SOURCE PASS", $00
TEXT_NO_CORE:
        .BYTE "VBXE FX ONE TWO SIX NOT FOUND", $00
TEXT_PRIORITY_FAIL:
        .BYTE "VBXE MEMAC PRIORITY FAIL", $00

.ORG $3000
DISPLAY_LIST:
        .BYTE $70, $70, $70
        .BYTE $42, <SCREEN, >SCREEN
        .REPT 23
        .BYTE $02
        .ENDR
        .BYTE $41, <DISPLAY_LIST, >DISPLAY_LIST

.RUN START
