import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("HTTP history, trash and recording recovery survive service termination with no model calls", { timeout: 30_000 }, async t => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lilith-storage-api-"));
  const reservation = http.createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  let child, cookie;
  async function stop() { if (child && child.exitCode === null) { const done = once(child, "exit"); child.kill(); await done; } }
  t.after(async () => { await stop(); await fs.rm(directory, { recursive: true, force: true }); });
  async function start() {
    child = spawn(process.execPath, [path.join(root, "server.mjs")], { cwd: root, windowsHide: true, stdio: "ignore",
      env: { ...process.env, PORT: String(port), CLASSMATE_DATA_DIR: path.join(directory, "data"), CLASSMATE_LOG_DIR: path.join(directory, "logs") } });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw Error("Isolated service exited unexpectedly");
      if (await fetch(`${origin}/api/health`).then(r => r.ok).catch(() => false)) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.equal(ready, true);
    const index = await fetch(origin); cookie = index.headers.get("set-cookie").split(";")[0];
  }
  async function request(target, method = "GET", body) {
    const response = await fetch(origin + target, { method, headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body && JSON.stringify(body) });
    const payload = await response.json();
    assert.equal(response.ok, true, payload.error);
    return payload;
  }
  await start();
  assert.equal((await fetch(origin + "/api/live-recordings")).status, 403);
  for (let index = 0; index < 55; index++) await request(`/api/tasks/task-api-${index}`, "POST", { title: index === 0 ? "早期可搜索课堂" : `课堂 ${index}`, sourceText: "示例" });
  assert.equal((await request("/api/tasks?page=3&pageSize=20")).tasks.length, 15);
  const found = await request("/api/tasks?q=" + encodeURIComponent("早期"));
  assert.equal(found.total, 1); assert.equal(found.tasks[0].id, "task-api-0");
  const version = await request("/api/tasks/task-api-0/versions", "POST", { workingText: "版本正文" });
  assert.equal((await request("/api/tasks/task-api-0", "DELETE")).trashed, true);
  assert.equal((await fetch(origin + "/api/tasks/task-api-0", { headers: { Cookie: cookie } })).status, 410);
  assert.equal((await request("/api/tasks/trash")).total, 1);
  await request("/api/tasks/task-api-0/restore-deleted", "POST");
  assert.equal((await request(`/api/tasks/task-api-0/versions/${version.id}`)).workingText, "版本正文");

  const recording = await request("/api/live-recordings", "POST", { extension: "webm", topic: "异常恢复示例" });
  const sendPart = data => fetch(`${origin}/api/live-recordings/${recording.id}/chunks/0`, { method: "POST", headers: { Cookie: cookie }, body: data });
  assert.equal((await sendPart("synthetic-audio-header")).status, 200);
  assert.equal((await sendPart("synthetic-audio-header")).status, 200);
  assert.equal((await sendPart("different")).status, 409);
  await request(`/api/live-recordings/${recording.id}`, "PATCH", { text: "最近确认的文稿", topic: "恢复主题", durationMs: 1200, phase: "recording" });
  await stop(); await start();
  assert.equal((await request("/api/live-recordings")).recordings[0].id, recording.id);
  const restored = await request(`/api/live-recordings/${recording.id}`);
  assert.equal(restored.text, "最近确认的文稿"); assert.equal(restored.persistedChunks, 1);
  const audio = await fetch(`${origin}/api/live-recordings/${recording.id}/audio`, { headers: { Cookie: cookie, Range: "bytes=0-8" } });
  assert.equal(audio.status, 206); assert.equal(await audio.text(), "synthetic");
  // Archive only after a real durable task references this recovery and audio.
  const complete = await fetch(`${origin}/api/live-recordings/${recording.id}/complete`, { method: "POST", headers: { Cookie: cookie }, body: JSON.stringify({ taskId: "task-api-0" }) });
  assert.equal(complete.status, 409);
  const uploaded = await fetch(`${origin}/api/transcription/upload?filename=recovery.webm`, { method: "POST", headers: { Cookie: cookie }, body: "synthetic-audio-header" }).then(r => r.json());
  const job = await request("/api/transcription/live-result", "POST", { engine: "alibaba", text: "", sourcePath: uploaded.filePath });
  await request("/api/tasks/task-recovered-api", "POST", { title: "恢复工程", sourceText: "", liveRecordingRecoveryId: recording.id, transcriptionMeta: { jobId: job.id } });
  await request(`/api/live-recordings/${recording.id}/complete`, "POST", { taskId: "task-recovered-api" });
  assert.equal((await request("/api/live-recordings")).recordings.length, 0);
  await request("/api/tasks/task-recovered-api", "DELETE");
  await stop(); await start();
  assert.equal((await request("/api/tasks/trash")).total, 1);
  await request("/api/tasks/task-recovered-api/restore-deleted", "POST");
  const retained = await fetch(`${origin}/api/transcription/jobs/${job.id}/audio`, { headers: { Cookie: cookie } });
  assert.equal(await retained.text(), "synthetic-audio-header");
});
