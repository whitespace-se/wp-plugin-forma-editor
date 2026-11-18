import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(
  new URL("../assets/inline-title.js", import.meta.url),
  "utf8",
);
const guard = readFileSync(
  new URL("../assets/preview.js", import.meta.url),
  "utf8",
);

function harness() {
  const window = new EventTarget(),
    document = new EventTarget();
  const sent = [],
    overlays = [];
  class Element extends EventTarget {
    dataset = {};
    attributes = {};
    textContent = "Rendered title";
    contentEditable = "false";
    setAttribute(key, value) {
      this.attributes[key] = value;
    }
    matches() {
      return true;
    }
    focus() {
      if (document.activeElement === this) return;
      document.activeElement = this;
      emit("focusin");
    }
  }
  const title = new Element();
  document.currentScript = {
    dataset: {
      config: JSON.stringify({
        origin: "https://nora.test",
        pageId: 7,
        label: "Redigera sidtitel",
        placeholder: "Skriv sidtitel",
      }),
    },
  };
  document.body = { append: (element) => overlays.push(element) };
  document.querySelectorAll = () => [title];
  document.createElement = () => new Element();
  const parent = {
    postMessage: (data, origin) => sent.push({ ...data, origin }),
  };
  function emit(type, props = {}, target = title) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { composedPath: () => [target, window], ...props });
    window.dispatchEvent(event);
    return event;
  }
  const context = {
    window,
    document,
    parent,
    Element,
    CSS: { supports: () => true },
    crypto,
    setInterval: () => 1,
    clearInterval: () => {},
  };
  vm.runInNewContext(source, context);
  vm.runInNewContext(guard, context);
  document.dispatchEvent(new Event("DOMContentLoaded"));
  const documentId = sent[0].documentId;
  const receive = (data) =>
    emit("message", {
      data: { channel: "forma-title", version: 1, documentId, ...data },
      origin: "https://nora.test",
      source: parent,
    });
  const state = (extra = {}) =>
    receive({
      type: "state",
      pageId: 7,
      postId: 7,
      title: "Working title",
      writable: true,
      busy: false,
      acknowledged: sent.at(-1).sequence,
      ...extra,
    });
  state();
  return { title, window, document, sent, overlays, emit, receive, state };
}

test("inline events bypass the guard while ordinary controls remain blocked", () => {
  const h = harness();
  h.title.focus();
  assert.equal(h.sent.at(-1).type, "begin");
  assert.equal(
    h.emit("beforeinput", { inputType: "insertText" }).defaultPrevented,
    false,
  );
  assert.equal(
    h.emit("beforeinput", { inputType: "insertParagraph" }).defaultPrevented,
    true,
  );
  assert.equal(h.emit("click", {}, {}).defaultPrevented, true);
  assert.equal(h.sent.at(-1).type, "begin");
});

test("input preserves trailing spaces, ignores stale echoes and Escape restores the session start", () => {
  const h = harness();
  h.title.focus();
  h.title.textContent = "Working title plus ";
  h.emit("input");
  assert.equal(h.sent.at(-1).title, "Working title plus ");
  h.state({ title: "Working title plus", acknowledged: 1 });
  assert.equal(h.title.textContent, "Working title plus ");
  h.emit("keydown", { key: "Escape" });
  assert.equal(h.sent.at(-1).type, "end");
  assert.equal(h.sent.at(-1).title, "Working title");
});

test("Enter ends without restarting, Enter again resumes, and Tab remains native", () => {
  const h = harness();
  h.title.focus();
  assert.equal(h.emit("keydown", { key: "Enter" }).defaultPrevented, true);
  assert.equal(h.title.dataset.formaEditing, "false");
  assert.equal(
    h.emit("beforeinput", { inputType: "insertText" }).defaultPrevented,
    true,
  );
  h.emit("keydown", { key: "Enter" });
  assert.equal(h.title.dataset.formaEditing, "true");
  assert.equal(h.emit("keydown", { key: "Tab" }).defaultPrevented, false);
});

test("composition finishes before acknowledging Save and does not publish intermediate characters", () => {
  const h = harness();
  h.title.focus();
  h.emit("compositionstart");
  h.title.textContent = "途中";
  h.emit("input");
  assert.equal(h.sent.at(-1).type, "begin");
  h.receive({ type: "flush", requestId: "save-1" });
  assert.notEqual(h.sent.at(-1).type, "flushed");
  h.title.textContent = "完成";
  h.emit("compositionend");
  assert.equal(h.sent.at(-1).type, "flushed");
  assert.equal(h.sent.at(-1).title, "完成");
});

test("empty titles retain a placeholder without sending it as content; lock loss prevents edits", () => {
  const h = harness();
  h.state({ title: "" });
  assert.equal(h.title.textContent, "");
  assert.equal(h.title.dataset.empty, "true");
  h.title.focus();
  h.receive({ type: "flush", requestId: "empty" });
  assert.equal(h.sent.at(-1).title, "");
  h.state({ writable: false });
  assert.equal(
    h.emit("beforeinput", { inputType: "insertText" }).defaultPrevented,
    true,
  );
  assert.equal(h.title.contentEditable, "false");
});

test("clicking outside or moving focus to the host ends editing", () => {
  const h = harness();
  h.title.focus();
  h.emit("pointerdown", {}, {});
  assert.equal(h.sent.at(-1).type, "end");
  h.emit("click");
  h.window.dispatchEvent(new Event("blur"));
  assert.equal(h.sent.at(-1).type, "end");
});
