import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import test from "node:test";

const source = stripTypeScriptTypes(
  readFileSync(
    new URL("../src/editor/PreviewBridge.ts", import.meta.url),
    "utf8",
  ),
  { mode: "transform" },
).replace("export class", "class");
const Bridge = vm.runInNewContext(`${source}\nPreviewBridge`, {
  URL,
  setTimeout,
  clearTimeout,
  crypto,
  Error,
  Promise,
});

function harness() {
  const bridge = new Bridge();
  const sent = [],
    changed = [];
  const frame = {
    src: "https://nora.test/preview",
    contentWindow: {
      postMessage: (data, origin) => sent.push({ ...data, origin }),
    },
  };
  let selected = 0,
    left = 0;
  const state = {
    pageId: 7,
    postId: 7,
    title: "Working title",
    writable: true,
    busy: false,
  };
  const configure = () =>
    bridge.configure({
      state: { ...state },
      change: (value) => changed.push(value),
      select: async () => {
        selected++;
      },
      leave: () => {
        left++;
      },
    });
  bridge.attach(frame);
  configure();
  let sequence = 0;
  const receive = (type, extra = {}, envelope = {}) =>
    bridge.receive({
      origin: "https://nora.test",
      source: frame.contentWindow,
      data: {
        channel: "forma-title",
        version: 1,
        documentId: "document-a",
        sequence: ++sequence,
        type,
        ...extra,
      },
      ...envelope,
    });
  receive("ready", { pageId: 7 });
  return {
    bridge,
    sent,
    changed,
    frame,
    state,
    configure,
    receive,
    selected: () => selected,
    left: () => left,
  };
}

test("handshake supplies host title; unrelated origins, windows and documents cannot edit", () => {
  const h = harness();
  assert.equal(h.sent.at(-1).title, "Working title");
  h.receive("begin");
  h.receive("change", { title: "evil" }, { origin: "https://evil.test" });
  h.receive("change", { title: "evil" }, { source: {} });
  h.receive("change", { title: "old", documentId: "old-document" });
  assert.deepEqual(h.changed, []);
  h.receive("change", { title: "New title " });
  assert.deepEqual(h.changed, ["New title "]);
  h.bridge.disconnect();
});

test("save barrier waits for matching acknowledgement and accepts final input while busy", async () => {
  const h = harness();
  h.receive("begin");
  const promise = h.bridge.flush();
  const requestId = h.sent.at(-1).requestId;
  h.state.busy = true;
  h.configure();
  h.receive("flushed", { title: "Last character!", requestId });
  await promise;
  assert.equal(h.changed.at(-1), "Last character!");
  assert.equal(h.bridge.editing, false);
  h.bridge.disconnect();
});

test("replacing the frame rejects an unacknowledged save instead of publishing stale text", async () => {
  const h = harness();
  const promise = h.bridge.flush();
  h.bridge.attach(null);
  await assert.rejects(promise, /Kontakt/);
  h.receive("change", { title: "stale" });
  assert.deepEqual(h.changed, []);
});

test("module selection cannot write page title into a module queue", async () => {
  const h = harness();
  h.state.postId = 22;
  h.configure();
  h.receive("begin");
  await Promise.resolve();
  assert.equal(h.selected(), 1);
  h.receive("change", { title: "wrong object" });
  assert.deepEqual(h.changed, []);
  h.state.postId = 7;
  h.configure();
  assert.equal(h.sent.at(-1).type, "begin");
  h.bridge.disconnect();
});

test("lock loss prevents input and Escape sends the initial value through the same queue", () => {
  const h = harness();
  h.receive("begin");
  h.receive("change", { title: "Changed" });
  h.receive("end", { title: "Working title", keepFocus: true });
  assert.deepEqual(h.changed, ["Changed", "Working title"]);
  h.state.writable = false;
  h.configure();
  h.receive("change", { title: "after lock loss" });
  assert.equal(h.changed.at(-1), "Working title");
  h.bridge.disconnect();
});
