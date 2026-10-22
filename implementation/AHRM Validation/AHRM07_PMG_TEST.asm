; AHRM-07 GTIA/PMG visual diagnostic for jsA8E, native A8E, Altirra,
; and real Atari hardware.
;
; The program exercises visible player/missile DMA, PMBASE changes,
; HPOS/PRIOR changes from a DLI, and the P0/P1 collision latches.

.ORG $2000

DMACTL  = $D400
PMBASE  = $D407
CHBASE  = $D409
NMIRES  = $D40F
NMIEN   = $D40E
DLISTL  = $D402
DLISTH  = $D403

HPOSP0  = $D000
HPOSP1  = $D001
HPOSP2  = $D002
HPOSP3  = $D003
SIZEP0  = $D008
SIZEP1  = $D009
SIZEP2  = $D00A
SIZEP3  = $D00B
COLPM0  = $D012
COLPM1  = $D013
COLPM2  = $D014
COLPM3  = $D015
COLPF0  = $D016
COLBK   = $D01A
PRIOR   = $D01B
VDELAY  = $D01C
GRACTL  = $D01D
HITCLR  = $D01E
P0PL    = $D00C
P1PL    = $D00D

SDLSTL  = $0230
VDSLST  = $0200

SRC_LO  = $80
SRC_HI  = $81
DST_LO  = $82
DST_HI  = $83
PM_PHASE = $2FF0
COLLISION_STATE = $2FF1
PM_TICKS = $2FF2

START:
        ; Disable NMIs while the display list and PMG are being installed.
        LDA #$00
        STA NMIEN
        STA PM_PHASE
        STA COLLISION_STATE
        STA PM_TICKS
        STA VDELAY

        ; Use the OS character set and a normal-width playfield.
        LDA #$E0
        STA CHBASE
        LDA #$2E
        STA DMACTL
        LDA #$03
        STA GRACTL

        ; Put players 0 and 1 together first so their latches can pass.
        LDA #$30
        STA HPOSP0
        STA HPOSP1
        LDA #$60
        STA HPOSP2
        LDA #$70
        STA HPOSP3
        LDA #$00
        STA SIZEP0
        STA SIZEP1
        STA SIZEP2
        STA SIZEP3

        LDA #$34
        STA COLPM0
        LDA #$C4
        STA COLPM1
        LDA #$58
        STA COLPM2
        LDA #$A8
        STA COLPM3
        LDA #$0E
        STA COLPF0
        LDA #$00
        STA COLBK
        STA PRIOR
        STA HITCLR
        LDA #$40
        STA PMBASE

        ; Install the display list and DLI through the normal OS shadows.
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

        JSR DRAW_LABELS
        LDA #$80
        STA NMIEN

WAIT:
        JSR CHECK_COLLISION
        JMP WAIT

; The DLI holds each PMBASE/HPOS/PRIOR configuration for 32 frames. The short
; delay makes the writes occur after the beginning of the active scanline
; instead of only at reset time. PMBASE is written before the delay for the
; next DMA. Holding each phase makes visual differences deterministic.
DLI_HANDLER:
        PHA
        TXA
        PHA
        TYA
        PHA

        INC PM_TICKS
        LDA PM_TICKS
        CMP #$20
        BCC DLI_FINISH
        LDA #$00
        STA PM_TICKS
        LDA PM_PHASE
        EOR #$01
        STA PM_PHASE
        BNE DLI_BASE_B

DLI_BASE_A:
        LDA #$40
        STA PMBASE
        LDA #$00
        STA PRIOR
        LDA #$30
        STA HPOSP0
        STA HPOSP1
        JMP DLI_DELAY

DLI_BASE_B:
        LDA #$80
        STA PMBASE
        LDA #$04
        STA PRIOR
        LDA #$18
        STA HPOSP0
        LDA #$30
        STA HPOSP1

DLI_DELAY:
        LDX #$08
