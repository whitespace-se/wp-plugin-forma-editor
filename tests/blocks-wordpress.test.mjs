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
    const tick = async () => {
      await new Promise((r) => setTimeout(r, 80));
    };
    try {
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
      const sent = [];
      const host = { postMessage: (message) => sent.push(message) };
      Object.defineProperty(w, "parent", { value: host });
      for (const script of manifest) {
        for (const code of script.before) w.eval(code);
        let path = script.path;
        if (!existsSync(path)) {
          if (script.handle === "forma-blocks")
            path = new URL("../build/blocks.js", import.meta.url);
          else path = join(process.env.FORMA_TEST_WP, path);
        }
        w.eval(readFileSync(path, "utf8"));
        for (const code of script.after) w.eval(code);
      }
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
    } finally {
      w.close();
    }
  },
);
