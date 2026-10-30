; GTIA mode-10 baseline for ANTIC mode-4 two-bit lores character data.
; VIDEO_CONTROL stays off, isolating the documented GTIA source output.
.define GTIA_MODE $80
.define VBXE_VIDEO $00
.include "VBXE_ATTRMAP_REVERSE_LORES_CHAR_TEST.asm"