DLI_DELAY_LOOP:
        NOP
        DEX
        BNE DLI_DELAY_LOOP
DLI_FINISH:
        LDA #$80
        STA NMIRES
        PLA
        TAY
        PLA
        TAX
        PLA
        RTI

CHECK_COLLISION:
        LDA COLLISION_STATE
        BNE CHECK_COLLISION_DONE
        LDA P0PL
        AND #$02
        BEQ CHECK_COLLISION_DONE
        LDA P1PL
        AND #$01
        BEQ CHECK_COLLISION_DONE

        LDA #$01
        STA COLLISION_STATE
        LDA #<STATUS_PASS
        STA SRC_LO
        LDA #>STATUS_PASS
        STA SRC_HI
        LDA #<(SCREEN + 160)
        STA DST_LO
        LDA #>(SCREEN + 160)
        STA DST_HI
        JSR DRAW_TEXT

CHECK_COLLISION_DONE:
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

        LDA #<PLAYER_TEXT
        STA SRC_LO
        LDA #>PLAYER_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 80)
        STA DST_LO
        LDA #>(SCREEN + 80)
        STA DST_HI
        JSR DRAW_TEXT

        LDA #<PHASE_TEXT
        STA SRC_LO
        LDA #>PHASE_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 120)
        STA DST_LO
        LDA #>(SCREEN + 120)
        STA DST_HI
        JSR DRAW_TEXT

        LDA #<STATUS_WAIT
        STA SRC_LO
        LDA #>STATUS_WAIT
        STA SRC_HI
        LDA #<(SCREEN + 160)
        STA DST_LO
        LDA #>(SCREEN + 160)
        STA DST_HI
        JSR DRAW_TEXT

        LDA #<LATCH_TEXT
        STA SRC_LO
        LDA #>LATCH_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 200)
        STA DST_LO
        LDA #>(SCREEN + 200)
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
        .BYTE "AHRM07 GTIA PMG TEST", $00
DETAIL_TEXT:
        .BYTE "HPOS PRIOR PMBASE DMA", $00
PLAYER_TEXT:
        .BYTE "BARS SHOW PLAYER DMA", $00
PHASE_TEXT:
        .BYTE "PMG PHASE CHANGES EVERY 32F", $00
STATUS_WAIT:
        .BYTE "P0/P1 COLLISION: WAIT", $00
STATUS_PASS:
        .BYTE "P0/P1 COLLISION: PASS", $00
LATCH_TEXT:
        .BYTE "PASS = REAL GTIA COLLISION", $00

; One 40-column mode-2 screen with a DLI on the final row of every frame.
.ORG $3000
DISPLAY_LIST:
        .BYTE $70, $70, $70
        .BYTE $42, <SCREEN, >SCREEN
        .REPT 23
        .BYTE $02
        .ENDR
        .BYTE $82
        .BYTE $41, <DISPLAY_LIST, >DISPLAY_LIST

; PMBASE=$40: in two-line PMG mode the players start at PMBASE+$0200.
; P0/P1 use solid graphics, so their overlap sets both latches.
.ORG $4000
        .REPT 512
        .BYTE $00
        .ENDR
        .REPT 128
        .BYTE $FF
        .ENDR
        .REPT 128
        .BYTE $FF
        .ENDR
        .REPT 128
        .BYTE $AA
        .ENDR
        .REPT 128
        .BYTE $AA
        .ENDR

.ORG $5000
SCREEN:
        .REPT 960
        .BYTE $00
        .ENDR

; PMBASE=$80: the different bit pattern makes live PMBASE changes visible.
.ORG $8000
        .REPT 512
        .BYTE $00
        .ENDR
        .REPT 128
        .BYTE $81
        .ENDR
        .REPT 128
        .BYTE $81
        .ENDR
        .REPT 128
        .BYTE $55
        .ENDR
        .REPT 128
        .BYTE $55
        .ENDR

.RUN START
