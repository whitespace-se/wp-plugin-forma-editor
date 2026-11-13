import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import test from "node:test";

function setup() {
  const handlers = new Map();
  const calls = [];
  const heartbeat = {
    interval: (n) => calls.push(n),
    disableSuspend: () => calls.push("keep-alive"),
    connectNow: () => calls.push("refresh"),
  };
  const events = {
    on: (name, handler) => handlers.set(name, handler),
    off: () => handlers.clear(),
  };
  const source = stripTypeScriptTypes(
    readFileSync(new URL("../src/wordpress/locks.ts", import.meta.url), "utf8"),
  ).replace("export function", "function");
  const observe = vm.runInNewContext(`${source}\nobservePostLock`, {
    window: { wp: { heartbeat }, jQuery: () => events },
    document: {},
  });
  let state = { lock: "123:1", generation: 0 };
  const received = [];
  let errors = 0;
  const subscription = observe(
    42,
    () => state,
    (reply) => received.push(reply),
    () => errors++,
  );
  return {
    subscription,
    handlers,
    calls,
    received,
    setState: (next) => {
      state = next;
    },
    errors: () => errors,
  };
}

test("core heartbeat detects another editor and refreshes the native lock without page reload", () => {
  const s = setup();
  assert.deepEqual(s.calls, [15, "keep-alive"]);
  const data = {};
  s.handlers.get("heartbeat-send.forma")(null, data);
  assert.deepEqual(JSON.parse(JSON.stringify(data)), {
    "wp-refresh-post-lock": { post_id: 42, lock: "123:1" },
  });
  const taken = { lock_error: { name: "Other editor", text: "Taken over" } };
  s.handlers.get("heartbeat-tick.forma")(null, {
    "wp-refresh-post-lock": taken,
  });
  assert.equal(s.received[0], taken);
  s.handlers.get("heartbeat-tick.forma")(null, {
    "wp-refresh-post-lock": { new_lock: "124:1" },
  });
  assert.equal(s.received[1].new_lock, "124:1");
  s.subscription.refresh();
  assert.equal(s.calls.at(-1), "refresh");
  s.subscription.dispose();
  assert.equal(s.handlers.size, 0);
});

test("a reply from before explicit takeover cannot restore the previous lock owner", () => {
  const s = setup();
  s.handlers.get("heartbeat-send.forma")(null, {});
  s.setState({ lock: "125:1", generation: 1 });
  s.handlers.get("heartbeat-tick.forma")(null, {
    "wp-refresh-post-lock": { lock_error: { name: "Old owner" } },
  });
  assert.equal(s.received.length, 0);
});

test("missing lock replies and failed requests are surfaced, not silently ignored", () => {
  const s = setup();
  s.handlers.get("heartbeat-send.forma")(null, {});
  s.handlers.get("heartbeat-tick.forma")(null, {});
  s.handlers.get("heartbeat-error.forma")(null, {});
  assert.equal(s.errors(), 2);
  s.setState(undefined);
  const data = {};
  s.handlers.get("heartbeat-send.forma")(null, data);
  assert.deepEqual(data, {});
});
