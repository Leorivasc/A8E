# AHRM-12 ANTIC Display-List and Scrolling Test

`AHRM12_ANTIC_DISPLAYLIST_TEST.XEX` is a visual diagnostic for display-list
instruction sequencing and fine scrolling. It contains three repeating
sections:

1. Normal ANTIC mode 2 with an LMS and DLI.
2. Horizontally scrolled mode 2 with `HSCROL` cycling through 0, 4, 8, and
   12.
3. Vertically scrolled mode 3 with `VSCROL=4`.

The display list terminates with `JVB`, and the DLI handler changes the scroll
registers only at section boundaries. Each horizontal-scroll value remains for
16 frames before the next value is selected.

## Expected output

- Three stable labeled sections: `AHRM12 ANTIC LMS JVB`, `HSCROL 0 4 8 C`,
  and `VSCROL 4`.
- The horizontal-scroll pattern moves in four distinct steps without corrupting
  the display list or changing the section order.
- The mode-3 section has stable partial entry/exit lines rather than flicker.
- The complete sequence repeats continuously through `JVB`.

Compare screenshots or video captures on jsA8E, native A8E, Altirra, and PAL/
NTSC hardware. Pay particular attention to the horizontal position of the
pattern, DLI boundaries, and whether a scroll phase changes the following
section. This is an observational test; it does not print a universal `PASS`.

## AHRM scope and limits

The fixture covers LMS, DLI, JVB, mode-line scroll flags, and the visible
effects of HSCROL/VSCROL. It complements AHRM-06. Internal cycle deadlines,
display-list pointer wrap at a 1 KiB boundary, and DMA contention remain the
responsibility of the native and JavaScript timing probes.
