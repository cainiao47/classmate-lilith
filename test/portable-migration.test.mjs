import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { migratePortableData } from "../lib/portable-migration.mjs";
import { SettingsStore } from "../settings-store.mjs";
import { TranscriptionManager } from "../transcription-worker.mjs";
import { TaskStore } from "../lib/task-store.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lilith-migration-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const old = path.join(root, "old-app"), data = path.join(old, "data"), target = path.join(root, "profile", "data");
  await fs.mkdir(data, { recursive: true });
  return { root, old, data, target };
}

test("migration verifies copied audio, remaps owned paths and preserves secret bytes and original files", async t => {
  const { old, data, target } = await fixture(t);
  const settings = '{"format":"portable-light-encryption-v3","deepseek_api_key":"test-only-not-a-real-key"}\n';
  await fs.writeFile(path.join(data, "settings.json"), settings);
  const job = path.join(data, "transcriptions", "jobs", "job-example"); await fs.mkdir(job, { recursive: true });
  const audio = Buffer.from([0, 1, 2, 3, 240, 241]); await fs.writeFile(path.join(job, "audio-normalized.mp3"), audio);
  const original = { normalizedPath: path.join(job, "audio-normalized.mp3"), sourcePath: path.join(data, "transcriptions", "uploads", "old.wav"), external: { filePath: path.join(old, "outside-data.wav") }, workingText: `不要改写正文中的路径 ${data}` };
  await fs.writeFile(path.join(job, "job-meta.json"), JSON.stringify(original));
  const record = await migratePortableData({ sourceRoot: old, destination: target });
  assert.equal(record.originalPreserved, true); assert.equal(record.files, 3);
  assert.equal(await fs.readFile(path.join(target, "settings.json"), "utf8"), settings);
  assert.equal(await fs.readFile(path.join(data, "settings.json"), "utf8"), settings);
  assert.deepEqual(await fs.readFile(path.join(target, "transcriptions", "jobs", "job-example", "audio-normalized.mp3")), audio);
  const meta = JSON.parse(await fs.readFile(path.join(target, "transcriptions", "jobs", "job-example", "job-meta.json"), "utf8"));
  assert.equal(meta.normalizedPath, path.join(target, "transcriptions", "jobs", "job-example", "audio-normalized.mp3"));
  assert.equal(meta.sourcePath, path.join(target, "transcriptions", "uploads", "old.wav"));
  assert.deepEqual(meta.external, original.external); assert.equal(meta.workingText, original.workingText);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(job, "job-meta.json"), "utf8")), original);
});

test("migration refuses to overwrite existing data and cleans staging after malformed metadata", async t => {
  const { old, data, target } = await fixture(t);
  await fs.mkdir(target, { recursive: true }); await fs.writeFile(path.join(target, "settings.json"), "existing");
  await assert.rejects(migratePortableData({ sourceRoot: old, destination: target }), /已存在用户数据/);
  assert.equal(await fs.readFile(path.join(target, "settings.json"), "utf8"), "existing");
  await fs.unlink(path.join(target, "settings.json")); await fs.writeFile(path.join(data, "broken.json"), "{");
  await assert.rejects(migratePortableData({ sourceRoot: old, destination: target }));
  assert.equal(await fs.readFile(path.join(data, "broken.json"), "utf8"), "{");
  assert.deepEqual(await fs.readdir(path.dirname(target)), ["data"]);
});

test("legacy-only settings migration keeps the original credentials file unchanged", async t => {
  const { old, target } = await fixture(t);
  await fs.mkdir(path.join(old, "config"));
  const legacy = '{"openai_api_key":"test-only"}'; await fs.writeFile(path.join(old, "config", "api-settings.json"), legacy);
  await migratePortableData({ sourceRoot: old, destination: target });
  assert.equal(await fs.readFile(path.join(target, "settings.json"), "utf8"), legacy);
  assert.equal(await fs.readFile(path.join(old, "config", "api-settings.json"), "utf8"), legacy);
});

test("v0.21.1 projects, version snapshots and audio survive migration without copying runtime credentials or caches", async t => {
  const { old, data, target } = await fixture(t);
  const oldSettings = new SettingsStore({ file: path.join(data, "settings.json") });
  await oldSettings.save({ deepseekApiKey: "migration-test-only-key", tencentAppId: "test-app" });
  const beforeSettings = await fs.readFile(oldSettings.file);
  await fs.mkdir(path.join(data, "webview2"));
  await fs.writeFile(path.join(data, "webview2", "cache.json"), "not application JSON");
  await fs.writeFile(path.join(data, ".launcher-token"), "old-runtime-shutdown-credential");
  const oldManager = new TranscriptionManager({ appRoot: old, dataDir: data });
  await oldManager.initialize();
  const audioBytes = Buffer.from([0, 1, 2, 3, 240, 241]);
  const upload = await oldManager.saveUpload((async function* () { yield audioBytes; })(), "lecture.webm");
  const job = await oldManager.importLiveResult({ sourcePath: upload.filePath, originalName: "lecture.webm", engine: "alibaba", text: "保留限定条件及例证。", durationMs: 2000 });
  const oldTasks = new TaskStore({ tasksDir: path.join(data, "tasks"), versionsDir: path.join(data, "versions"), transcriptionManager: oldManager });
  const id = "task-legacy-project";
  const project = { schemaVersion: 4, projectTitle: "自定义工程名称", title: "自定义工程名称", transcriptionDraft: job.result.text,
    transcriptionMeta: { jobId: job.id, srt: job.result.srt }, proseMode: "detailed", proseStatus: "paused", prosePlan: "旧版全文结构", proseProtectedFacts: ["限定条件"], proseChunks: ["保留的书面段落"], reviewSourceHash: "old-review-hash" };
  await oldTasks.save(id, project);
  const version = await oldTasks.createVersion(id, { ...project, versionLabel: "人工保存版本" });

  const record = await migratePortableData({ sourceRoot: old, destination: target });
  assert.deepEqual(record.excludedRuntimeState, ["webview2", ".launcher-token"]);
  await assert.rejects(fs.access(path.join(target, "webview2")));
  await assert.rejects(fs.access(path.join(target, ".launcher-token")));
  assert.deepEqual(await fs.readFile(path.join(target, "settings.json")), beforeSettings);
  const loadedSettings = await new SettingsStore({ file: path.join(target, "settings.json") }).load();
  assert.equal(loadedSettings.deepseekApiKey, "migration-test-only-key");
  const newManager = new TranscriptionManager({ appRoot: old, dataDir: target });
  await newManager.initialize();
  const newTasks = new TaskStore({ tasksDir: path.join(target, "tasks"), versionsDir: path.join(target, "versions"), transcriptionManager: newManager });
  const restored = await newTasks.get(id);
  assert.equal(restored.projectTitle, project.projectTitle);
  assert.equal(restored.prosePlan, project.prosePlan);
  assert.deepEqual(restored.proseProtectedFacts, project.proseProtectedFacts);
  assert.equal((await newTasks.getVersion(id, version.id)).versionLabel, "人工保存版本");
  const migratedAudioPath = await newManager.audioPath(job.id);
  assert.ok(migratedAudioPath.startsWith(target + path.sep));
  assert.deepEqual(await fs.readFile(migratedAudioPath), audioBytes);
  assert.deepEqual(await fs.readFile(upload.filePath), audioBytes);
  assert.equal(await fs.readFile(path.join(data, ".launcher-token"), "utf8"), "old-runtime-shutdown-credential");
});
