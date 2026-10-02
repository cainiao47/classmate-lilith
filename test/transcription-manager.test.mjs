import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ONLINE_REQUEST_TIMEOUT_MS, TranscriptionManager } from "../transcription-worker.mjs";

test("online transcription allows three minutes for each provider response", () => {
  assert.equal(ONLINE_REQUEST_TIMEOUT_MS, 180_000);
});

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

test("online transcription retries only explicit rate limits", async () => {
  const manager = new TranscriptionManager({ appRoot: process.cwd(), dataDir: process.cwd() });
  const job = { cancelled: false, logs: [], abortController: new AbortController() };
  let attempts = 0;
  const result = await manager.withTransientRetry(job, async () => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error("rate limited");
      error.status = 429;
      throw error;
    }
    return { text: "恢复成功", segments: [] };
  }, 2);
  assert.equal(attempts, 2);
  assert.equal(result.text, "恢复成功");
  assert.match(job.logs.join("\n"), /自动重试/);
});

test("online transcription does not resubmit ambiguous provider failures", async () => {
  const manager = new TranscriptionManager({ appRoot: process.cwd(), dataDir: process.cwd() });
  const job = { cancelled: false, logs: [], abortController: new AbortController() };
  let attempts = 0;
  await assert.rejects(() => manager.withTransientRetry(job, async () => {
    attempts += 1;
    const error = new Error("provider failed after accepting the request");
    error.status = 503;
    throw error;
  }), /provider failed/);
  assert.equal(attempts, 1);
});

test("Alibaba file transcription sends the selected dialect model and glossary vocabulary", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lilith-alibaba-model-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const audioPath = path.join(root, "chunk.mp3");
  await fs.writeFile(audioPath, Buffer.from("audio"));
  const manager = new TranscriptionManager({ appRoot: root, dataDir: path.join(root, "data") });
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return { ok: true, status: 200, text: async () => JSON.stringify({ output: { output: { sentence: { text: "方言识别结果" } } } }) };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await manager.transcribeAlibaba({
    model: "qwen-audio-3.1-asr-flash", language: "zh", prompt: "梁漱溟，乡村建设",
    apiSettings: { alibabaApiKey: "test-key" }, abortController: new AbortController()
  }, audioPath, 1000, 60);

  assert.equal(result.text, "方言识别结果");
  assert.match(request.url, /multimodal-generation\/generation$/);
  assert.equal(request.body.model, "qwen-audio-3.1-asr-flash");
  assert.deepEqual(request.body.parameters.language_hints, ["zh"]);
  assert.deepEqual(request.body.parameters.vocabulary, { "梁漱溟": 5, "乡村建设": 5 });
  assert.equal(request.body.parameters.keep_dialect, true);
});
