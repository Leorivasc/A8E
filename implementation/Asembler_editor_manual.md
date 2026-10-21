# Assembler Editor User Manual

## 1. Introduction

The **Assembler Editor** is a 6502 source editor and assembler integrated into
A8E. It allows you to:

- edit 6502 source code;
- read and save files on the virtual `H:` device (HostFS);
- assemble source code and generate an Atari `.XEX` executable;
- load the executable into `D1:` and run it;
- debug the program with breakpoints and step execution.

The result is an XEX file for the emulated Atari, not a Windows or Linux
executable.

## 2. Preparing a source file

HostFS is a virtual file system inside the emulator. Files in a Windows folder
do not appear automatically in its file list: they must first be copied to
`H:`.

1. Open the **HostFS (H:)** panel.
2. Use **Upload** to select one or more files from Windows, or drag them into
   the HostFS drop area.
3. Use short Atari-compatible names, such as `HELLO.ASM`.
4. Open the **Assembler** panel.

HostFS normalizes names to uppercase Atari 8.3 names. For example,
`my_program.asm` may appear as `MY_PROG.ASM`. The editor recognizes source
files with the `.ASM`, `.S`, `.SRC`, `.TXT`, `.INC`, and `.MAC` extensions.

## 3. User interface

The editor toolbar contains these controls:

- **File / source list**: shows source files available on HostFS.
- **Load selected source from HostFS**: reads the selected file and loads its
  text into the editor. Changing the selected file also loads it automatically.
- **File name**: the name used when saving the source. The initial value is
  `PROGRAM.ASM`.
- **Save source to HostFS**: saves the current editor contents to HostFS.
- **Assemble**: assembles the source and creates an `.XEX` file in HostFS.
- **Run**: saves, assembles, loads the `.XEX` into `D1:`, and starts the Atari.
- **Step**: executes one instruction and pauses again.
- **Step Over**: executes a subroutine call without stepping into it while
  debugging.
- **Continue**: resumes execution until the next breakpoint.

The handle below the editor can be dragged to change its height.

## 4. Basic workflow

### Creating a new program

1. Open **Assembler**.
2. Type or paste the source code.
3. Enter a file name, such as `HELLO.ASM`.
4. Press **Save**.

If the source file does not exist yet, saving creates it in HostFS.

### Loading an existing program

1. Copy the source file to HostFS from the **HostFS** panel.
2. Open **Assembler**.
3. Select the file in the source list.
4. The source is loaded automatically. You can also press **Load** to read it
   explicitly again.

### Assembling and running

1. Save the source file.
2. Press **Assemble** to generate the executable.
3. The executable keeps the source base name and changes the extension to
   `.XEX`. For example, `HELLO.ASM` produces `HELLO.XEX`.
4. Press **Run** to load it into `D1:` and execute it.

The Atari ROMs must be loaded and the emulator must be ready before running the
program.

Keyboard shortcuts:

| Key | Action |
|---|---|
| `Ctrl+S` | Save the source to HostFS |
| `Ctrl+Shift+B` | Assemble and create the `.XEX` |
| `Ctrl+Enter` | Save, assemble, load, and run |

## 5. Basic program structure

A typical program contains:

1. constants and hardware addresses;
2. an `.ORG` directive defining the load address;
3. an entry-point label;
4. 6502 instructions;
5. a `.RUN` directive defining the start address.

```asm
; Minimal program that produces no visible output

.ORG $2000

START:
    NOP
    RTS

.RUN START
```

Comments begin with `;`. Instructions and directives are case-insensitive,
although uppercase instructions and constant names are recommended.

## 6. Example: writing text to the screen

This example obtains the screen address from `SAVMSC`, an Atari system variable
located at `$0058/$0059`, and copies a message there. The message uses
uppercase letters and spaces. Uppercase Atari screen codes are obtained by
subtracting `$20` from ASCII letters; a screen space is code `$00`.

Save it as `HELLO.ASM`:

```asm
; Write HOLA ATARI on the first screen line.

SAVMSC      = $0058       ; Screen start address, low/high bytes.
SCREEN_PTR  = $0080       ; Zero-page pointer used by (SCREEN_PTR),Y.

.ORG $2000                ; Program load address.

START:
    LDA SAVMSC            ; Read the low byte of the screen address.
    STA SCREEN_PTR        ; Store it in the working pointer.
    LDA SAVMSC+1          ; Read the high byte of the screen address.
    STA SCREEN_PTR+1      ; Complete the working pointer.

    LDY #$00              ; Start with the first message character.

COPY_TEXT:
    LDA MESSAGE,Y         ; Read one character from the message.
    BEQ DONE              ; A zero byte marks the end of the message.
    CMP #$20              ; Is this an ASCII space?
    BEQ STORE_SPACE        ; Atari uses screen code $00 for a space.
    SEC                   ; Prepare subtraction without a borrow.
    SBC #$20              ; Convert uppercase ASCII to Atari screen code.
    STA (SCREEN_PTR),Y    ; Write the letter to the screen.
    JMP NEXT_CHAR         ; Continue with the next character.

STORE_SPACE:
    LDA #$00              ; Atari screen code for a blank character.
    STA (SCREEN_PTR),Y    ; Write the blank to the screen.

NEXT_CHAR:
    INY                   ; Advance to the next character.
    BNE COPY_TEXT         ; Repeat while the index does not wrap.

DONE:
    JMP DONE              ; Loop here, hanging the system. Use RTS to return to Basic.

MESSAGE:
    .BYTE $48,$4F,$4C,$41,$20,$41,$54,$41,$52,$49,$00 ; "HOLA ATARI" plus terminator.

.RUN START                ; Define the executable entry point.
```

