; FX 1.26 AttrMap Rev diagnostic for ANTIC graphics mode B in GTIA 10.
; Mode B emits two scanlines per display-list row.
.define ANTIC_MODE $0B
.define DISPLAY_ROWS 96
.define GTIA_MODE $80
.define GTIA_ENABLED
.include "VBXE_ATTRMAP_REVERSE_LORES_PROBE.asm"
