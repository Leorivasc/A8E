; GTIA mode-10 lores Rev probe with color-table index 1 fixed to bright blue.
; `$1B` supplies nibbles 1 and 11 if this combination consumes raw hires bits.
.define GTIA_MODE $80
.define M10_COLOR1 $2E
.include "VBXE_ATTRMAP_REVERSE_LORES_CHAR_TEST.asm"
