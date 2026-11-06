; FX 1.26 Attribute Map Rev diagnostic with GTIA mode 9 enabled.
; This isolates Rev's interaction with the separate mode-9 GTIA compositor.
; AHRM defines both mechanisms but not that final combined result.
.define GTIA_MODE $40
.include "VBXE_ATTRMAP_REVERSE_TEST.asm"
