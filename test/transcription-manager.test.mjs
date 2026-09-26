import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TranscriptionManager } from "../transcription-worker.mjs";

test("transcription manager accepts only online providers", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lilith-online-asr-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manager = new TranscriptionManager({ appRoot: root, dataDir: path.join(root, "data") });
  await manager.initialize();
  await assert.rejects(() => manager.start({ engine: "whisper", sourcePath: "unused" }), /在线转写服务/);
  assert.equal(typeof manager.capabilities, "undefined");
  assert.equal(typeof manager.runWhisper, "undefined");
  assert.equal(typeof manager.runParaformer, "undefined");
  assert.equal(typeof manager.runQwen, "undefined");
});

test("realtime result becomes a durable transcription job with playable audio and SRT", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lilith-live-asr-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, "data");
  const manager = new TranscriptionManager({ appRoot: root, dataDir });
  await manager.initialize();
  const recording = path.join(dataDir, "transcriptions", "uploads", "upload-test.webm");
  await fs.writeFile(recording, Buffer.from("test recording"));
  const job = await manager.importLiveResult({
    sourcePath: recording, originalName: "课堂实时录音.webm", engine: "alibaba", language: "zh",
    text: "第一句话。\n第二句话。", durationMs: 2400,
    segments: [
      { startMs: 0, endMs: 1200, text: "第一句话。" },
      { startMs: 1200, endMs: 2400, text: "第二句话。" }
    ]
  });
  assert.equal(job.status, "completed");
  assert.match(job.result.srt, /00:00:00,000 --> 00:00:01,200/);
  assert.equal(await manager.audioPath(job.id), recording);
  const removed = await manager.remove(job.id);
  assert.equal(removed.audioDeleted, true);
  await assert.rejects(fs.access(recording));
});
