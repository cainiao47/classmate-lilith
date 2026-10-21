import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { migratePortableData } from "../lib/portable-migration.mjs";

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
