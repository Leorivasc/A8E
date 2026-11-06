; FX 1.26 AttrMap Rev diagnostic for ANTIC graphics mode 8 in GTIA 10.
; Mode 8 emits eight scanlines per display-list row.
.define ANTIC_MODE $08
.define DISPLAY_ROWS 24
.define GTIA_MODE $80
.define GTIA_ENABLED
.include "VBXE_ATTRMAP_REVERSE_LORES_PROBE.asm"
