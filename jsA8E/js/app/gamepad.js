(function () {
  "use strict";

  // Physical gamepad support. Polls the browser Gamepad API and reports the
  // combined state of every connected pad as a joystick: four directions and
  // one fire button. The UI feeds that state to the same joystick path used by
  // the on-screen stick, so the emulator core is not involved.

  const AXIS_THRESHOLD = 0.5;
  // Standard mapping: 12-15 are the d-pad; any face button (0-3) fires.
  const DPAD_UP = 12;
  const DPAD_DOWN = 13;
  const DPAD_LEFT = 14;
  const DPAD_RIGHT = 15;
  const FIRE_BUTTONS = [0, 1, 2, 3];

  function isPressed(buttons, index) {
    const button = buttons && buttons[index];
    return !!button && (button.pressed === true || button.value > 0.5);
  }

  function axisValue(axes, index) {
    const value = axes && axes[index];
    return typeof value === "number" ? value : 0;
  }

  function emptyState() {
    return { up: false, down: false, left: false, right: false, fire: false };
  }

  // Merge one gamepad into `state`. Many plain USB joysticks have no standard
  // mapping and only report axes 0 and 1, which is handled the same way.
  function addGamepad(state, pad) {
    if (!pad || pad.connected === false) return state;
    const buttons = pad.buttons || [];
    const axes = pad.axes || [];
    const x = axisValue(axes, 0);
    const y = axisValue(axes, 1);
    state.up = state.up || y < -AXIS_THRESHOLD || isPressed(buttons, DPAD_UP);
    state.down = state.down || y > AXIS_THRESHOLD || isPressed(buttons, DPAD_DOWN);
    state.left = state.left || x < -AXIS_THRESHOLD || isPressed(buttons, DPAD_LEFT);
    state.right = state.right || x > AXIS_THRESHOLD || isPressed(buttons, DPAD_RIGHT);
    for (const index of FIRE_BUTTONS) {
      if (isPressed(buttons, index)) state.fire = true;
    }
    return state;
  }

  // Combined joystick state for a list of gamepads (null entries are skipped).
  // Opposite directions cancel each other out, as on a real joystick.
  function readJoystickState(pads) {
    const state = emptyState();
    for (const pad of Array.from(pads || [])) addGamepad(state, pad);
    if (state.up && state.down) state.up = state.down = false;
    if (state.left && state.right) state.left = state.right = false;
    return state;
  }

  function sameState(a, b) {
    return (
      a.up === b.up &&
      a.down === b.down &&
      a.left === b.left &&
      a.right === b.right &&
      a.fire === b.fire
    );
  }

  function hasPad(pads) {
    return Array.from(pads || []).some(function (pad) {
      return !!pad && pad.connected !== false;
    });
  }

  // Poll once per animation frame while a pad is connected and call
  // `onChange(state)` only when the joystick state differs from the last one,
  // so an idle pad never overrides the keyboard or the on-screen stick. When
  // the last pad disappears a final all-released state is reported.
  function createPoller(options) {
    const getGamepads = options.getGamepads;
    const onChange = options.onChange;
    const requestFrame = options.requestFrame;
    let last = emptyState();
    let running = false;

    function tick() {
      const pads = getGamepads();
      const state = readJoystickState(pads);
      if (!sameState(state, last)) {
        last = state;
        onChange(state);
      }
      if (hasPad(pads)) {
        requestFrame(tick);
      } else {
        running = false;
      }
    }

    return {
      start: function () {
        if (running) return;
        running = true;
        requestFrame(tick);
      },
      isRunning: function () {
        return running;
      },
    };
  }

  // Browser wiring: start polling when a pad is connected (browsers only
  // expose a pad after its first button press) and also at load, in case one
  // is already visible.
  function install(onChange) {
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
      return null;
    }
    const poller = createPoller({
      getGamepads: function () {
        return navigator.getGamepads();
      },
      onChange: onChange,
      requestFrame: function (callback) {
        window.requestAnimationFrame(callback);
      },
    });
    window.addEventListener("gamepadconnected", poller.start);
    poller.start();
    return poller;
  }

  window.A8EGamepad = {
    readJoystickState: readJoystickState,
    createPoller: createPoller,
    install: install,
  };
})();
