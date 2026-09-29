# Layout Schemes

## Current behavior

`jsA8E` has three selectable presentation layouts. They organize the existing
emulator, disk, filesystem, assembler/debugger, keyboard, and joystick panels
without changing the emulated machine state.

The presentation mode is a UI preference. Switching modes does not reset,
pause, reload, or otherwise interrupt the emulator. It does reset the
presentation state of the virtual keyboard, joystick, and preset panels: those
panels are hidden when a layout is applied and can then be enabled individually
from the toolbar.

The three layouts are registered presets, not a closed list. The layout model
allows additional arrangements to be added later without changing the panel
implementations or rewriting the layout-selection flow.

## Layout Selection

The layout modes are selected with individual compact icon-only buttons in the
primary toolbar, immediately before the secondary-controls expand button:

```text
[Start/Pause] [Reset] [Audio] ... | [Emulation] [Work] [Development] [More]
```

Each layout button:

- shows a clear active state;
- allows changing modes with one click;
- exposes an accessible label and tooltip;
- remains usable while the emulator is running;
- preserves the selected mode in `localStorage`;
- restores the saved mode on the next page load;
- preserve the current panel contents and emulated machine state; panel
  visibility is controlled by the selected preset and toolbar toggles.

The buttons may use compact icon-only presentation at narrow widths, but their
accessible names must remain available through tooltips, ARIA labels, and
`aria-pressed` state.

## Layout Modes

### Emulation

Purpose: normal operation and gameplay.

```text
┌─────────────────────────────────────────────┐
│                                             │
│                  Screen                     │
│                                             │
├─────────────────────────────────────────────┤
│             Keyboard + Joystick              │
└─────────────────────────────────────────────┘
```

Current behavior:

- The emulator screen occupies the complete first row.
- The virtual keyboard and joystick occupy the second row when enabled.
- The keyboard and joystick remain independently hideable when needed.
- Development panels are hidden by the preset. They can be opened manually
  through their existing toolbar actions.

### Work

Purpose: working with disks and files while using the emulator.

```text
┌──────────────────────┬──────────────────────┐
│ Disk Library         │                      │
│ HostFS                │       Screen         │
├──────────────────────┴──────────────────────┤
│             Keyboard + Joystick              │
└─────────────────────────────────────────────┘
```

Current behavior:

- The first row has two columns.
- The first column stacks `Disk Library` and `HostFS`.
- The second column contains the emulator screen.
- The second row contains the virtual keyboard and joystick when those panels
  are enabled.
- Disk Library and HostFS remain independently scrollable when their contents
  exceed the available height.

### Development

Purpose: debugging and developing Atari software.

```text
┌──────────────────────┬──────────────────────┐
│ Debugger             │                      │
│ HostFS               │       Screen         │
│ Disk Library         │                      │
├──────────────────────┴──────────────────────┤
│                 Keyboard                      │
└─────────────────────────────────────────────┘
```

Current behavior:

- The first row has two columns.
- The first column stacks `Debugger`, `HostFS`, and `Disk Library`.
- The second column contains the emulator screen.
- The second row contains the virtual keyboard when it is enabled.
- The joystick is hidden by the preset, but remains available through its
  existing toolbar control.
- The assembler/debugger, HostFS, and Disk Library panels have their own
  scrolling areas; the panels themselves remain stacked in the tools column.

## Disk Activity Indicator

Disk activity must remain visible in every layout and must follow the current
screen position.

The indicator must be positioned relative to the screen container, not to the
page or the global layout grid. This ensures that it remains in the lower-right
corner of the emulator screen when the screen changes size, column, or layout.

Existing activity semantics are preserved:

- yellow indicates disk reads;
- orange indicates disk writes or formats;
- the indicator remains above the canvas and screen contents through its
  dedicated overlay layer;
- worker-originated activity continues to use the existing event path without
  modifying SIO response data or timing.

## Responsive Behavior

The layouts must remain usable on desktop and mobile widths.

Desktop behavior (`>980px`):

- preserve the two-column arrangements described above;
- give the screen priority when horizontal space is limited;
- keep tool panels from forcing the screen below a usable size.

Responsive behavior (`<=980px`):

- collapse two-column layouts into a single vertical flow;
- keep the screen before the lower-priority panels where possible;
- allow panel sections to scroll independently;
- keep the compact layout buttons in the primary toolbar; at widths up to
  `600px`, the toolbar's primary file control may occupy a full row.

The layout change must not alter the existing PAL/NTSC selection, memory
profile, worker selection, ROMs, disks, HostFS files, or emulator lifecycle.

## Persistence

The selected layout is stored using the dedicated key:

```text
a8e_layout_scheme
```

Accepted values:

```text
emulation
work
development
```

Unknown or missing values fall back to `work`, which is the current default
when no saved preference exists.

Additional arrangements may define their own stable identifier and may be
added to the same persisted preference set. If a saved arrangement is no
longer available, the UI falls back to `work`.

## Implementation Direction

The implementation should extend the existing UI structure and shared panel
styles rather than introduce separate copies of panel components.

Likely files:

- `jsA8E/index.html`: layout buttons and layout containers;
- `jsA8E/style.css`: grid, responsive, active-button, and panel sizing rules;
- `jsA8E/js/app/ui.js`: layout selection, persistence, and panel visibility;
- `jsA8E/js/app/disk_activity_ui.js`: verify screen-relative overlay behavior;
- `implementation/jsA8E/UI.md`: keep the implemented UI behavior synchronized
  after layout changes.

The layout controller should use semantic state such as
`data-layout-scheme="emulation"` on the main layout container. CSS grid areas
and a small number of state classes should control presentation; panel logic
should remain owned by the existing panel modules.

New arrangements should be represented as layout definitions or presets that
declare panel placement, visibility, and responsive behavior. They should not
require new copies of `HostFS`, `Disk Library`, `Debugger`, keyboard,
joystick, or screen components.

## Acceptance Criteria

- The toolbar shows compact individual `Emulation`, `Work`, and `Development`
  buttons alongside the primary controls and before the secondary-tools
  expand button.
- Exactly one layout button is active at a time.
- Switching layouts does not reset, pause, reload, or alter the emulator.
- `Emulation` shows the screen above the optional keyboard and joystick.
- `Work` shows Disk Library and HostFS beside the screen on desktop, with the
  optional keyboard and joystick below.
- `Development` shows the assembler/debugger, HostFS, and Disk Library beside
  the screen on desktop, with the optional keyboard below.
- Disk activity remains visible and screen-relative in all three layouts.
- The selected layout survives a page reload.
- A future arrangement can be added by registering a new layout definition and
  selector without changing existing panel ownership or emulator behavior.
- Responsive layouts collapse without clipping the screen or making the
  toolbar unusable.
- Existing panel actions, automation attachment, worker behavior, and disk
  activity timing remain unchanged.

## Non-Goals

- No drag-and-drop panel docking in the first iteration.
- No arbitrary user-defined grid layouts in the first iteration.
- The first iteration only needs to ship the three defined presets; support for
  additional registered arrangements is required, but a custom layout editor
  is out of scope.
- No emulator reset or media remount when changing presentation modes.
- No replacement of the existing panel implementations.
