; AHRM-11 POKEY audio capture diagnostic.
; Plays a deterministic sequence of low-volume tones, noise, linked timers,
; volume-only output, and high-pass filtering. The sequence is intended for
; WAV capture and spectral comparison, not for a guest-side PASS result.

.ORG $2000

DMACTL  = $D400
CHBASE  = $D409
NMIEN   = $D40E
NMIRES  = $D40F
DLISTL  = $D402
DLISTH  = $D403
SDLSTL  = $0230
VDSLST  = $0200

AUDC1   = $D201
AUDF1   = $D200
AUDC2   = $D203
AUDF2   = $D202
AUDC3   = $D205
AUDF3   = $D204
AUDC4   = $D207
AUDF4   = $D206
AUDCTL  = $D208
STIMER  = $D209
SKCTL   = $D20F

SRC_LO  = $80
SRC_HI  = $81
DST_LO  = $82
DST_HI  = $83
PHASE_TICKS = $2FF0
PHASE_INDEX = $2FF1

START:
        SEI
        LDA #$00
        STA NMIEN
        STA PHASE_TICKS
        STA PHASE_INDEX
        LDA #$E0
        STA CHBASE
        LDA #$22
        STA DMACTL
        LDA #$00
        STA AUDC1
        STA AUDC2
        STA AUDC3
        STA AUDC4
        LDA #$03
        STA SKCTL
        JSR SET_AUDIO

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
        JSR DRAW_LABELS
        LDA #$C0
        STA NMIEN

WAIT:
        JMP WAIT

; Keep each waveform active for 64 frames. The active phase number is shown
; in the status row so an audio capture can be aligned with the video.
DLI_HANDLER:
        PHA
        TXA
        PHA
        LDA PHASE_TICKS
        CLC
        ADC #$01
        STA PHASE_TICKS
        CMP #$40
        BCC DLI_STATUS
        LDA #$00
        STA PHASE_TICKS
        INC PHASE_INDEX
        LDA PHASE_INDEX
        CMP #$06
        BCC DLI_NEW_PHASE
        LDA #$00
        STA PHASE_INDEX
DLI_NEW_PHASE:
        JSR SET_AUDIO
DLI_STATUS:
        LDA PHASE_INDEX
        CLC
        ADC #$10
        LDY #$00
        STA SCREEN + 96,Y
        LDA #$80
        STA NMIRES
        PLA
        TAX
        PLA
        RTI

SET_AUDIO:
        LDX PHASE_INDEX
        CPX #$00
        BEQ AUDIO_SQUARE
        CPX #$01
        BEQ AUDIO_POLY4
        CPX #$02
        BEQ AUDIO_POLY9
        CPX #$03
        BEQ AUDIO_LINKED
        CPX #$04
        BNE AUDIO_HIGHPASS
        JMP AUDIO_VOLUME

; Phase 5: channel 1 uses a high-pass source on channel 3.
AUDIO_HIGHPASS:
        LDA #$04
        STA AUDCTL
        LDA #$3B
        STA AUDF1
        LDA #$AA
        STA AUDC1
        LDA #$3C
        STA AUDF3
        LDA #$00
        STA AUDC3
        STA AUDC2
        STA AUDC4
        STA AUDF2
        STA AUDF4
        STA STIMER
        RTS

AUDIO_SQUARE:
        LDA #$00
        STA AUDCTL
        LDA #$40
        STA AUDF1
        LDA #$AA
        STA AUDC1
        JSR MUTE_OTHER_CHANNELS
        RTS

AUDIO_POLY4:
        LDA #$00
        STA AUDCTL
        LDA #$20
        STA AUDF1
        LDA #$C8
        STA AUDC1
        JSR MUTE_OTHER_CHANNELS
        RTS

AUDIO_POLY9:
        LDA #$00
        STA AUDCTL
        LDA #$31
        STA AUDF1
        LDA #$88
        STA AUDC1
        JSR MUTE_OTHER_CHANNELS
        RTS

AUDIO_LINKED:
        LDA #$50
        STA AUDCTL
        LDA #$20
        STA AUDF1
        LDA #$01
        STA AUDF2
        LDA #$00
        STA AUDC1
        LDA #$AA
        STA AUDC2
        LDA #$00
        STA AUDC3
        STA AUDC4
        STA AUDF3
        STA AUDF4
        STA STIMER
        RTS

AUDIO_VOLUME:
        LDA #$00
        STA AUDCTL
        LDA #$18
        STA AUDC1
        LDA #$00
        STA AUDC2
        STA AUDC3
        STA AUDC4
        STA AUDF1
        STA AUDF2
        STA AUDF3
        STA AUDF4
        STA STIMER
        RTS

MUTE_OTHER_CHANNELS:
        LDA #$00
        STA AUDC2
        STA AUDC3
        STA AUDC4
        STA AUDF2
        STA AUDF3
        STA AUDF4
        STA STIMER
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
        LDA #<PHASE_TEXT
        STA SRC_LO
        LDA #>PHASE_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 40)
        STA DST_LO
        LDA #>(SCREEN + 40)
        STA DST_HI
        JSR DRAW_TEXT
        LDA #<DETAIL_TEXT
        STA SRC_LO
        LDA #>DETAIL_TEXT
        STA SRC_HI
        LDA #<(SCREEN + 80)
        STA DST_LO
        LDA #>(SCREEN + 80)
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

TITLE_TEXT:
        .BYTE "AHRM11 POKEY AUDIO CAPTURE", $00
PHASE_TEXT:
        .BYTE "PHASE NUMBER IS SHOWN AT COLUMN 16", $00
DETAIL_TEXT:
        .BYTE "64 FRAMES EACH: SQUARE POLY4 POLY9 LINK VOL HP", $00

.ORG $3000
DISPLAY_LIST:
        .BYTE $70, $70, $70
        .BYTE $42, <SCREEN, >SCREEN
        .REPT 23
        .BYTE $02
        .ENDR
        .BYTE $82
        .BYTE $41, <DISPLAY_LIST, >DISPLAY_LIST

.ORG $4000
SCREEN:
        .REPT 960
        .BYTE $00
        .ENDR

.RUN START
