import test from "node:test";
import assert from "node:assert/strict";
import { createLiveBackup } from "../public/modules/live-backup.js";

test("local backup retains failed fragments and retries the same index without reordering", async () => {
  const indices = [], statuses = [], checkpoints = [];
  let fail = true, count = 0, retry;
  const backup = createLiveBackup({ snapshot: () => ({ text: "文稿", phase: "recording" }), onStatus: state => statuses.push(state),
    schedule: callback => { retry = callback; return 1; }, cancel() {},
    fetchImpl: async (url, options) => {
      if (url === "/api/live-recordings") return { ok: true, json: async () => ({ id: "live-fake" }) };
      if (url.includes("/chunks/")) {
        const index = Number(url.split("/").pop()); indices.push(index);
        if (fail) { fail = false; throw Error("acknowledgement lost"); }
        assert.equal(index, count++);
        return { ok: true, json: async () => ({ persistedChunks: count }) };
      }
      checkpoints.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ updatedAt: new Date().toISOString() }) };
    }
  });
  await backup.start({ extension: "webm" });
  backup.append(new Blob(["header"])); backup.append(new Blob(["audio"]));
  assert.equal(await backup.flush(), false);
  assert.equal(statuses.at(-1).failed, true);
  assert.equal(statuses.at(-1).pending, 2);
  assert.equal(typeof retry, "function");
  assert.equal(await backup.flush(), true);
  assert.deepEqual(indices, [0, 0, 1]);
  assert.equal(statuses.at(-1).pending, 0);
  assert.equal(statuses.at(-1).count, 2);
  assert.equal(checkpoints.at(-1).text, "文稿");
  backup.stop();
});

test("edits during checkpoint stay dirty and successful archive can accept later edits", async () => {
  let text = "较早", resolveFirst, patchCount = 0;
  const saved = [], completed = [];
  const backup = createLiveBackup({ snapshot: () => ({ text }), schedule: () => 1, cancel() {},
    fetchImpl: async (url, options) => {
      if (url === "/api/live-recordings") return { ok: true, json: async () => ({ id: "live-fake" }) };
      if (url.endsWith("/complete")) { completed.push(JSON.parse(options.body)); return { ok: true, json: async () => ({}) }; }
      saved.push(JSON.parse(options.body).text);
      if (patchCount++ === 0) await new Promise(resolve => { resolveFirst = resolve; });
      return { ok: true, json: async () => ({ updatedAt: "2026-10-22T03:00:00Z" }) };
    }
  });
  await backup.start({}); backup.checkpoint();
  await new Promise(resolve => setImmediate(resolve));
  text = "最新"; backup.checkpoint(); resolveFirst();
  assert.equal(await backup.flush(), true);
  assert.deepEqual(saved, ["较早", "最新"]);
  assert.equal(await backup.complete("task-example"), true);
  assert.equal(completed[0].taskId, "task-example");
  text = "归档后修改"; backup.checkpoint(); await backup.flush();
  assert.equal(saved.at(-1), "归档后修改"); backup.stop();
});
