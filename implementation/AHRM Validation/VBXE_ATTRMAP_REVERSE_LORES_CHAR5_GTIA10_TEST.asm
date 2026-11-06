; FX 1.26 AttrMap Rev diagnostic for tall lores character mode 5 in GTIA 10.
; Twelve 16-scanline rows retain a 192-line active field.
.define GTIA_MODE $80
.define ANTIC_MODE $05
.define DISPLAY_ROWS 12
.include "VBXE_ATTRMAP_REVERSE_LORES_CHAR_TEST.asm"
