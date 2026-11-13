import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import test from "node:test";

const source = stripTypeScriptTypes(
  readFileSync(new URL("../src/editor/Autosave.ts", import.meta.url), "utf8"),
  { mode: "transform" },
).replace("export class", "class");
const Autosave = vm.runInNewContext(`${source}\nAutosave`, {
  setTimeout,
  clearTimeout,
  Date,
  Promise,
  Error,
});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (test) => {
  for (let n = 0; n < 100 && !test(); n++) await wait(2);
  assert.ok(test());
};

test("immediate first save, throttled latest input, never parallel; flush waits for latest", async () => {
  const calls = [];
  let resolve;
  const queue = new Autosave(
    "old",
    (value) => {
      calls.push({ value, at: Date.now() });
      return new Promise((done) => {
        resolve = done;
      });
    },
    (value) => value,
    () => {},
    30,
  );
  try {
    queue.edit("first");
    await until(() => calls.length === 1);
    queue.edit("second");
    queue.edit("latest");
    await wait(35);
    assert.equal(calls.length, 1);
    const flushed = queue.flush();
    resolve("first");
    await until(() => calls.length === 2);
    assert.equal(calls[1].value, "latest");
    assert.ok(calls[1].at - calls[0].at >= 30);
    resolve("latest");
    await flushed;
    assert.equal(queue.dirty, false);
  } finally {
    queue.dispose();
  }
});

test("a revert during a request is saved after that request finishes", async () => {
  let resolve;
  const calls = [];
  const queue = new Autosave(
    "old",
    (value) => {
      calls.push(value);
      return calls.length === 1
        ? new Promise((done) => {
            resolve = done;
          })
        : Promise.resolve(value);
    },
    (value) => value,
    () => {},
    1,
  );
  try {
    queue.edit("new");
    await until(() => calls.length === 1);
    queue.edit("old");
    const flushed = queue.flush();
    resolve("new");
    await flushed;
    assert.deepEqual(calls, ["new", "old"]);
  } finally {
    queue.dispose();
  }
});

test("network failure retains input and automatically retries; failed flush rejects", async () => {
  let calls = 0;
  const queue = new Autosave(
    "old",
    async (value) => {
      if (++calls === 1) throw new Error("offline");
      return value;
    },
    (value) => value,
    () => {},
    1,
    10,
  );
  try {
    queue.edit("new");
    await assert.rejects(queue.flush(), /offline/);
    assert.equal(queue.value, "new");
    assert.equal(queue.dirty, true);
    await until(() => calls === 2 && !queue.busy);
    assert.equal(queue.dirty, false);
  } finally {
    queue.dispose();
  }
});

test("lost lock pauses retries and takeover preserves local input", async () => {
  let calls = 0;
  const queue = new Autosave(
    "old",
    async (value) => {
      if (++calls === 1) throw { data: { status: 409 } };
      return value;
    },
    (value) => value,
    () => {},
    1,
    5,
  );
  try {
    queue.edit("new");
    await assert.rejects(queue.flush());
    await wait(15);
    assert.equal(calls, 1);
    assert.equal(queue.paused, true);
    assert.equal(queue.value, "new");
    queue.retry();
    await queue.flush();
    assert.equal(queue.saved, "new");
  } finally {
    queue.dispose();
  }
});

test("a lost response followed by a revert still writes the intended title", async () => {
  const calls = [];
  const queue = new Autosave(
    "old",
    async (value) => {
      calls.push(value);
      if (calls.length === 1) throw new Error("Response lost after commit");
      return value;
    },
    (value) => value,
    () => {},
    1,
    1000,
  );
  try {
    queue.edit("new");
    await assert.rejects(queue.flush());
    queue.edit("old");
    queue.retry();
    await queue.flush();
    assert.deepEqual(calls, ["new", "old"]);
    assert.equal(queue.dirty, false);
  } finally {
    queue.dispose();
  }
});

test("normalized responses preserve trailing spaces without repeated saves", async () => {
  const calls = [];
  let serverTitle;
  const queue = new Autosave(
    "old",
    async (value) => {
      calls.push(value);
      return value.trim();
    },
    (value) => {
      serverTitle = value;
    },
    () => {},
    1,
  );
  try {
    queue.edit("Title ");
    await queue.flush();
    assert.equal(queue.value, "Title ");
    assert.equal(queue.saved, "Title ");
    assert.equal(serverTitle, "Title");
    assert.equal(queue.dirty, false);
    await queue.flush();
    await wait(15);
    assert.deepEqual(calls, ["Title "]);
    queue.edit(queue.value + "word");
    await queue.flush();
    assert.equal(queue.value, "Title word");
    assert.equal(serverTitle, "Title word");
  } finally {
    queue.dispose();
  }
});

test("normalized response cannot overwrite newer input while saving", async () => {
  const calls = [];
  let resolve;
  const queue = new Autosave(
    "old",
    (value) => {
      calls.push(value);
      return calls.length === 1
        ? new Promise((done) => {
            resolve = done;
          })
        : Promise.resolve(value.trim());
    },
    () => {},
    () => {},
    1,
  );
  try {
    queue.edit("Title ");
    await until(() => calls.length === 1);
    queue.edit("Title word ");
    const flushed = queue.flush();
    resolve("Title");
    await flushed;
    assert.deepEqual(calls, ["Title ", "Title word "]);
    assert.equal(queue.value, "Title word ");
    assert.equal(queue.saved, "Title word ");
    assert.equal(queue.dirty, false);
  } finally {
    queue.dispose();
  }
});
