# AHRM-18 POKEY RANDOM and Timer Test

`AHRM18_POKEY_RANDOM_TIMER_TEST.XEX` resets POKEY initialization, captures
eight `RANDOM` values at fixed scan-line boundaries, then measures the polling
loop until a timer-1 IRQ with `AUDF1=$05`.

## Expected output

- Eight hexadecimal `RANDOM` values appear in the sequence row.
- Repeating the program on the same target produces the same sequence for the
  same PAL/NTSC configuration and startup phase.
- The timer field becomes nonzero and remains stable across repeated runs,
  subject to the normal polling-boundary variation.

The AHRM reference includes the sample short-generator sequence
`00 DF EE 16 B9` for a particular `WSYNC`/read phase. The complete eight-byte
sequence should be recorded rather than reduced to a pass/fail decision.

Compare jsA8E, native A8E, Altirra, and hardware separately for PAL and NTSC.
This test covers digital LFSR reset/read timing and timer IRQ observation; it
does not validate the analogue audio path.
