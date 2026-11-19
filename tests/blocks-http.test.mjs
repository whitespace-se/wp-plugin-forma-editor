import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import test from "node:test";

// Validate the delivered response after theme/security output filters, rather
// than the pre-render script registry used by the runtime integration test.
test(
  "delivered block bootstrap is executable JavaScript",
  {
    skip: !process.env.FORMA_TEST_HTML,
  },
  () => {
    const dom = new JSDOM(readFileSync(process.env.FORMA_TEST_HTML, "utf8"));
    try {
      const script = dom.window.document.getElementById(
        "forma-blocks-js-after",
      );
      assert.ok(script, "Block bootstrap must be delivered");
      assert.doesNotThrow(() => new Script(script.textContent));
      let config;
      new Script(script.textContent).runInNewContext({
        FormaBlocks: {
          start: (value) => {
            config = value;
          },
        },
      });
      assert.ok(config?.pageId);
      assert.equal(config.settings.__unstableResolvedAssets, undefined);
      assert.ok(dom.window.document.querySelector("[data-forma-block-mount]"));
    } finally {
      dom.window.close();
    }
  },
);
