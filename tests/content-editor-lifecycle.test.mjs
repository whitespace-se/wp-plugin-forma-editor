import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";
import { transformWithOxc } from "vite";

test(
  "panel handoff flushes code/visual input and tears down before remount",
  { skip: !process.env.FORMA_TEST_WP },
  async () => {
    const dom = new JSDOM('<div id="root"></div>', {
      runScripts: "outside-only",
      pretendToBeVisual: true,
    });
    const w = dom.window;
    try {
      const load = (path) =>
        w.eval(readFileSync(join(process.env.FORMA_TEST_WP, path), "utf8"));
      load("wp-includes/js/jquery/jquery.js");
      w.wp = {};
      load("wp-admin/js/editor.js");
      load("wp-includes/js/dist/vendor/react.js");
      load("wp-includes/js/dist/vendor/react-dom.js");
      w.ResizeObserver = class {
        observe() {}
        disconnect() {}
      };
      const instances = new Map();
      const pending = [];
      w.tinyMCEPreInit = {
        mceInit: { "forma-content": {} },
        qtInit: { "forma-content": {} },
      };
      w.tinymce = {
        get: (id) => instances.get(id),
        init(config) {
          assert.equal(instances.size, 0, "only one panel instance may exist");
          const textarea = w.document.getElementById(config.id);
          const events = new Map();
          const instance = {
            html: textarea.value,
            hidden: false,
            on: (name, fn) => events.set(name, fn),
            getContent() {
              return this.html;
            },
            setContent(value) {
              this.html = value;
            },
            getBody: () => textarea,
            isHidden() {
              return this.hidden;
            },
            setMode() {},
            execCommand() {},
            save() {
              textarea.value = this.html;
            },
            remove() {
              instances.delete(config.id);
            },
          };
          instances.set(config.id, instance);
          config.setup(instance);
          pending.push(() => events.get("init")());
        },
      };
      const compiled = await transformWithOxc(
        readFileSync(
          new URL("../src/editor/ContentEditor.tsx", import.meta.url),
          "utf8",
        ),
        "ContentEditor.tsx",
        { jsx: { runtime: "classic" } },
      );
      w.eval(
        compiled.code
          .replace(
            /import .*? from "react";/,
            "const React = window.React; const {useEffect,useLayoutEffect,useRef,useState} = React;",
          )
          .replace(
            /import .*? from "react-dom";/,
            "const {createPortal} = window.ReactDOM;",
          )
          .replace(
            "export function ContentEditor",
            "window.ContentEditor = function ContentEditor",
          ),
      );
      const root = w.ReactDOM.createRoot(w.document.getElementById("root"));
      const flushRef = { current: null };
      let value = "Original\n\n<!--more-->\nText";
      const mount = () =>
        w.ReactDOM.flushSync(() =>
          root.render(
            w.React.createElement(w.ContentEditor, {
              markup:
                '<div id="wp-forma-content-wrap" class="tmce-active"><div class="wp-editor-tools"></div><textarea id="forma-content"></textarea></div>',
              wpautop: true,
              initialContent: value,
              disabled: false,
              label: "Innehåll",
              errorLabel: "Error",
              onChange: (next) => {
                value = next;
              },
              onLeave() {},
              beforeEnter: () => null,
              flushRef,
            }),
          ),
        );
      const unmount = () => w.ReactDOM.flushSync(() => root.render(null));
      mount();
      pending.shift()();
      const initial = value;
      flushRef.current();
      assert.equal(value, initial, "no-op preserves exact source");
      const first = [...instances.values()][0];
      first.html = "Last visual keystroke";
      flushRef.current();
      unmount();
      assert.equal(value, "Last visual keystroke");
      assert.equal(instances.size, 0);
      assert.equal(w.document.querySelector("textarea"), null);
      mount();
      pending.shift()();
      const second = [...instances.values()][0];
      second.hidden = true;
      w.document.querySelector("textarea").value = "<p>Last code edit</p>";
      flushRef.current();
      unmount();
      assert.equal(value, "<p>Last code edit</p>");
      mount();
      unmount();
      pending.shift()();
      assert.equal(
        instances.size,
        0,
        "late init cannot resurrect an unmounted editor",
      );
      assert.equal(Object.keys(w.tinyMCEPreInit.mceInit).length, 1);
      root.unmount();
    } finally {
      w.close();
    }
  },
);
