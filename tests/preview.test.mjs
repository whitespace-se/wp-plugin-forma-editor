import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";

const script = readFileSync(
  new URL("../assets/preview.js", import.meta.url),
  "utf8",
);
class Control {
  matches() {
    return true;
  }
}

function dispatch(type, { control = false, key } = {}) {
  const window = new EventTarget();
  runInNewContext(script, { window, Element: Control });
  let themeCalled = false;
  window.addEventListener(type, () => {
    themeCalled = true;
  });
  const event = new Event(type, { cancelable: true });
  event.composedPath = () => (control ? [new Control(), window] : [window]);
  if (key) Object.defineProperty(event, "key", { value: key });
  window.dispatchEvent(event);
  return { canceled: event.defaultPrevented, themeCalled };
}

test("navigation, submission and edits never reach theme handlers", () => {
  for (const type of [
    "click",
    "auxclick",
    "dblclick",
    "submit",
    "beforeinput",
    "dragstart",
  ]) {
    assert.deepEqual(dispatch(type), { canceled: true, themeCalled: false });
  }
});

test("keyboard activation is blocked on links/buttons, including dynamic controls", () => {
  for (const type of ["keydown", "keyup", "keypress"]) {
    for (const key of ["Enter", " ", "a"]) {
      assert.deepEqual(dispatch(type, { control: true, key }), {
        canceled: true,
        themeCalled: false,
      });
    }
  }
});

test("Tab and page scroll defaults remain available", () => {
  for (const key of ["Tab", "ArrowDown", "PageDown", " "]) {
    assert.deepEqual(dispatch("keydown", { key }), {
      canceled: false,
      themeCalled: false,
    });
  }
  assert.equal(
    dispatch("keydown", { control: true, key: "Tab" }).canceled,
    false,
  );
  for (const type of ["wheel", "touchmove"]) {
    assert.deepEqual(dispatch(type), { canceled: false, themeCalled: true });
  }
});

test("early mouse actions and context menus cannot activate controls", () => {
  for (const type of ["pointerdown", "mousedown", "contextmenu"]) {
    assert.deepEqual(dispatch(type, { control: true }), {
      canceled: true,
      themeCalled: false,
    });
  }
  assert.deepEqual(dispatch("touchstart", { control: true }), {
    canceled: false,
    themeCalled: false,
  });
});
