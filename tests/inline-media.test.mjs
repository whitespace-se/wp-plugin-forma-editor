import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import test from "node:test";

function harness() {
  const handlers = {};
  const frame = {
    on: (event, callback) => {
      handlers[event] = callback;
    },
    open() {},
    remove() {},
    state: () => ({
      get: () => ({
        first: () => ({ toJSON: () => ({ id: 1, type: "image" }) }),
      }),
    }),
  };
  const media = Object.assign(() => frame, {
    string: { image: () => '<img src="/a.jpg" class="wp-image-1">' },
  });
  const source = stripTypeScriptTypes(
    readFileSync(
      new URL("../src/editor/inlineMedia.ts", import.meta.url),
      "utf8",
    ),
    { mode: "transform" },
  ).replace("export function", "function");
  const open = vm.runInNewContext(`${source}\ninlineMedia`, {
    window: { wp: { media } },
    Promise,
    setTimeout,
  });
  return { open, handlers };
}
test("WordPress close-before-select ordering preserves the selected image", async () => {
  const h = harness();
  const result = h.open();
  h.handlers.close();
  h.handlers.select();
  assert.match(await result, /wp-image-1/);
});
test("canceling media returns no insertion", async () => {
  const h = harness();
  const result = h.open();
  h.handlers.close();
  assert.equal(await result, null);
});
