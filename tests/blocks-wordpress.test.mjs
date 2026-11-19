import { JSDOM, VirtualConsole } from "jsdom";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

// Runs actual installed core packages, not substitutes for Gutenberg. Browser
// geometry and native observers are simulated; visual acceptance remains separate.
test(
  "installed Gutenberg mounts, edits, flushes and preserves unsupported content",
  { skip: !process.env.FORMA_TEST_MANIFEST, timeout: 20000 },
  async () => {
    const manifest = JSON.parse(
      readFileSync(process.env.FORMA_TEST_MANIFEST, "utf8"),
    );
    const source = readFileSync(process.env.FORMA_TEST_CONTENT, "utf8");
    const errors = [];
    const vc = new VirtualConsole();
    vc.on("jsdomError", (error) => {
      if (!error.message.includes("Not implemented")) errors.push(error);
    });
    vc.on("error", (...args) => errors.push(args.join(" ")));
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="forma-block-content" data-forma-post="21817"><div data-forma-rendered>Serverrenderat original</div><div data-forma-block-mount></div></div></body></html>',
      {
        url: "https://nora-m5.test/",
        runScripts: "outside-only",
        pretendToBeVisual: true,
        virtualConsole: vc,
      },
    );
    const w = dom.window;
    const hostDom = new JSDOM(
      '<!doctype html><div id="forma-block-tools"></div><div id="forma-block-settings"></div>',
      {
        url: "https://nora-m5.test/wp/wp-admin/",
        runScripts: "outside-only",
        pretendToBeVisual: true,
        virtualConsole: vc,
      },
    );
    const host = hostDom.window;
    const tick = async () => {
      await new Promise((r) => setTimeout(r, 80));
    };
    try {
      for (const w of [dom.window, host]) {
        w.matchMedia = () => ({
          matches: false,
          addListener() {},
          removeListener() {},
          addEventListener() {},
          removeEventListener() {},
        });
        w.ResizeObserver = class {
          observe() {}
          unobserve() {}
          disconnect() {}
        };
        w.IntersectionObserver = class {
          observe() {}
          unobserve() {}
          disconnect() {}
        };
        w.requestIdleCallback = (callback) =>
          w.setTimeout(
            () => callback({ timeRemaining: () => 50, didTimeout: false }),
            0,
          );
        w.cancelIdleCallback = w.clearTimeout;
        w.CSS = { supports: () => true, escape: (value) => value };
        w.Range.prototype.getClientRects = () => [];
        w.Range.prototype.getBoundingClientRect = () => ({
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 400,
          bottom: 40,
          width: 400,
          height: 40,
        });
        w.HTMLElement.prototype.scrollIntoView = () => {};
        w.fetch = async () => ({
          ok: true,
          json: async () => [],
          headers: new Headers(),
        });
      }
      const sent = [];
      host.postMessage = (message) => sent.push(message);
      Object.defineProperty(w, "parent", { value: host });
      for (const script of manifest) {
        for (const code of script.before) host.eval(code);
        let path = script.path;
        if (!existsSync(path)) {
          if (script.handle === "forma-blocks")
            path = new URL("../build/blocks.js", import.meta.url);
          else path = join(process.env.FORMA_TEST_WP, path);
        }
        host.eval(readFileSync(path, "utf8"));
        for (const code of script.after) host.eval(code);
      }
      const delivered = new JSDOM(
        readFileSync(process.env.FORMA_TEST_HTML, "utf8"),
      );
      w.eval(
        delivered.window.document.getElementById("forma-block-preview-js-after")
          .textContent,
      );
      delivered.window.close();
      w.eval(
        readFileSync(new URL("../assets/preview.js", import.meta.url), "utf8"),
      );
      await tick();
      const ready = sent.find((m) => m.type === "ready");
      assert.ok(ready, errors.join("\n"));
      const receive = (data) =>
        w.dispatchEvent(
          new w.MessageEvent("message", {
            source: host,
            origin: "https://nora-m5.test",
            data: {
              channel: "forma-content",
              version: 1,
              documentId: ready.documentId,
              ...data,
            },
          }),
        );
      const state = (content) =>
        receive({
          type: "state",
          pageId: 21817,
          postId: 21817,
          content,
          writable: true,
          busy: false,
          acknowledged: sent.at(-1).sequence,
        });
      const area = w.document.getElementById("forma-block-content");
      state(source);
      area.click();
      assert.equal(sent.at(-1).type, "begin");
      receive({ type: "begin" });
      await tick();
      await tick();
      assert.equal(
        w.document.querySelector("[data-forma-rendered]").hidden,
        true,
        errors.join("\n"),
      );
      assert.ok(
        w.document.querySelector('[contenteditable="true"]'),
        errors.join("\n"),
      );
      assert.ok(host.document.querySelector(".forma-block-toolbar"));
      assert.equal(w.document.querySelector(".forma-block-toolbar"), null);
      const clickHost = (text) =>
        [...host.document.querySelectorAll("button")]
          .find((b) => b.textContent === text)
          .click();
      clickHost("Blockinställningar");
      await tick();
      assert.ok(
        host.document.querySelector(
          "#forma-block-settings .forma-block-inspector",
        ),
      );
      assert.equal(w.document.querySelector(".forma-block-inspector"), null);
      const inspectorButton = host.document.querySelector(
        ".forma-block-inspector button",
      );
      assert.ok(inspectorButton);
      inspectorButton.dispatchEvent(
        new host.MouseEvent("pointerdown", { bubbles: true }),
      );
      inspectorButton.focus();
      w.dispatchEvent(new w.Event("blur"));
      await tick();
      assert.equal(
        w.document.querySelector("[data-forma-rendered]").hidden,
        true,
      );
      host.wp.data.dispatch("core/block-editor").clearSelectedBlock();
      await tick();
      receive({ type: "flush", requestId: "back" });
      await tick();
      assert.equal(sent.at(-1).type, "flushed");
      assert.equal(host.document.querySelector(".forma-block-toolbar"), null);
      assert.equal(
        w.document.querySelector("[data-forma-rendered]").hidden,
        false,
      );
      state(source);
      area.click();
      receive({ type: "begin" });
      await tick();
      await tick();
      receive({ type: "flush", requestId: "noop" });
      await tick();
      assert.equal(sent.find((m) => m.requestId === "noop").content, source);
      state(source);
      area.click();
      receive({ type: "begin" });
      await tick();
      await tick();
      const editable = w.document.querySelector('[contenteditable="true"]');
      editable.focus();
      editable.innerHTML = "Ändrat med Gutenberg";
      editable.dispatchEvent(
        new w.InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: "Ändrat med Gutenberg",
        }),
      );
      await tick();
      receive({ type: "flush", requestId: "edited" });
      await tick();
      const updated = sent.find((m) => m.requestId === "edited");
      assert.ok(
        updated?.content.includes("Ändrat med Gutenberg"),
        errors.join("\n"),
      );
      assert.ok(updated.content.includes("<!-- wp:image"));
      assert.ok(updated.content.includes("<!-- wp:list"));
      if (process.env.FORMA_TEST_OUTPUT)
        writeFileSync(process.env.FORMA_TEST_OUTPUT, updated.content);
      state(updated.content);
      area.click();
      receive({ type: "begin" });
      await tick();
      await tick();
      w.document.body.dispatchEvent(
        new w.MouseEvent("pointerdown", { bubbles: true }),
      );
      await tick();
      assert.equal(sent.at(-1).type, "end");
      assert.equal(sent.at(-1).content, updated.content);
      assert.equal(
        w.document.querySelector("[data-forma-rendered]").hidden,
        false,
      );
      state("<!-- wp:shortcode -->[example]<!-- /wp:shortcode -->");
      area.click();
      receive({ type: "begin" });
      await tick();
      assert.equal(
        w.document.querySelector("[data-forma-rendered]").hidden,
        false,
      );
      assert.equal(
        sent.at(-1).content,
        "<!-- wp:shortcode -->[example]<!-- /wp:shortcode -->",
      );
      assert.deepEqual(errors, []);
      state(source);
      area.click();
      receive({ type: "begin" });
      await tick();
      await tick();
      w.dispatchEvent(new w.Event("pagehide"));
      await tick();
      assert.equal(
        host.document.getElementById("forma-block-tools").children.length,
        0,
      );
      assert.equal(
        host.document.getElementById("forma-block-settings").children.length,
        0,
      );
    } finally {
      w.close();
      hostDom.window.close();
    }
  },
);