To try it:

1. Paste the code into the editor.
2. Save it as `HELLO.ASM`.
3. Press **Run**.

The text should remain visible on the first line after the program finishes.

## 7. Example: loop and counter

This example continuously increments a memory counter. It does not display the
value, but it is useful for practicing labels, jumps, and memory access:

```asm
; Increment COUNTER forever.

COUNTER = $0600

.ORG $2000

START:
    LDA #$00              ; Initial counter value.
    STA COUNTER           ; Store the value in memory.

LOOP:
    INC COUNTER           ; Increment the counter.
    JMP LOOP              ; Jump back to the loop.

.RUN START
```

To debug it, click the left gutter beside the `INC COUNTER` line to set a
breakpoint. Then use **Run**, **Step**, or **Continue**.

## 8. Constants, expressions, and data

Constants can be defined with `=` or `EQU`:

```asm
SCREEN      = $4000
SCREEN_END  EQU SCREEN + 959
COLOR       = %00101110

.ORG $2000
    LDA #COLOR
    STA SCREEN
.RUN $2000
```

Common number formats:

- decimal: `42`;
- hexadecimal: `$2A`;
- binary: `%00101010`;
- character or string: `'A'` or `"HELLO"`.

Useful operators include `+`, `-`, `*`, `/`, `&`, `|`, `^`, `<<`, and `>>`.
The `<` and `>` operators extract the low and high bytes respectively:

```asm
TARGET = $3456

.ORG $2000
    LDA #<TARGET          ; A = $56.
    LDX #>TARGET          ; X = $34.
    RTS
.RUN $2000
```

Directives for emitting or reserving data:

```asm
.ORG $3000

BYTES:
    .BYTE $01,$02,$03     ; Three bytes.
    .BYTE "ABC",$00       ; Text and terminator.
    .WORD $1234            ; Little-endian word: $34,$12.
    .DS 16                 ; Reserve 16 bytes.
    .RES 8,$FF             ; Reserve 8 bytes filled with $FF.

.RUN BYTES
```

`.DB` is an alias for `.BYTE`, `.DW` is an alias for `.WORD`, and `.ADDR` is
also an alias for `.WORD`.

## 9. Includes and repetition

Included files must also be present in HostFS. For example, create
`CONSTANT.INC`:

```asm
SCREEN = $4000
```

Then use it from `MAIN.ASM`:

```asm
.INCLUDE "CONSTANT.INC"

.ORG $2000
    LDA #$00
    STA SCREEN
    RTS

.RUN $2000
```

The `.REPT` directive repeats a block:

```asm
.ORG $2000

    .REPT 4
    .BYTE $AA
    .ENDR

.RUN $2000
```

Available preprocessor directives include `.INCLUDE`, `.DEFINE`, `.UNDEF`,
`.IF`, `.IFDEF`, `.IFNDEF`, `.ELSE`, `.ELSEIF`, `.ENDIF`, `.REPT`, `.MACRO`,
and `.ASSERT`.

## 10. Debugging

The debugger works with assembled source code:

1. Assemble the program with **Assemble**, or run it with **Run**.
2. Click the left gutter beside an instruction to set a breakpoint.
3. When execution pauses, use **Step** to execute one instruction.
4. Use **Step Over** to pass over a subroutine call without entering it.
5. Use **Continue** to resume execution until another breakpoint.

The editor shows the address associated with each line after a successful
assembly. Lines that do not generate bytes, such as comments and some
directives, do not always have an executable address.

## 11. Common problems

### The source file does not appear in the list

- Make sure the file was uploaded to the HostFS panel.
- Use a recognized extension: `.ASM`, `.S`, `.SRC`, `.TXT`, `.INC`, or `.MAC`.
- Close and reopen the Assembler panel to refresh the list.

### “Source file not found on HostFS” appears

The selected file no longer exists in the local HostFS copy. Upload it again or
refresh the list.

### The assembler reports an error

Read the message in the error panel. Errors include a line number. Common
causes include:

- forgetting `.ORG`;
- using an undefined label;
- writing a hexadecimal literal without `$`;
- forgetting to close `.REPT` with `.ENDR`;
- leaving an expression incomplete;
- using an unavailable 6502 addressing mode.

### The program assembles but no text appears

Verify that the program writes to a valid screen address, that the message uses
screen-compatible Atari codes, and that `.RUN` points to the entry label. For
programs using Atari memory or devices, consult the relevant hardware
documentation.

### The program does not start

Check that:

- the Atari ROMs are loaded;
- the `.XEX` was created in HostFS;
- the file was loaded into `D1:`;
- `.RUN` points to loaded code;
- the program does not accidentally overwrite system memory.

## 12. Quick reference

```text
HostFS: upload HELLO.ASM
Assembler: select HELLO.ASM
Load: read the source
Save: save changes
Assemble: create HELLO.XEX
Run: load HELLO.XEX into D1: and execute it
```
