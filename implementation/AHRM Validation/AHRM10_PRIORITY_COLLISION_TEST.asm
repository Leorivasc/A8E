; AHRM-10 GTIA priority and collision diagnostic.
;
; This version presents the test as a small space scene. A red ship stays
; on the left, a green target stays on the right, and a yellow missile moves
; between them. GTIA priority still cycles through the AHRM cases while the
; real collision latches are displayed as a human-readable status.

.ORG $2000

DMACTL  = $D400
PMBASE  = $D407
CHBASE  = $D409
NMIEN   = $D40E
NMIRES  = $D40F
DLISTL  = $D402
DLISTH  = $D403
PRIOR   = $D01B
COLPM0  = $D012
COLPM1  = $D013
COLPM2  = $D014
COLPM3  = $D015
COLPF0  = $D016
COLPF1  = $D017
COLPF2  = $D018
COLPF3  = $D019
COLBK   = $D01A
VDELAY  = $D01C
GRACTL  = $D01D
HITCLR  = $D01E

HPOSP0  = $D000
HPOSP1  = $D001
HPOSP2  = $D002
HPOSP3  = $D003
HPOSM0  = $D004
HPOSM1  = $D005
HPOSM2  = $D006
HPOSM3  = $D007
SIZEP0  = $D008
SIZEP1  = $D009
SIZEP2  = $D00A
SIZEP3  = $D00B
M0PL    = $D008
M1PL    = $D009
M2PL    = $D00A
M3PL    = $D00B
P0PL    = $D00C
P1PL    = $D00D
P2PL    = $D00E
P3PL    = $D00F

SDLSTL  = $0230
VDSLST  = $0200
SRC_LO  = $80
SRC_HI  = $81
DST_LO  = $82
DST_HI  = $83
VALUE   = $84
PRIOR_INDEX = $2FF0
PRIOR_TICKS = $2FF1
PRIOR_VALUE = $2FF2
BULLET_X = $2FF3
COLLISION_STATE = $2FF4
DISPLAY_DIRTY = $2FF5

START:
        LDA #$00
        STA NMIEN
        STA PRIOR_INDEX
        STA PRIOR_TICKS
        STA COLLISION_STATE
        STA DISPLAY_DIRTY
        LDA #$58
        STA BULLET_X

        LDA #$E0
        STA CHBASE
        LDA #$40
        STA PMBASE
        LDA #$3E
        STA DMACTL
        LDA #$03
        STA GRACTL
        LDA #$00
        STA VDELAY
        LDA #$00
        STA COLBK
        STA COLPF1
        STA PRIOR
        STA HITCLR
        STA PRIOR_VALUE
        LDA #$0E
        STA COLPF0
        LDA #$C4
        STA COLPF1
        LDA #$58
        STA COLPF2
        LDA #$A8
        STA COLPF3

        LDA #$34
        STA COLPM0
        LDA #$C4
        STA COLPM1
        LDA #$58
        STA COLPM2
        LDA #$E6
        STA COLPM3

        LDA #$40
        STA HPOSP0
        LDA #$A0
        STA HPOSP1
        LDA #$C0
        STA HPOSP2
        LDA #$D8
        STA HPOSP3
        LDA #$58
        STA HPOSM0
        LDA #$70
        STA HPOSM1
        LDA #$B8
        STA HPOSM2
        LDA #$D0
        STA HPOSM3
        LDA #$00
        STA SIZEP0
        STA SIZEP1
        STA SIZEP2
        STA SIZEP3

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

        JSR CLEAR_SCREEN
        JSR DRAW_SCENE
        LDA #$80
        STA NMIEN

WAIT:
        LDA DISPLAY_DIRTY
        BEQ CHECK_COLLISIONS
        LDA #$00
        STA DISPLAY_DIRTY
        JSR UPDATE_PHASE_TEXT

CHECK_COLLISIONS:
        JSR UPDATE_LATCH_TEXT
        LDA COLLISION_STATE
        BNE WAIT

        ; M0PL bit 1 means missile 0 touched player 1, the green target.
        LDA M0PL
        AND #$02
        BNE SHOW_HIT
        ; P0PL/P1PL provide the player-to-player collision confirmation.
        LDA P0PL
        AND #$02
        BEQ WAIT
        LDA P1PL
        AND #$01
        BEQ WAIT

