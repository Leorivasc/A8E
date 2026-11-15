(function () {
  "use strict";

  // Fade-out delay after a touch, since touch screens have no hover/leave.
  const TOUCH_HIDE_MS = 3000;

  function init(opts) {
    const config = opts && typeof opts === "object" ? opts : {};
    const app = config.app;
    const zone = config.zone;
    if (!app || !zone || typeof app.onKeyDown !== "function") return;
    if (zone.__a8eConsoleKeysInitialized) return;
    zone.__a8eConsoleKeysInitialized = true;

    const focusCanvas = typeof config.focusCanvas === "function" ? config.focusCanvas : function () {};
    const held = new Map(); // pointerId -> { button, event }
    let hideTimer = 0;

    function setVisible(visible) {
      zone.classList.toggle("visible", visible);
    }

    function keyEvent(button) {
      return {
        key: button.getAttribute("data-key"),
        code: button.getAttribute("data-code") || "",
        sdlSym: parseInt(button.getAttribute("data-sdl"), 10),
        sourceToken: "consolekey:" + button.getAttribute("data-code"),
        ctrlKey: false,
        shiftKey: false,
      };
    }

    function release(pointerId) {
      const state = held.get(pointerId);
      if (!state) return;
      held.delete(pointerId);
      state.button.classList.remove("pressed");
      app.onKeyUp(state.event);
    }

    zone.addEventListener("pointerenter", function (e) {
      if (e.pointerType === "touch") return;
      clearTimeout(hideTimer);
      setVisible(true);
    });
    zone.addEventListener("pointerleave", function (e) {
      if (e.pointerType === "touch") return;
      if (held.size === 0) setVisible(false);
    });

    zone.addEventListener("pointerdown", function (e) {
      const button = e.target.closest ? e.target.closest(".consoleKey") : null;
      const wasVisible = zone.classList.contains("visible");
      if (e.pointerType === "touch") {
        // A touch first reveals the bar; a touch on a button also presses it.
        clearTimeout(hideTimer);
        setVisible(true);
        hideTimer = setTimeout(function () {
          if (held.size === 0) setVisible(false);
        }, TOUCH_HIDE_MS);
      }
      if (!button || !wasVisible) {
        focusCanvas();
        return;
      }
      e.preventDefault();
      if (button.setPointerCapture) {
        try {
          button.setPointerCapture(e.pointerId);
        } catch {
          // ignore capture errors
        }
      }
      release(e.pointerId);
      const event = keyEvent(button);
      held.set(e.pointerId, { button: button, event: event });
      button.classList.add("pressed");
      app.onKeyDown(event);
      focusCanvas();
    });

    function onPointerEnd(e) {
      release(e.pointerId);
      if (e.pointerType !== "touch" && held.size === 0 && !zone.matches(":hover")) {
        setVisible(false);
      }
    }
    zone.addEventListener("pointerup", onPointerEnd);
    zone.addEventListener("pointercancel", onPointerEnd);
    zone.addEventListener("lostpointercapture", onPointerEnd);
  }

  window.A8EConsoleKeysUI = { init: init };
})();
