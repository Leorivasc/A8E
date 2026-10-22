# AHRM-13 ANTIC Character-Set Test

`AHRM13_ANTIC_CHARSET_TEST.XEX` displays three character-mode sections:

1. The OS character set selected with `CHBASE=$E0`.
2. A custom 1 KiB character set selected with `CHBASE=$50`.
3. The same custom set with `CHACTL=$06`, enabling vertical reflection and
   inversion for character names with bit 7 set.

The custom section displays character IDs `$00` through `$0F` as deterministic
geometric patterns. The third section uses the same IDs with bit 7 set, so the
effect of the character attribute and `CHACTL` can be compared directly.

## Expected output

- The first section shows readable `AHRM13 OS FONT CHBASE` text.
- The second section shows 16 distinct custom patterns without using the OS
  font.
- The third section shows the same patterns vertically reflected and inverted.
- The three sections remain stable and repeat through the `JVB`.
- No section should retain the preceding section's font or `CHACTL` state.

Compare screenshots or video captures on jsA8E, native A8E, Altirra, and PAL/
NTSC hardware. This is an observational test; it does not print a universal
`PASS`.

## AHRM scope and limits

The fixture covers 1 KiB character-set alignment, `CHBASE`, character-name
bit 7, `CHACTL` inversion, and vertical reflection in ANTIC mode 2. The exact
two-cycle `CHBASE` delay and mid-scanline `CHACTL` timing remain covered by the
native and JavaScript cycle probes.
