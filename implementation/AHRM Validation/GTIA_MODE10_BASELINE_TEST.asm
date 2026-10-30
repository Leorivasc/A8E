; Mode-10 baseline with the mode-F $1B source used by the Rev probes.
; This isolates AHRM's raw-nibble GTIA color selection before VBXE composition.
.define GTIA_MODE $80
.define COLBK_COLOR $0E
.define VBXE_VIDEO $00
.include "VBXE_ATTRMAP_REVERSE_TEST.asm"
