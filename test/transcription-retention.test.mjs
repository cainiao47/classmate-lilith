import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pruneOrphanedTranscriptions } from "../lib/transcription-retention.mjs";

test("retention keeps task audio and removes only aged orphan data", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lilith-retention-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, "data");
  const tasksDir = path.join(dataDir, "tasks");
  const uploadsDir = path.join(dataDir, "transcriptions", "uploads");
  const jobsDir = path.join(dataDir, "transcriptions", "jobs");
  await Promise.all([fs.mkdir(tasksDir, { recursive: true }), fs.mkdir(uploadsDir, { recursive: true })]);
  const now = Date.now();
  const old = new Date(now - 40 * 24 * 60 * 60 * 1000);

  for (const id of ["kept-job", "orphan-job"]) {
    const jobDir = path.join(jobsDir, id);
    const sourcePath = path.join(uploadsDir, `${id}.mp3`);
    await fs.mkdir(jobDir, { recursive: true });
    await fs.writeFile(sourcePath, id);
    await fs.writeFile(path.join(jobDir, "job-meta.json"), JSON.stringify({ id, sourcePath }));
    await fs.utimes(jobDir, old, old);
    await fs.utimes(sourcePath, old, old);
  }
  const looseUpload = path.join(uploadsDir, "loose.mp3");
  await fs.writeFile(looseUpload, "loose");
  await fs.utimes(looseUpload, old, old);
  await fs.writeFile(path.join(tasksDir, "task.json"), JSON.stringify({ transcriptionMeta: { jobId: "kept-job" } }));

  const result = await pruneOrphanedTranscriptions({ dataDir, tasksDir, now });
  assert.deepEqual(result, { jobsRemoved: 1, uploadsRemoved: 2, skipped: false, damagedTaskFiles: 0 });
  await fs.access(path.join(jobsDir, "kept-job"));
  await fs.access(path.join(uploadsDir, "kept-job.mp3"));
  await assert.rejects(fs.access(path.join(jobsDir, "orphan-job")));
  await assert.rejects(fs.access(looseUpload));
});

test("retention skips deletion when a task file is damaged", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lilith-retention-damaged-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, "data");
  const tasksDir = path.join(dataDir, "tasks");
  const uploadsDir = path.join(dataDir, "transcriptions", "uploads");
  await Promise.all([fs.mkdir(tasksDir, { recursive: true }), fs.mkdir(uploadsDir, { recursive: true })]);
  const audio = path.join(uploadsDir, "possibly-referenced.mp3");
  await fs.writeFile(audio, "audio");
  await fs.writeFile(path.join(tasksDir, "damaged.json"), "{not-json");
  const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  await fs.utimes(audio, old, old);

  const result = await pruneOrphanedTranscriptions({ dataDir, tasksDir });
  assert.equal(result.skipped, true);
  assert.equal(result.damagedTaskFiles, 1);
  await fs.access(audio);
});
