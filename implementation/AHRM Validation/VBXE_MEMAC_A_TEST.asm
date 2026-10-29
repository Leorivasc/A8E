; VBXE FX 1.26 MEMAC A diagnostic.
; The Altirra device choice "$D600" exposes the register bank at $D640;
; "$D700" exposes it at $D740. This diagnostic detects either register page.
; It maps local VRAM bank 0 through MEMAC A as a 4 KiB $6000-$6FFF window,
; enabled independently for CPU and ANTIC. Seeing all PASS lines proves both
; masters use that flexible window rather than normal main RAM.

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

; Disable MEMAC B, then select MEMAC A at $6000: 4 KiB, CPU+ANTIC enabled,
; local bank 0. MEMAC_BANK_SEL bit 7 enables the A window.
        LDA #$00
        LDY #$1D
        STA (VBXE_LO),Y
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
        BNE CPU_MAPPING_FAILED

        JSR CLEAR_SCREEN
        JSR DRAW_PASS_SCREEN
        JMP SETUP_DISPLAY

CORE_MISSING:
        JSR CLEAR_SCREEN
        JSR DRAW_CORE_ERROR
        JMP SETUP_DISPLAY

CPU_MAPPING_FAILED:
        JSR CLEAR_SCREEN
        JSR DRAW_CPU_ERROR

; A VBXE configured by Altirra as $D600 has its register bank at $D640.
; The alternative $D700 choice places the same bank at $D740. CORE_REVISION
; differs in its low nibble between FX implementations, so only its major
; version is tested; bit 7 of MINOR_REVISION is the optional RAMBO capability.
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

DRAW_CPU_ERROR:
        LDA #<TEXT_CPU_FAIL
        STA SRC_LO
        LDA #>TEXT_CPU_FAIL
        STA SRC_HI
        LDA #<SCREEN
        STA DST_LO
        LDA #>SCREEN
        STA DST_HI
        JMP PUT_TEXT

; Convert printable uppercase ASCII into the normal ANTIC screen-code range.
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
        .BYTE "VBXE MEMAC A FOUR K WINDOW", $00
TEXT_CORE:
        .BYTE "FX ONE TWO SIX CORE PASS", $00
TEXT_CPU:
        .BYTE "CPU SIX ZERO ZERO ZERO PASS", $00
TEXT_ANTIC:
        .BYTE "ANTIC LOCAL VRAM SOURCE PASS", $00
TEXT_NO_CORE:
        .BYTE "VBXE FX ONE TWO SIX NOT FOUND", $00
TEXT_CPU_FAIL:
        .BYTE "VBXE CPU MEMAC A READ WRITE FAIL", $00

.ORG $3000
DISPLAY_LIST:
        .BYTE $70, $70, $70
        .BYTE $42, <SCREEN, >SCREEN
        .REPT 23
        .BYTE $02
        .ENDR
        .BYTE $41, <DISPLAY_LIST, >DISPLAY_LIST

.RUN START
