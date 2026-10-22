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

test("version-only audio references survive orphan cleanup, including recovery snapshots", async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"lilith-version-retention-"));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const dataDir=path.join(root,"data"),versions=path.join(dataDir,"versions","task-example"),job=path.join(dataDir,"transcriptions","jobs","version-audio"),uploads=path.join(dataDir,"transcriptions","uploads");
  await Promise.all([fs.mkdir(versions,{recursive:true}),fs.mkdir(job,{recursive:true}),fs.mkdir(uploads,{recursive:true})]);
  const audio=path.join(uploads,"version.wav");await fs.writeFile(audio,"fixture");
  await fs.writeFile(path.join(job,"job-meta.json"),JSON.stringify({sourcePath:audio}));
  await fs.writeFile(path.join(versions,"version-recovery.json"),JSON.stringify({transcriptionMeta:{jobId:"version-audio"}}));
  const old=new Date(Date.now()-40*24*60*60*1000);await fs.utimes(job,old,old);await fs.utimes(audio,old,old);
  const result=await pruneOrphanedTranscriptions({dataDir});assert.equal(result.jobsRemoved,0);assert.equal(result.uploadsRemoved,0);await fs.access(audio);
  await fs.writeFile(path.join(versions,"version-broken.json"),"{broken");
  assert.equal((await pruneOrphanedTranscriptions({dataDir})).skipped,true);
});

test("trash-only audio references never expire with orphan cleanup", async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"lilith-trash-retention-"));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const trash=path.join(root,"trash"),uploads=path.join(root,"transcriptions","uploads"),job=path.join(root,"transcriptions","jobs","trashed-audio");
  await Promise.all([fs.mkdir(trash,{recursive:true}),fs.mkdir(uploads,{recursive:true}),fs.mkdir(job,{recursive:true})]);
  const audio=path.join(uploads,"trashed.webm");await fs.writeFile(audio,"audio");
  await fs.writeFile(path.join(job,"job-meta.json"),JSON.stringify({sourcePath:audio}));
  await fs.writeFile(path.join(trash,"task-trash.json"),JSON.stringify({task:{id:"task-trash",transcriptionMeta:{jobId:"trashed-audio"}}}));
  const old=new Date(Date.now()-50*24*3600_000);await fs.utimes(audio,old,old);await fs.utimes(job,old,old);
  assert.equal((await pruneOrphanedTranscriptions({dataDir:root})).jobsRemoved,0);await fs.access(audio);
  await fs.writeFile(path.join(trash,"broken.json"),"{}");
  assert.equal((await pruneOrphanedTranscriptions({dataDir:root})).skipped,true);
});
