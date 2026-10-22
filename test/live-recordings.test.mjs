import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { LiveRecordingStore } from "../lib/live-recordings.mjs";

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lilith-live-recovery-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, store: new LiveRecordingStore({ directory, ...options }) };
}
const body = text => Readable.from([Buffer.from(text)]);

test("restart reconstructs exact ordered recording including header and latest transcript", async t => {
  const { directory, store } = await fixture(t);
  const { id } = await store.create({ topic: "恢复测试", extension: "webm", provider: "alibaba" });
  await store.append(id, 0, body("HEADER"));
  await store.append(id, 1, body("AUDIO-1"));
  await store.checkpoint(id, { text: "已确认的文稿", topic: "讲座", durationMs: 2100, phase: "paused", segments: [{ text: "一句话", startMs: 0, endMs: 2100 }] });
  // A complete fragment remains discoverable even if metadata was not updated.
  await store.append(id, 2, body("AUDIO-2"));
  await fs.writeFile(path.join(directory, id, ".interrupted.tmp"), "partial upload");
  const restarted = new LiveRecordingStore({ directory });
  const recovered = await restarted.get(id);
  assert.equal(recovered.active, false, "restarting releases the old in-memory recording lease");
  assert.equal(recovered.persistedChunks, 3);
  assert.equal(recovered.text, "已确认的文稿");
  assert.equal(recovered.phase, "paused");
  assert.equal((await restarted.list()).length, 1);
  assert.equal(await fs.readFile(await restarted.audioPath(id), "utf8"), "HEADERAUDIO-1AUDIO-2");
  await restarted.complete(id, "task-saved-recovery");
  assert.equal((await restarted.list()).length, 0);
  await fs.access(path.join(directory, id, "00000000.part"));
  // Further manual edits reactivate the recovery point without losing audio.
  await restarted.checkpoint(id, { text: "保存后再次编辑", phase: "done" });
  assert.equal((await restarted.list()).length, 1);
});

test("fragment retries are idempotent, while reordered or different data never overwrite audio", async t => {
  const { store } = await fixture(t);
  const { id } = await store.create({ extension: "ogg" });
  await assert.rejects(store.append(id, 1, body("wrong order")), /不连续/);
  await store.append(id, 0, body("first"));
  assert.equal((await store.append(id, 0, body("first"))).persistedChunks, 1);
  await assert.rejects(store.append(id, 0, body("changed")), /不一致/);
  await Promise.all([store.append(id, 1, body("second")), store.append(id, 1, body("second"))]);
  assert.equal((await store.get(id)).persistedChunks, 2);
  assert.equal(await fs.readFile(await store.audioPath(id), "utf8"), "firstsecond");
  await assert.rejects(store.get("../../settings.json"), /无效/);
  await assert.rejects(store.create({ extension: "exe" }), /不支持/);
});

test("aborted, oversized, and quota-limited uploads cannot become durable fragments", async t => {
  const { store } = await fixture(t, { maxChunkBytes: 8, maxRecordingBytes: 10 });
  const { id } = await store.create({});
  const interrupted = Readable.from((async function* () { yield Buffer.from("part"); throw Error("disconnected"); })());
  await assert.rejects(store.append(id, 0, interrupted), /disconnected/);
  assert.equal((await store.get(id)).persistedChunks, 0);
  await assert.rejects(store.append(id, 0, body("too large!")), /过大/);
  await store.append(id, 0, body("123456"));
  await assert.rejects(store.append(id, 1, body("123456")), /容量上限/);
  assert.equal((await store.get(id)).persistedChunks, 1);
  assert.equal(await fs.readFile(await store.audioPath(id), "utf8"), "123456");
});

test("missing fragments are reported without deleting text or assembling misleading audio", async t => {
  const { directory, store } = await fixture(t);
  const { id } = await store.create({ text: "仍可恢复的文字" });
  await store.append(id, 0, body("header"));
  await store.append(id, 1, body("audio"));
  await fs.rename(path.join(directory, id, "00000000.part"), path.join(directory, id, ".damaged-header"));
  const restarted = new LiveRecordingStore({ directory });
  assert.equal((await restarted.get(id)).damaged, true);
  assert.equal((await restarted.get(id)).text, "仍可恢复的文字");
  await assert.rejects(restarted.audioPath(id), /不完整/);
  assert.equal((await restarted.list()).length, 1);
});

test("container repair failure keeps the original assembled audio and fragments", async t => {
  const { directory, store } = await fixture(t, { ffmpegPath: process.execPath });
  const { id } = await store.create({});await store.append(id,0,body("original recording"));
  // Node rejects ffmpeg arguments, simulating a missing/broken repair runtime.
  const file=await store.audioPath(id);
  assert.match(file,/assembled-1\.webm$/);
  assert.equal(await fs.readFile(file,"utf8"),"original recording");
  assert.equal(await fs.readFile(path.join(directory,id,"00000000.part"),"utf8"),"original recording");
});
