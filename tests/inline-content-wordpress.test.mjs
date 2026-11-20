import { JSDOM } from "jsdom";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

// Optional local integration: executes the installed WordPress/TinyMCE code
// in a DOM, without a browser or network. Layout/dialog UX still needs review.
for (const missingSettings of [true, false])
  test(
    missingSettings
      ? "missing inline settings leave rendered content intact"
      : "installed TinyMCE preserves source without global editor settings",
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
          observe(target) {
            assert.ok(
              target instanceof w.Element,
              "ResizeObserver requires an Element",
            );
          }
          disconnect() {}
        };
        w.IntersectionObserver = class {
          observe() {}
        };
        if (process.env.FORMA_TEST_EXTENSIONS) {
          w.eval(readFileSync(process.env.FORMA_TEST_EXTENSIONS, "utf8"));
        }
        const supplied = process.env.FORMA_TEST_CONFIG
          ? JSON.parse(readFileSync(process.env.FORMA_TEST_CONFIG, "utf8"))
          : {};
        const scriptRequests = [];
        const append = w.document.head.appendChild.bind(w.document.head);
        w.document.head.appendChild = (node) => {
          if (node.tagName === "SCRIPT") scriptRequests.push(node.src);
          return append(node);
        };
        Object.defineProperty(w.document, "currentScript", {
          value: {
            dataset: {
              config: JSON.stringify({
                origin: "https://nora-m5.test",
                pageId: 7,
                translations: supplied.translations || {
                  Bold: "Fet",
                  Italic: "Kursiv",
                },
                editor: missingSettings
                  ? null
                  : {
                      ...supplied.editor,
                      theme: "modern",
                      skin: false,
                      language: supplied.editor?.language || "sv",
                    },
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
          readFileSync(
            new URL("../assets/preview.js", import.meta.url),
            "utf8",
          ),
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
          inlineEnabled: false,
          acknowledged: sent.at(-1).sequence,
        });
        const surface = w.document.getElementById("forma-inline-content");
        w.tinyMCEPreInit = undefined;
        w.wp.editor.getDefaultSettings = undefined;
        surface.focus();
        assert.equal(
          w.tinymce.get("forma-inline-content"),
          null,
          "focus alone does not restart editing",
        );
        surface.click();
        if (missingSettings) {
          assert.equal(
            surface.textContent,
            "Theme-generated content",
            "missing settings must not empty the preview",
          );
          assert.equal(
            sent.filter((packet) => packet.type === "begin").length,
            0,
          );
          assert.match(
            w.document.querySelector(".forma-content-error").textContent,
            /oförändrat/,
          );
          return;
        }
        assert.equal(sent.at(-1).type, "begin");
        assert.equal(
          surface.textContent,
          "Theme-generated content",
          "preview stays intact until the panel relinquishes ownership",
        );
        receive({
          type: "state",
          pageId: 7,
          postId: 7,
          content: source,
          writable: true,
          busy: false,
          inlineEnabled: true,
          acknowledged: sent.at(-1).sequence,
        });
        receive({ type: "begin" });
        await new Promise((resolve) => w.setTimeout(resolve, 30));
        assert.equal(
          w.document.querySelector(".forma-inline-content-outline").dataset
            .editing,
          "true",
        );
        assert.equal(w.tinymce.translate("Bold"), "Fet");
        assert.ok(
          w.document.querySelector("#forma-inline-toolbar .mce-toolbar"),
          "first activation renders the toolbar",
        );
        assert.deepEqual(
          scriptRequests,
          [],
          "preloaded locale and plugins must not trigger dynamic scripts",
        );
        if (process.env.FORMA_TEST_EXTENSIONS)
          assert.equal(
            w.tinymce.get("forma-inline-content").municipioEditorExtensions,
            true,
          );
        receive({ type: "flush", requestId: "noop" });
        assert.equal(sent.at(-1).type, "flushed");
        assert.equal(
          sent.at(-1).content,
          source,
          "no-op preserves exact original bytes",
        );
        assert.equal(surface.textContent, "Theme-generated content");
        assert.ok(
          w.document.getElementById("forma-inline-toolbar"),
          "toolbar mount survives teardown",
        );
        for (let cycle = 0; cycle < 3; cycle++) {
          surface.focus();
          surface.click();
          receive({ type: "begin" });
          await new Promise((resolve) => w.setTimeout(resolve, 30));
          const toolbar = w.document.querySelector(
            "#forma-inline-toolbar .mce-toolbar",
          );
          assert.ok(toolbar, "every unchanged reopening creates a toolbar");
          const button = toolbar.querySelector("button");
          button.focus();
          receive({
            type: "state",
            pageId: 7,
            postId: 7,
            content: source,
            writable: true,
            busy: false,
            inlineEnabled: true,
            acknowledged: sent.at(-1).sequence,
          });
          assert.equal(
            w.document.activeElement,
            button,
            "state acknowledgements preserve toolbar focus",
          );
          if (cycle === 1) {
            const outside = w.document.createElement("button");
            outside.textContent = "Outside editor";
            w.document.body.append(outside);
            const click = new w.MouseEvent("pointerdown", {
              bubbles: true,
              cancelable: true,
            });
            outside.dispatchEvent(click);
            assert.equal(
              click.defaultPrevented,
              true,
              "preview guard still blocks outside controls",
            );
            assert.equal(
              sent.at(-1).type,
              "end",
              "outside click ends editing even when the guard blocks focus",
            );
            assert.equal(
              w.document.querySelector(".forma-inline-content-outline").dataset
                .editing,
              "false",
            );
            assert.equal(
              w.document.querySelector(".forma-inline-content-tools").hidden,
              true,
            );
            assert.equal(surface.textContent, "Theme-generated content");
            outside.remove();
          } else receive({ type: "flush", requestId: `repeat-${cycle}` });
          assert.equal(sent.at(-1).content, source);
        }
        surface.focus();
        surface.click();
        receive({ type: "begin" });
        await new Promise((resolve) => w.setTimeout(resolve, 30));
        const inline = w.tinymce.get("forma-inline-content");
        assert.ok(
          w.document.querySelector("#forma-inline-toolbar .mce-toolbar"),
          "second activation renders the toolbar without a frame reload",
        );
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