SHOW_HIT:
        LDA #$01
        STA COLLISION_STATE
        LDA #<STATUS_HIT
        STA SRC_LO
        LDA #>STATUS_HIT
        STA SRC_HI
        LDA #<(SCREEN + 60)
        STA DST_LO
        LDA #>(SCREEN + 60)
        STA DST_HI
        JSR DRAW_TEXT
        JMP WAIT

; One DLI is generated on the final display-list line. The yellow missile
; advances every frame, while PRIOR changes every 32 frames. Clearing HITCLR
; at a phase boundary makes each scene independently observable.
DLI_HANDLER:
        PHA
        TXA
        PHA
        TYA
        PHA

        LDA BULLET_X
        CLC
        ADC #$04
        CMP #$A4
        BCC BULLET_STORE
        LDA #$58
BULLET_STORE:
        STA BULLET_X
        STA HPOSM0

        INC PRIOR_TICKS
        LDA PRIOR_TICKS
        CMP #$20
        BCC DLI_FINISH
        LDA #$00
        STA PRIOR_TICKS
        INC PRIOR_INDEX
        LDA PRIOR_INDEX
        CMP #$09
        BCC SET_PRIORITY
        LDA #$00
        STA PRIOR_INDEX
SET_PRIORITY:
        TAX
        LDA PRIOR_VALUES,X
        STA PRIOR
        STA PRIOR_VALUE
        STA HITCLR
        LDA #$00
        STA COLLISION_STATE
        LDA #$01
        STA DISPLAY_DIRTY
        LDA #$58
        STA BULLET_X
        STA HPOSM0

DLI_FINISH:
        LDA #$80
        STA NMIRES
        PLA
        TAY
        PLA
        TAX
        PLA
        RTI

UPDATE_PHASE_TEXT:
        LDA #<SCENE_TEXT
        STA SRC_LO
        LDA #>SCENE_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 40)
        STA DST_LO
        LDA #>(SCREEN + 40)
        STA DST_HI
        JSR DRAW_TEXT
        LDA PRIOR_VALUE
        LDX #<(SCREEN + 48)
        LDY #>(SCREEN + 48)
        STX DST_LO
        STY DST_HI
        JSR WRITE_HEX

        LDA #<STATUS_WAIT
        STA SRC_LO
        LDA #>STATUS_WAIT
        STA SRC_HI
        LDA #<(SCREEN + 60)
        STA DST_LO
        LDA #>(SCREEN + 60)
        STA DST_HI
        JMP DRAW_TEXT

UPDATE_LATCH_TEXT:
        LDA M0PL
        LDX #<(SCREEN + 203)
        LDY #>(SCREEN + 203)
        STX DST_LO
        STY DST_HI
        JSR WRITE_HEX
        LDA P0PL
        LDX #<(SCREEN + 208)
        LDY #>(SCREEN + 208)
        STX DST_LO
        STY DST_HI
        JSR WRITE_HEX
        LDA P1PL
        LDX #<(SCREEN + 213)
        LDY #>(SCREEN + 213)
        STX DST_LO
        STY DST_HI
        JMP WRITE_HEX

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

