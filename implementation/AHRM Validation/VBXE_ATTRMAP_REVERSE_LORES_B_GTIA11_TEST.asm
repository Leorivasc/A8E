; FX 1.26 AttrMap Rev diagnostic for ANTIC graphics mode B in GTIA 11.
; This is an external differential probe; do not infer its result from mode C-E.
.define ANTIC_MODE $0B
.define DISPLAY_ROWS 96
.define GTIA_MODE $C0
.define GTIA_ENABLED
.include "VBXE_ATTRMAP_REVERSE_LORES_PROBE.asm"
