import { JSDOM } from "jsdom";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

// Optional local integration: executes the installed WordPress/TinyMCE code
// in a DOM, without a browser or network. Layout/dialog UX still needs review.
test(
  "installed TinyMCE preserves the representative source before editing",
  { skip: !process.env.FORMA_TEST_WP, timeout: 15000 },
  async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="content"></div><div id="toolbar"></div></body></html>',
      {
        url: "https://nora-m5.test",
        runScripts: "outside-only",
        pretendToBeVisual: true,
      },
    );
    const w = dom.window;
    try {
      w.matchMedia = () => ({
        matches: false,
        addListener() {},
        removeListener() {},
      });
      w.Range.prototype.getClientRects = () => [];
      w.Range.prototype.getBoundingClientRect = () => ({
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
      });
      const load = (path) =>
        w.eval(readFileSync(join(process.env.FORMA_TEST_WP, path), "utf8"));
      load("wp-includes/js/jquery/jquery.js");
      load("wp-includes/js/utils.js");
      w.wp = {};
      load("wp-admin/js/editor.js");
      load("wp-includes/js/tinymce/tinymce.min.js");
      load("wp-includes/js/tinymce/themes/modern/theme.js");
      for (const plugin of ["wordpress", "lists", "paste", "link", "image"])
        load(`wp-includes/js/tinymce/plugins/${plugin}/plugin.js`);
      w.eval(
        readFileSync(
          new URL("../assets/inline-content-policy.js", import.meta.url),
          "utf8",
        ),
      );
      const source = process.env.FORMA_TEST_CONTENT
        ? readFileSync(process.env.FORMA_TEST_CONTENT, "utf8")
        : 'Ingress\r\n\r\n<!--more-->\r\n<h2>Rubrik</h2><p><a href="/test" target="_blank" rel="noopener">Länk</a></p><img src="/image.webp" alt="Bild" width="320" height="180" class="alignnone wp-image-1">';
      assert.equal(w.formaContentPolicy.safe(source), true);
      const editor = await new Promise((resolve) =>
        w.tinymce.init({
          selector: "#content",
          inline: true,
          skin: false,
          theme: "modern",
          fixed_toolbar_container: "#toolbar",
          plugins: "wordpress,lists,paste,link,image",
          wpautop: true,
          convert_urls: false,
          init_instance_callback: resolve,
        }),
      );
      editor.setContent(source, { load: true });
      const serialized = editor.getContent();
      assert.equal(w.formaContentPolicy.safe(serialized), true, serialized);
      assert.equal(
        w.formaContentPolicy.signature(serialized),
        w.formaContentPolicy.signature(w.wp.editor.autop(source)),
      );
      editor.remove();
      w.document.body.innerHTML =
        '<article id="article"><div id="forma-inline-content" data-forma-post="7"><p class="lead">Theme-generated content</p></div></article>';
      const sent = [];
      const host = { postMessage: (data) => sent.push(data) };
      Object.defineProperty(w, "parent", { value: host });
      w.CSS = { supports: () => true };
      w.ResizeObserver = class {
        observe() {}
      };
      w.IntersectionObserver = class {
        observe() {}
      };
      w.wp.editor.getDefaultSettings = () => ({
        tinymce: { theme: "modern", skin: false, language: "en" },
      });
      Object.defineProperty(w.document, "currentScript", {
        value: {
          dataset: {
            config: JSON.stringify({
              origin: "https://nora-m5.test",
              pageId: 7,
            }),
          },
        },
      });
      w.eval(
        readFileSync(
          new URL("../assets/inline-content.js", import.meta.url),
          "utf8",
        ),
      );
      w.eval(
        readFileSync(new URL("../assets/preview.js", import.meta.url), "utf8"),
      );
      w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
      const receive = (data) =>
        w.dispatchEvent(
          new w.MessageEvent("message", {
            source: host,
            origin: "https://nora-m5.test",
            data: {
              channel: "forma-content",
              version: 1,
              documentId: sent[0].documentId,
              ...data,
            },
          }),
        );
      receive({
        type: "state",
        pageId: 7,
        postId: 7,
        content: source,
        writable: true,
        busy: false,
        acknowledged: sent.at(-1).sequence,
      });
      const surface = w.document.getElementById("forma-inline-content");
      surface.click();
      await new Promise((resolve) => w.setTimeout(resolve, 30));
      assert.equal(
        w.document.querySelector(".forma-inline-content-outline").dataset
          .editing,
        "true",
      );
      receive({ type: "flush", requestId: "noop" });
      assert.equal(sent.at(-1).type, "flushed");
      assert.equal(
        sent.at(-1).content,
        source,
        "no-op preserves exact original bytes",
      );
      assert.equal(surface.textContent, "Theme-generated content");
      surface.click();
      await new Promise((resolve) => w.setTimeout(resolve, 30));
      const inline = w.tinymce.get("forma-inline-content");
      inline.insertContent("Ändrat ");
      inline.fire("input");
      assert.equal(sent.at(-1).type, "change");
      assert.match(sent.at(-1).content, /(?:Ä|&Auml;|&#196;)ndrat/);
      assert.ok(!sent.at(-1).content.includes("Theme-generated"));
      w.document.querySelector(".forma-add-media").click();
      assert.equal(sent.at(-1).type, "media");
      const mediaId = sent.at(-1).requestId;
      receive({ type: "flush", requestId: "during-media" });
      assert.equal(sent.at(-1).type, "blocked");
      receive({
        type: "media",
        requestId: mediaId,
        html: '<img src="/inserted.webp" alt="Inserted image" width="300" height="200" class="wp-image-321">',
      });
      assert.equal(sent.at(-1).type, "change");
      assert.match(sent.at(-1).content, /Inserted image/);
      receive({ type: "flush", requestId: "changed" });
      assert.equal(sent.at(-1).type, "flushed");
      assert.equal(sent.at(-1).requestId, "changed");
      if (process.env.FORMA_TEST_RESULT)
        writeFileSync(process.env.FORMA_TEST_RESULT, sent.at(-1).content);
    } finally {
      w.close();
    }
  },
);
