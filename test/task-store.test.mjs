import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TaskStore } from "../lib/task-store.mjs";

test("task store owns task, version, and shared transcription lifecycle", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lilith-task-store-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const removedJobs = [];
  const store = new TaskStore({
    tasksDir: path.join(root, "tasks"),
    versionsDir: path.join(root, "versions"),
    transcriptionManager: { async remove(id) { removedJobs.push(id); return { deleted: true, audioDeleted: true }; } }
  });
  const first = "task-first-0001";
  const second = "task-second-002";
  await store.save(first, { title: "第一课", sourceText: "正文", transcriptionMeta: { jobId: "transcription-shared" } });
  await store.save(second, { title: "第二课", sourceText: "正文", transcriptionMeta: { jobId: "transcription-shared" } });
  assert.equal((await store.list()).length, 2);
  assert.equal((await store.list()).every((task) => task.hasAudio), true);

  await store.rename(first, "农村社会学课程工程");
  assert.equal((await store.get(first)).title, "农村社会学课程工程");
  assert.equal((await store.get(first)).projectTitle, "农村社会学课程工程");

  const version = await store.createVersion(first, { versionLabel: "人工核对后", sourceText: "正文" });
  await store.renameVersion(first, version.id, "定稿前");
  assert.equal((await store.getVersion(first, version.id)).versionLabel, "定稿前");

  const firstRemoval = await store.remove(first);
  assert.equal(firstRemoval.audioRetainedShared, true);
  assert.deepEqual(removedJobs, []);
  const secondRemoval = await store.remove(second);
  assert.equal(secondRemoval.audioRetainedShared, false);
  assert.deepEqual(removedJobs, ["transcription-shared"]);
});
