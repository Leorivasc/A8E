/* global __dirname, console, require */

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = { window: {}, console: console };
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "..", "js/app/gamepad.js"), "utf8"),
  context,
  { filename: "js/app/gamepad.js" },
);
const gamepad = {
  // Copy results out of the vm context so deepStrictEqual sees plain objects.
  readJoystickState: function (pads) {
    return { ...context.window.A8EGamepad.readJoystickState(pads) };
  },
  createPoller: context.window.A8EGamepad.createPoller,
};

function pad(options) {
  const buttons = [];
  for (let i = 0; i < 16; i++) buttons.push({ pressed: false, value: 0 });
  for (const index of options.pressed || []) buttons[index] = { pressed: true, value: 1 };
  return { connected: true, axes: options.axes || [0, 0, 0, 0], buttons: buttons };
}

const released = { up: false, down: false, left: false, right: false, fire: false };

// Nothing connected, or an idle pad, reports no input.
assert.deepEqual(gamepad.readJoystickState([]), released);
assert.deepEqual(gamepad.readJoystickState([null, null]), released);
assert.deepEqual(gamepad.readJoystickState([pad({})]), released);

// Left stick axes, with a dead zone.
assert.deepEqual(
  gamepad.readJoystickState([pad({ axes: [-1, -1] })]),
  { up: true, down: false, left: true, right: false, fire: false },
);
assert.deepEqual(
  gamepad.readJoystickState([pad({ axes: [1, 1] })]),
  { up: false, down: true, left: false, right: true, fire: false },
);
assert.deepEqual(gamepad.readJoystickState([pad({ axes: [0.3, -0.4] })]), released);

// D-pad buttons and the face buttons.
assert.deepEqual(
  gamepad.readJoystickState([pad({ pressed: [12, 15] })]),
  { up: true, down: false, left: false, right: true, fire: false },
);
assert.deepEqual(
  gamepad.readJoystickState([pad({ pressed: [13, 14] })]),
  { up: false, down: true, left: true, right: false, fire: false },
);
for (const button of [0, 1, 2, 3]) {
  assert.equal(gamepad.readJoystickState([pad({ pressed: [button] })]).fire, true);
}
assert.equal(gamepad.readJoystickState([pad({ pressed: [4, 5, 9] })]).fire, false);

// Analog triggers count by value even when `pressed` is not set.
const analog = pad({});
analog.buttons[0] = { pressed: false, value: 0.9 };
assert.equal(gamepad.readJoystickState([analog]).fire, true);

// Opposite directions cancel, a disconnected pad is ignored, pads are merged.
assert.deepEqual(gamepad.readJoystickState([pad({ pressed: [12, 13, 14, 15] })]), released);
const gone = pad({ pressed: [0], axes: [1, 0] });
gone.connected = false;
assert.deepEqual(gamepad.readJoystickState([gone]), released);
assert.deepEqual(
  gamepad.readJoystickState([pad({ pressed: [12] }), pad({ pressed: [0] })]),
  { up: true, down: false, left: false, right: false, fire: true },
);

// Poller: reports only changes, keeps running while a pad is connected, and
// sends a final release when the pad disappears.
let pads = [pad({})];
const frames = [];
const changes = [];
const poller = gamepad.createPoller({
  getGamepads: function () { return pads; },
  onChange: function (state) { changes.push({ ...state }); },
  requestFrame: function (callback) { frames.push(callback); },
});
function step() {
  const callback = frames.shift();
  assert.ok(callback, "poller should have a frame queued");
  callback();
}
assert.equal(poller.isRunning(), false);
poller.start();
poller.start(); // starting twice must not queue a second loop
assert.equal(frames.length, 1);
assert.equal(poller.isRunning(), true);

step(); // idle pad: no change, keeps polling
assert.equal(changes.length, 0);
pads = [pad({ pressed: [0], axes: [-1, 0] })];
step();
step(); // unchanged state is not reported twice
assert.equal(changes.length, 1);
assert.deepEqual(changes[0], { up: false, down: false, left: true, right: false, fire: true });
pads = [pad({})];
step();
assert.equal(changes.length, 2);
assert.deepEqual(changes[1], released);

pads = [pad({ pressed: [14] })];
step();
assert.equal(changes.length, 3);
pads = [null]; // unplugged while a direction was held
step();
assert.equal(changes.length, 4);
assert.deepEqual(changes[3], released, "unplugging must release held inputs");
assert.equal(poller.isRunning(), false);
assert.equal(frames.length, 0, "no frame is queued once no pad is connected");

// It can be started again by a later gamepadconnected event.
pads = [pad({})];
poller.start();
assert.equal(frames.length, 1);

console.log("gamepad_mapping: all tests passed.");