DRAW_SCENE:
        LDA #<TITLE_TEXT
        STA SRC_LO
        LDA #>TITLE_TEXT
        STA SRC_HI
        LDA #<SCREEN
        STA DST_LO
        LDA #>SCREEN
        STA DST_HI
        JSR DRAW_TEXT
        LDA #<INSTRUCTIONS_TEXT
        STA SRC_LO
        LDA #>INSTRUCTIONS_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 20)
        STA DST_LO
        LDA #>(SCREEN + 20)
        STA DST_HI
        JSR DRAW_TEXT
        LDA #<SCENE_TEXT
        STA SRC_LO
        LDA #>SCENE_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 40)
        STA DST_LO
        LDA #>(SCREEN + 40)
        STA DST_HI
        JSR DRAW_TEXT
        LDA PRIOR_VALUE
        LDX #<(SCREEN + 48)
        LDY #>(SCREEN + 48)
        STX DST_LO
        STY DST_HI
        JSR WRITE_HEX
        LDA #<STATUS_WAIT
        STA SRC_LO
        LDA #>STATUS_WAIT
        STA SRC_HI
        LDA #<(SCREEN + 60)
        STA DST_LO
        LDA #>(SCREEN + 60)
        STA DST_HI
        JSR DRAW_TEXT
        LDA #<LEGEND_TEXT
        STA SRC_LO
        LDA #>LEGEND_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 80)
        STA DST_LO
        LDA #>(SCREEN + 80)
        STA DST_HI
        JSR DRAW_TEXT
        LDA #<LEGEND2_TEXT
        STA SRC_LO
        LDA #>LEGEND2_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 100)
        STA DST_LO
        LDA #>(SCREEN + 100)
        STA DST_HI
        JSR DRAW_TEXT
        LDA #<REGISTER_TEXT
        STA SRC_LO
        LDA #>REGISTER_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 200)
        STA DST_LO
        LDA #>(SCREEN + 200)
        STA DST_HI
        JMP DRAW_TEXT

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

PRIOR_VALUES:
        .BYTE $00, $01, $02, $04, $08, $03, $05, $10, $20
HEX_DIGITS:
        .BYTE $10,$11,$12,$13,$14,$15,$16,$17
        .BYTE $18,$19,$21,$22,$23,$24,$25,$26
TITLE_TEXT:
        .BYTE "AHRM10 SPACE TEST", $00
INSTRUCTIONS_TEXT:
        .BYTE "BULLET HITS TARGET", $00
SCENE_TEXT:
        .BYTE "PRIORITY", $00
STATUS_WAIT:
        .BYTE "COLLISION WAIT", $00
STATUS_HIT:
        .BYTE "COLLISION HIT", $00
LEGEND_TEXT:
        .BYTE "R SHIP  G TARGET", $00
LEGEND2_TEXT:
        .BYTE "Y BULLET MOVES", $00
REGISTER_TEXT:
        .BYTE "M0 00 P0 00 P1 00", $00

; One 20-column mode-7 screen with a DLI on the final row of every frame.
.ORG $3000
DISPLAY_LIST:
        .BYTE $70, $70, $70
        .BYTE $47, <SCREEN, >SCREEN
        .REPT 11
        .BYTE $07
        .ENDR
        .BYTE $87
        .BYTE $41, <DISPLAY_LIST, >DISPLAY_LIST

; PMBASE=$40, one-line PMG resolution. The first three 256-byte sections are
; unused, followed by the shared missile section and players 0 through 3.
.ORG $4000
        .REPT 768
        .BYTE $00
        .ENDR
        ; Missile 0 is the red bullet; all four missiles form simple markers.
        .REPT 120
        .BYTE $00
        .ENDR
        .REPT 40
        .BYTE $FF
        .ENDR
        .REPT 96
        .BYTE $00
        .ENDR
        ; Player 0: red ship bar.
        .REPT 120
        .BYTE $00
        .ENDR
        .REPT 40
        .BYTE $FF
        .ENDR
        .REPT 96
        .BYTE $00
        .ENDR
        ; Player 1: green target bar.
        .REPT 120
        .BYTE $00
        .ENDR
        .REPT 40
        .BYTE $FF
        .ENDR
        .REPT 96
        .BYTE $00
        .ENDR
        ; Player 2: blue marker bar.
        .REPT 120
        .BYTE $00
        .ENDR
        .REPT 40
        .BYTE $FF
        .ENDR
        .REPT 96
        .BYTE $00
        .ENDR
        ; Player 3: magenta marker bar.
        .REPT 120
        .BYTE $00
        .ENDR
        .REPT 40
        .BYTE $FF
        .ENDR
        .REPT 96
        .BYTE $00
        .ENDR

.ORG $5000
SCREEN:
        .REPT 960
        .BYTE $00
        .ENDR

.RUN START
