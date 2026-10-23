const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = {
  window: {},
  console: console,
};
vm.createContext(context);
for (const file of ["js/core/keys.js", "js/core/input.js"]) {
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", file), "utf8"),
    context,
    { filename: file },
  );
}

const keys = context.window.A8EKeys.createApi();
assert.equal(
  keys.browserKeyToSdlSym({ key: "Control", code: "ControlLeft" }),
  306,
);
assert.equal(
  keys.browserKeyToSdlSym({ key: "Control", code: "ControlRight" }),
  307,
);

const IO_PORTA = 0xd300;
const IO_GRAFP3_TRIG0 = 0xd010;
const IO_GRAFM_TRIG1 = 0xd011;
const IO_COLPM0_TRIG2 = 0xd012;
const IO_COLPM1_TRIG3 = 0xd013;
const IO_GRACTL = 0xd01d;
const IO_CONSOL = 0xd01f;
const IO_IRQEN_IRQST = 0xd20e;
const IO_SKCTL_SKSTAT = 0xd20f;
const IO_STIMER_KBCODE = 0xd209;

const ctx = {
  ram: new Uint8Array(0x10000),
  sram: new Uint8Array(0x10000),
  ioData: {
    keyPressCounter: 0,
    trigPhysical: [1, 1, 1, 0],
    trigLatched: [1, 1, 1, 0],
  },
};
ctx.ram[IO_PORTA] = 0x0f;
ctx.ram[IO_GRAFP3_TRIG0] = 1;
ctx.ram[IO_COLPM0_TRIG2] = 1;
ctx.ram[IO_COLPM1_TRIG3] = 0;
const runtime = context.window.A8EInput.createApi({
  CPU: { irq: function () {}, reset: function () {} },
  IO_PORTA,
  IO_GRAFP3_TRIG0,
  IO_GRAFM_TRIG1,
  IO_COLPM0_TRIG2,
  IO_COLPM1_TRIG3,
  IO_GRACTL,
  IO_CONSOL,
  IO_IRQEN_IRQST,
  IO_SKCTL_SKSTAT,
  IO_STIMER_KBCODE,
  IRQ_OTHER_KEY_PRESSED: 0x40,
  IRQ_BREAK_KEY_PRESSED: 0x80,
  KEY_CODE_TABLE: keys.KEY_CODE_TABLE,
  browserKeyToSdlSym: keys.browserKeyToSdlSym,
}).createRuntime({
  machine: { ctx },
  isReady: function () { return true; },
});

const leftControl = { key: "Control", code: "ControlLeft", sourceToken: "test:left" };
runtime.onKeyDown(leftControl);
assert.equal(ctx.ram[IO_GRAFP3_TRIG0], 0, "left Control did not press TRIG0");
runtime.onKeyUp(leftControl);
assert.equal(ctx.ram[IO_GRAFP3_TRIG0], 1, "left Control did not release TRIG0");

const rightControl = { key: "Control", code: "ControlRight", sourceToken: "test:right" };
runtime.onKeyDown(rightControl);
assert.equal(ctx.ram[IO_COLPM0_TRIG2], 0, "right Control did not press TRIG2");
runtime.onKeyUp(rightControl);
assert.equal(ctx.ram[IO_COLPM0_TRIG2], 1, "right Control did not release TRIG2");

const leftAlt = { key: "Alt", code: "AltLeft", sourceToken: "test:alt" };
runtime.onKeyDown(leftAlt);
runtime.onKeyUp(leftAlt);
assert.equal(ctx.ram[IO_GRAFP3_TRIG0], 1, "left Alt still acted as TRIG0");
assert.equal(ctx.ram[IO_COLPM0_TRIG2], 1, "left Alt acted as TRIG2");

const physicalShift = {
  key: "Shift",
  code: "ShiftLeft",
  sourceToken: "test:shift",
};
runtime.onKeyDown(physicalShift);

const shiftedUp = {
  key: "ArrowUp",
  code: "ArrowUp",
  shiftKey: true,
  sourceToken: "test:shift-up",
};
runtime.onKeyDown(shiftedUp);
assert.equal(ctx.ram[IO_PORTA] & 0x01, 0x01, "Shift+Up acted as joystick up");
assert.equal(ctx.ram[IO_STIMER_KBCODE], 14 | 0x80, "Shift+Up did not send Atari Ctrl+-");
assert.equal(ctx.ioData.keyPressCounter, 1, "Shift+Up did not press a keyboard key");
assert.notEqual(ctx.ram[IO_SKCTL_SKSTAT] & 0x08, 0, "Shift+Up left Atari Shift active");
runtime.onKeyUp({
  key: "ArrowUp",
  code: "ArrowUp",
  shiftKey: false,
  sourceToken: "test:shift-up",
});
assert.equal(ctx.ioData.keyPressCounter, 0, "Shift+Up left the keyboard key pressed");
assert.notEqual(ctx.ram[IO_SKCTL_SKSTAT] & 0x04, 0, "Shift+Up did not release SKSTAT");
assert.equal(ctx.ram[IO_SKCTL_SKSTAT] & 0x08, 0, "Shift did not resume after Shift+Up");
runtime.onKeyUp(physicalShift);
assert.notEqual(ctx.ram[IO_SKCTL_SKSTAT] & 0x08, 0, "Shift did not release after Shift+Up");

const plainUp = { key: "ArrowUp", code: "ArrowUp", sourceToken: "test:plain-up" };
runtime.onKeyDown(plainUp);
assert.equal(ctx.ram[IO_PORTA] & 0x01, 0, "plain Up did not press joystick up");
assert.equal(ctx.ioData.keyPressCounter, 0, "plain Up pressed the keyboard");
runtime.onKeyUp(plainUp);
assert.equal(ctx.ram[IO_PORTA] & 0x01, 0x01, "plain Up did not release joystick up");

console.log("joystick_trigger_mapping.test.js passed");
