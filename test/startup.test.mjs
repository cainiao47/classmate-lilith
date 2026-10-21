import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { freshState, restoreTaskState, TASK_SCHEMA_VERSION } from "../public/modules/task-state.js";
import { DEFAULT_SHORTCUTS } from "../public/modules/shortcuts.js";
import { ONLINE_TRANSCRIPTION_PROVIDERS, configuredProviderCount, preferredOnlineProvider, providerConfigured } from "../public/modules/online-providers.js";
import { assembleLecture, proseMarkdown, prosePlainText } from "../public/modules/prose-format.js";
import { createSaveQueue } from "../public/modules/save-queue.js";
import { readNdjson } from "../public/modules/ndjson-stream.js";

test("page initialization binds history and all export buttons and loads online settings", async () => {
  const source = (await fs.readFile(new URL("../public/app.js", import.meta.url), "utf8")).replace(/^import .*;\r?\n/gm, "");
  const elements = new Map();
  function element() {
    return { value: "", textContent: "", hidden: true, style: {}, dataset: {},
      addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} } };
  }
  const exports = ["txt", "md", "docx"].map(format => ({ ...element(), dataset: { proseExport: format } }));
  const requests = [];
  const context = vm.createContext({
    crypto: webcrypto, freshState, restoreTaskState, TASK_SCHEMA_VERSION, DEFAULT_SHORTCUTS, TextDecoder,
    assembleLecture, proseMarkdown, prosePlainText,
    initWindowsUpdates() {},
    ONLINE_TRANSCRIPTION_PROVIDERS, configuredProviderCount, preferredOnlineProvider, providerConfigured,
    combineGlossary: () => "", createSaveQueue, readNdjson, setTimeout: () => 1, clearTimeout() {},
    document: {
      querySelector(selector) {
        if (selector === "[data-prose-export]") return exports[0];
        if (!elements.has(selector)) elements.set(selector, element());
        return elements.get(selector);
      },
      querySelectorAll: selector => selector === "[data-prose-export]" ? exports : [],
      addEventListener() {}
    },
    fetch(url) { requests.push(url); return new Promise(() => {}); }
  });
  const broken = source.replace('$$("[data-prose-export]").forEach', '$("[data-prose-export]").forEach');
  assert.throws(() => vm.runInContext(broken, vm.createContext({ ...context })), /forEach is not a function/);
  vm.runInContext(source, context);
  assert.equal(typeof elements.get("#historyButton").onclick, "function");
  assert.equal(typeof elements.get("#newTaskButton").onclick, "function");
  assert.ok(exports.every(button => typeof button.onclick === "function"));
  assert.ok(requests.includes("/api/settings"));
  assert.ok(!requests.includes("/api/transcription/capabilities"));
  assert.ok(!requests.includes("/api/components"));

  const plan = { version: 1, digest: "example", plan: { title: "讲座标题", sections: [{ title: "理论与例证" }] }, items: [{ sectionIndex: 0 }] };
  const events = [
    { type: "plan", lecturePlan: plan }, { type: "start", total: 1, completed: [], chunks: [""] },
    { type: "usage", usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
    { type: "chunk", index: 0, total: 1, written_text: "### 概念\n保留限定条件。" },
    { type: "done" }
  ];
  context.response = new Response(events.map(JSON.stringify).join("\n")); // Also exercise an unterminated last line.
  await vm.runInContext("consumeProse(response)", context);
  assert.match(vm.runInContext("state.proseText", context), /### 1\.1 概念/);
  assert.equal(vm.runInContext("state.proseUsage.total_tokens", context), 15);
  assert.equal(vm.runInContext("JSON.stringify(taskData().proseLecturePlan)", context), JSON.stringify(plan));
  context.response = new Response(JSON.stringify({ type: "stage", stage: "还未完成" }) + "\n");
  await assert.rejects(vm.runInContext("consumeProse(response)", context), /连接提前结束/);

  const writes = [];
  context.fetch = (url, options) => new Promise(resolve => { writes.push({ url, body: JSON.parse(options.body), resolve }); });
  const firstSave = vm.runInContext('state.workingText="较早的修改";queueSave();saveTask(true)', context);
  await new Promise(resolve => setImmediate(resolve));
  const latestSave = vm.runInContext('state.workingText="安装前最后的修改";queueSave();saveTask(true)', context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes.length, 1, "autosave writes must not race with the final save before updating");
  writes[0].resolve({ ok: true }); await firstSave;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes.length, 2);
  assert.equal(writes[1].body.workingText, "安装前最后的修改");
  writes[1].resolve({ ok: true }); await latestSave;
  assert.equal(vm.runInContext("savedRevision===taskRevision", context), true);
});
