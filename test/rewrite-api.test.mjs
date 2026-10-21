import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SettingsStore } from "../settings-store.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function listen(server) { server.listen(0, "127.0.0.1"); await once(server, "listening"); return server.address().port; }

test("rewrite HTTP API supports DeepSeek and OpenAI schemas, resume persistence and formatted Word export", { timeout: 30_000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lilith-rewrite-api-"));
  const requests = [];
  const model = http.createServer(async (req, res) => {
    try {
      const buffers = []; for await (const chunk of req) buffers.push(chunk);
      const body = JSON.parse(Buffer.concat(buffers).toString("utf8")); requests.push(body);
      const user = (body.messages || body.input).find(message => message.role === "user").content;
      const system = body.instructions || body.messages[0].content;
      let output;
      if (system.includes("规划章节，不写正文")) {
        const blocks = JSON.parse(user.slice(user.lastIndexOf("原文块：\n") + 5));
        output = { title: "经验研究中的规则与参与", sections: [{ title: "规则的影响与解释边界", block_ids: blocks.map(block => block.id), key_points: ["限定因果强度", "保留例证"], protected_facts: ["【待确认】1996年"] }] };
      } else if (system.includes("你现在只审阅")) output = { issues: [] };
      else output = { written_text: `### 规则与解释\n\n${user.match(/<corrected_transcript>\n([\s\S]*?)\n<\/corrected_transcript>/)[1]}` };
      const content = JSON.stringify(output);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body.input ? { status: "completed", output_text: content, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } :
        { choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: { message: error.message } })); }
  });
  let app;
  t.after(async () => {
    if (app && app.exitCode === null) { const exited = once(app, "exit"); app.kill(); await exited; }
    model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const modelPort = await listen(model);
  const endpoint = `http://127.0.0.1:${modelPort}/model`;
  const store = new SettingsStore({ file: path.join(directory, "data", "settings.json") });
  await store.save({ deepseekApiKey: "test-only-key", deepseekTextEndpoint: endpoint, openaiApiKey: "test-only-key", openaiTextEndpoint: endpoint });
  const reservation = http.createServer(); const appPort = await listen(reservation); await new Promise(resolve => reservation.close(resolve));
  app = spawn(process.execPath, [path.join(root, "server.mjs")], { cwd: root, env: { ...process.env, PORT: String(appPort), CLASSMATE_DATA_DIR: path.join(directory, "data"), CLASSMATE_LOG_DIR: path.join(directory, "logs") }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; app.stdout.on("data", chunk => { output += chunk; }); app.stderr.on("data", chunk => { output += chunk; });
  const url = `http://127.0.0.1:${appPort}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (app.exitCode !== null) throw new Error(`Test app exited: ${output}`);
    if (await fetch(`${url}/api/health`).then(r => r.ok).catch(() => false)) { ready = true; break; }
    await sleep(50);
  }
  assert.ok(ready, output);
  const updateInfo = await fetch(`${url}/api/updates`).then(r => r.json());
  assert.equal(updateInfo.installed, false);
  assert.equal(updateInfo.status, "idle");
  const lease = await fetch(`${url}/api/client-activity`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "recording-client-test", kind: "live", dirty: true }) });
  assert.equal(lease.status, 200);
  const busyUpdate = await fetch(`${url}/api/updates`).then(r => r.json());
  assert.ok(busyUpdate.busyReasons.some(reason => reason.includes("实时录音尚未保存")));
  await fetch(`${url}/api/client-activity`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "recording-client-test", closed: true }) });
  const noInstaller = await fetch(`${url}/api/updates/install`, { method: "POST" });
  assert.equal(noInstaller.status, 409);
  const text = "规则可能影响参与，但不是唯一因素。两个村庄的筹资结果不同，不能直接推广到所有地区。相关政策年份为【待确认】1996年。";
  for (const provider of ["deepseek", "openai"]) {
    const input = { textProvider: provider, mode: "academic", text, background: "经验研究" };
    const response = await fetch(`${url}/api/rewrite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split("\n").map(JSON.parse);
    assert.ok(!events.some(event => event.type === "error"), JSON.stringify(events));
    assert.equal(events.at(-1).type, "done");
    const final = events.find(event => event.type === "final").written_text;
    assert.match(final, /^# 经验研究中的规则与参与/);
    assert.match(final, /### 1\.1 规则与解释/);
    assert.match(final, /【待确认】1996年/);
    const checkpoint = events.find(event => event.type === "plan").lecturePlan;
    const completedChunks = events.filter(event => event.type === "chunk").map(event => event.written_text);
    const task = { proseMode: "academic", proseLecturePlan: checkpoint, proseChunks: completedChunks, proseText: final };
    const save = await fetch(`${url}/api/tasks/task-rewrite-test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(task) });
    assert.equal(save.status, 200);
    const saved = await fetch(`${url}/api/tasks/task-rewrite-test`).then(r => r.json());
    assert.deepEqual(saved.proseLecturePlan, checkpoint);
    const previousRequests = requests.length;
    const resumed = await fetch(`${url}/api/rewrite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, lecturePlan: saved.proseLecturePlan, completedChunks: saved.proseChunks, completedIndices: [0] }) });
    const resumedEvents = (await resumed.text()).trim().split("\n").map(JSON.parse);
    assert.equal(resumedEvents.find(event => event.type === "final").written_text, final);
    assert.equal(requests.length, previousRequests);
    const docx = await fetch(`${url}/api/export/docx`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "备用标题", text: final, format: "markdown" }) });
    assert.equal(docx.status, 200);
    const xml = Buffer.from(await docx.arrayBuffer()).toString("utf8");
    assert.match(xml, /w:outlineLvl/); assert.doesNotMatch(xml, /###|备用标题/);
  }
  const schemas = requests.filter(request => request.input).map(request => request.text.format.schema);
  assert.ok(schemas.some(schema => schema.properties.sections));
  assert.ok(schemas.some(schema => schema.properties.issues));
  assert.ok(schemas.some(schema => schema.properties.written_text));
  const invalid = await fetch(`${url}/api/rewrite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "unknown", text }) });
  assert.equal(invalid.status, 400);
});
