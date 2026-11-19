import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const dom = new JSDOM("", { runScripts: "outside-only" });
dom.window.eval(
  readFileSync(
    new URL("../assets/inline-content-policy.js", import.meta.url),
    "utf8",
  ),
);
const { safe, signature } = dom.window.formaContentPolicy;
test("ordinary source and WordPress image attributes are supported", () => {
  assert.equal(
    safe(
      'Ingress\r\n\r\n<!--more-->\r\n<h2>Rubrik</h2><ul><li><a href="/sida?a=1&amp;b=2" target="_blank" rel="noopener">Länk</a></li></ul><img src="https://example.test/a.webp" alt="Text" width="640" height="360" class="alignnone size-full wp-image-123">',
    ),
    true,
  );
  assert.equal(safe(""), true);
});
test("generated or unsupported source is rejected as a whole", () => {
  for (const source of [
    '[gallery ids="1"]',
    "<!-- wp:paragraph --><p>Hej</p>",
    "<!--nextpage-->",
    '<iframe src="https://example.test"></iframe>',
    '<p data-unknown="yes">Hej</p>',
    '<p style="color:red">Hej</p>',
    "<script>alert(1)</script>",
    '<img src="data:image/png;base64,x">',
    '<a href="java&#10;script:alert(1)">x</a>',
    '<img src="a" class="theme-generated">',
  ])
    assert.equal(safe(source), false, source);
});
test("serialization comparison catches lost link/image attributes and structure", () => {
  assert.notEqual(
    signature("<p><strong>A</strong> <em>B</em></p>"),
    signature("<p><strong>A</strong><em>B</em></p>"),
  );
  assert.equal(
    signature("<p>Hej &amp; hej</p>\r\n<!--more-->"),
    signature("<p>Hej &amp; hej</p>\n<p><!--more--></p>"),
  );
  assert.notEqual(
    signature('<a href="/x" rel="noopener" target="_blank">x</a>'),
    signature('<a href="/x">x</a>'),
  );
  assert.notEqual(
    signature('<img src="/x" alt="x" width="100">'),
    signature('<img src="/x" alt="x">'),
  );
  assert.notEqual(signature("<h2>Rubrik</h2>"), signature("<p>Rubrik</p>"));
});
