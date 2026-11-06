; FX 1.26 AttrMap Rev diagnostic for ANTIC graphics mode A in GTIA 10.
; Mode A emits four scanlines per display-list row.
.define ANTIC_MODE $0A
.define DISPLAY_ROWS 48
.define GTIA_MODE $80
.define GTIA_ENABLED
.include "VBXE_ATTRMAP_REVERSE_LORES_PROBE.asm"
