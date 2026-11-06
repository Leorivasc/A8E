; FX 1.26 Attribute Map Rev diagnostic for tall hires character mode 3 in GTIA 9.
; Nineteen 10-scanline rows make the active field 190 lines, matching its XDL.
.define GTIA_MODE $40
.define ANTIC_MODE $03
.define DISPLAY_ROWS 19
.define XDL_REPEAT $BD
.include "VBXE_ATTRMAP_REVERSE_CHAR_TEST.asm"
