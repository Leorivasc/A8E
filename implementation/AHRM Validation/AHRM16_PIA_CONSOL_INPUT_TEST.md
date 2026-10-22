# AHRM-16 PIA and CONSOL Input Test

`AHRM16_PIA_CONSOL_INPUT_TEST.XEX` continuously displays the raw values of:

- `PORTA` and `PORTB`;
- `PACTL` and `PBCTL`;
- GTIA `CONSOL`;
- `TRIG0` through `TRIG3`.

The program leaves PIA control registers in the normal data-register setting
`$34` and does not write the memory-bank value in `PORTB`.

## Expected output

With no input active, a normal XL/XE setup commonly reports `CONSOL=07` and
`TRIG0`-`TRIG3=01`; the exact idle port values depend on the connected
hardware. Pressing `START`, `SELECT`, or `OPTION` should change the
corresponding active-low `CONSOL` bit. Joystick movement changes the active-low
direction bits in `PORTA`, and joystick buttons change the corresponding
trigger value, normally from 1 to 0.

Compare the live hexadecimal values while exercising each physical control and
the equivalent emulator control. Floating or unused PIA bits must not be
mistaken for a joystick failure; AHRM documents platform-dependent floating
behavior on XL/XE port-B inputs.
