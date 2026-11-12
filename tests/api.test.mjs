import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { stripTypeScriptTypes } from "node:module";

const source = stripTypeScriptTypes(
  readFileSync(new URL("../src/wordpress/api.ts", import.meta.url), "utf8"),
)
  .replace('import apiFetch from "@wordpress/api-fetch";', "")
  .replace("export { apiFetch };", "")
  .replace("export async function postTitle", "async function postTitle");

function adapter(fetch) {
  return vm.runInNewContext(`${source}\npostTitle`, { apiFetch: fetch });
}

test("save sends only title, including empty titles, and uses server raw value", async () => {
  const calls = [];
  const save = adapter(async (options) => {
    calls.push(JSON.parse(JSON.stringify(options)));
    return { id: 4, title: { raw: "Server value", rendered: "Other value" } };
  });
  assert.equal(await save("/wp/v2/pages/4", 4, ""), "Server value");
  assert.deepEqual(calls, [
    {
      path: "/wp/v2/pages/4?context=edit&_fields=id,title",
      method: "POST",
      data: { title: "" },
    },
  ]);
});

test("read carries abort signal and does not send a write payload", async () => {
  const controller = new AbortController();
  const read = adapter(async (options) => {
    assert.equal(options.method, "GET");
    assert.equal(options.signal, controller.signal);
    assert.equal("data" in options, false);
    return { id: 4, title: { raw: "Title" } };
  });
  assert.equal(
    await read("/wp/v2/pages/4", 4, undefined, controller.signal),
    "Title",
  );
});

test("wrong post and missing raw title cannot be treated as saved", async () => {
  for (const response of [
    { id: 5, title: { raw: "Wrong" } },
    { id: 4, title: { rendered: "Only rendered" } },
  ]) {
    await assert.rejects(
      adapter(async () => response)("/wp/v2/pages/4", 4, "Title"),
    );
  }
});

test("permission, nonce and network failures remain failures", async () => {
  for (const failure of [
    { code: "rest_cookie_invalid_nonce", data: { status: 403 } },
    { data: { status: 401 } },
    new Error("Offline"),
  ]) {
    const save = adapter(async () => {
      throw failure;
    });
    await assert.rejects(
      save("/wp/v2/pages/4", 4, "Unsaved"),
      (error) => error === failure,
    );
  }
});
