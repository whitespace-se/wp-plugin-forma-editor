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
  .replace("export async function workflow", "async function workflow");
function adapter(fetch) {
  return vm.runInNewContext(`${source}\nworkflow`, { apiFetch: fetch });
}
const state = {
  title: "",
  status: "draft",
  previewUrl: "https://example.test/?preview=true",
};

test("autosave sends the operation and raw title, including an empty title", async () => {
  const calls = [];
  const call = adapter(async (options) => {
    calls.push(JSON.parse(JSON.stringify(options)));
    return state;
  });
  assert.equal(await call("/forma/v1/posts/4/workflow", "autosave", ""), state);
  assert.deepEqual(calls, [
    {
      path: "/forma/v1/posts/4/workflow",
      method: "POST",
      data: { operation: "autosave", title: "" },
    },
  ]);
});
test("publish carries no stale title or independently chosen status", async () => {
  const call = adapter(async (options) => {
    assert.deepEqual(JSON.parse(JSON.stringify(options.data)), {
      operation: "publish",
    });
    return state;
  });
  await call("/forma/v1/posts/4/workflow", "publish");
});
test("invalid responses cannot be treated as saved", async () => {
  for (const response of [
    {},
    { ...state, status: "pending" },
    { ...state, title: null },
  ]) {
    await assert.rejects(
      adapter(async () => response)(
        "/forma/v1/posts/4/workflow",
        "autosave",
        "Title",
      ),
    );
  }
});
test("permission, nonce and network failures remain failures", async () => {
  for (const failure of [
    { code: "rest_cookie_invalid_nonce", data: { status: 403 } },
    { data: { status: 401 } },
    new Error("Offline"),
  ]) {
    await assert.rejects(
      adapter(async () => {
        throw failure;
      })("/forma/v1/posts/4/workflow", "autosave", "Unsaved"),
      (error) => error === failure,
    );
  }
});
