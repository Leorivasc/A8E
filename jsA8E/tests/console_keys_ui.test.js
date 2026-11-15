/* global __dirname, clearTimeout, console, process, require, setTimeout */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FakeClassList {
  constructor() { this.set = new Set(); }
  add(name) { this.set.add(name); }
  remove(name) { this.set.delete(name); }
  contains(name) { return this.set.has(name); }
  toggle(name, on) { if (on) this.set.add(name); else this.set.delete(name); }
}

class FakeElement {
  constructor(attrs) {
    this.attrs = attrs || {};
    this.classList = new FakeClassList();
    this.listeners = {};
    this.hovered = false;
  }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  matches(selector) { return selector === ":hover" && this.hovered; }
  closest(selector) { return selector === ".consoleKey" && this.attrs["data-code"] ? this : null; }
  setPointerCapture() {}
  dispatch(type, event) { this.listeners[type](Object.assign({ pointerId: 1, pointerType: "mouse", target: this, preventDefault() {} }, event)); }
}

function main() {
  const source = fs.readFileSync(path.join(__dirname, "..", "js", "app", "console_keys_ui.js"), "utf8");
  const context = { window: {}, setTimeout, clearTimeout };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "console_keys_ui.js" });

  const events = [];
  const app = {
    onKeyDown(e) { events.push(["down", e.code, e.sdlSym]); },
    onKeyUp(e) { events.push(["up", e.code, e.sdlSym]); },
  };
  const zone = new FakeElement();
  const start = new FakeElement({ "data-key": "F4", "data-code": "F4", "data-sdl": "285" });
  let focused = 0;
  context.window.A8EConsoleKeysUI.init({ app, zone, focusCanvas() { focused++; } });

  // Hidden by default: a press on a hidden bar does nothing but focus the canvas.
  assert.equal(zone.classList.contains("visible"), false);
  zone.dispatch("pointerdown", { target: start });
  assert.deepEqual(events, []);
  assert.equal(focused, 1);

  // Hover reveals the bar, leaving hides it.
  zone.dispatch("pointerenter", {});
  assert.equal(zone.classList.contains("visible"), true);
  zone.dispatch("pointerleave", {});
  assert.equal(zone.classList.contains("visible"), false);

  // Press and release: the key is held while pressed, with the orange class.
  zone.dispatch("pointerenter", {});
  zone.dispatch("pointerdown", { target: start });
  assert.deepEqual(events, [["down", "F4", 285]]);
  assert.equal(start.classList.contains("pressed"), true);
  zone.dispatch("pointerleave", {});
  assert.equal(zone.classList.contains("visible"), true, "stays visible while a key is held");
  zone.dispatch("pointerup", {});
  assert.deepEqual(events, [["down", "F4", 285], ["up", "F4", 285]]);
  assert.equal(start.classList.contains("pressed"), false);
  assert.equal(zone.classList.contains("visible"), false, "hides once released outside the bar");

  // Touch: a tap reveals the bar without pressing a key on a hidden bar.
  events.length = 0;
  zone.dispatch("pointerdown", { target: zone, pointerType: "touch", pointerId: 2 });
  assert.equal(zone.classList.contains("visible"), true);
  assert.deepEqual(events, []);

  // A touch on a button of the still-hidden bar only reveals it.
  zone.classList.remove("visible");
  zone.dispatch("pointerdown", { target: start, pointerType: "touch", pointerId: 3 });
  assert.equal(zone.classList.contains("visible"), true);
  assert.deepEqual(events, []);
  zone.dispatch("pointerdown", { target: start, pointerType: "touch", pointerId: 3 });
  assert.deepEqual(events, [["down", "F4", 285]]);
  zone.dispatch("pointerup", { pointerType: "touch", pointerId: 3 });

  console.log("console_keys_ui.test.js passed");
  process.exit(0);
}

main();
