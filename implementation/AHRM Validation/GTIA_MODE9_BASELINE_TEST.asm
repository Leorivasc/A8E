; Mode-9 baseline with the same mode-F $1B source as the Rev probes.
; VBXE is configured but its VIDEO_CONTROL is left off, so this isolates the
; documented GTIA mode-9 luminance output from XDL/attribute-map behavior.
.define GTIA_MODE $40
.define VBXE_VIDEO $00
.include "VBXE_ATTRMAP_REVERSE_TEST.asm"
