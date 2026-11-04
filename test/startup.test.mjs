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
import { createWorkspaceGate, resultValidity } from "../public/modules/workspace-lifecycle.js";
import { processingActionLabel } from "../public/modules/workspace-flow.js";
import { copyDocumentText, fetchWordDocument } from "../public/modules/document-actions.js";

test("page initialization binds history and all export buttons and loads online settings", async () => {
  const source = (await fs.readFile(new URL("../public/app.js", import.meta.url), "utf8")).replace(/^import .*;\r?\n/gm, "");
  const elements = new Map();
  function element() {
    return { value: "", textContent: "", hidden: true, style: {}, dataset: {},
      addEventListener() {}, setAttribute() {}, classList: { add() {}, remove() {}, toggle() {} } };
  }
  const exports = ["txt", "md", "docx"].map(format => ({ ...element(), dataset: { proseExport: format } }));
  const requests = [];
  const context = vm.createContext({
    crypto: webcrypto, freshState, restoreTaskState, TASK_SCHEMA_VERSION, DEFAULT_SHORTCUTS, TextDecoder, URLSearchParams,
    assembleLecture, proseMarkdown, prosePlainText,
    initWindowsUpdates() {},
    ONLINE_TRANSCRIPTION_PROVIDERS, configuredProviderCount, preferredOnlineProvider, providerConfigured,
    combineGlossary: () => "", createSaveQueue, readNdjson, createWorkspaceGate, resultValidity,
    createDialogFocus:()=>({open(){},close(){}}),renderDocumentPreview(){},
    installWorkspaceFlow:()=>null,processingActionLabel,copyDocumentText,fetchWordDocument,
    setTimeout: () => 1, clearTimeout() {},
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
  assert.equal(typeof elements.get("#importTextButton").onclick, "function");
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

  vm.runInContext('state.running=true',context);
  const owner=vm.runInContext('state.taskId',context);
  assert.equal(await vm.runInContext('newTask()',context),false);
  assert.equal(vm.runInContext('state.taskId',context),owner);
  vm.runInContext('state.running=false;state.projectTitle="固定工程名";resetResults()',context);
  assert.equal(vm.runInContext('state.projectTitle',context),"固定工程名");
  context.fetch=async()=>({ok:false});
  vm.runInContext('state.workingText="不能丢失的修改"',context);
  assert.equal(await vm.runInContext('newTask()',context),false);
  assert.equal(vm.runInContext('state.workingText',context),"不能丢失的修改");
  context.fetch=async()=>({ok:true});
  vm.runInContext('globalThis.classmatePrepareExit()',context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(context.classmateExitStatus,"ready");
  assert.equal(vm.runInContext('workspaceChanging',context),true);
  vm.runInContext('globalThis.classmateCancelExit();state.proseRunning=true;globalThis.classmatePrepareExit()',context);
  assert.equal(context.classmateExitStatus,"blocked");
  vm.runInContext('state.proseRunning=false',context);
  let navigated="";
  context.location={set href(value){assert.equal(vm.runInContext('workspaceChanging',context),false,"owned navigation must wait until the save gate releases");navigated=value}};
  await elements.get("#liveTranscriptionButton").onclick({preventDefault(){}});
  assert.match(navigated,/^\/live\.html\?returnTask=/);
  let resolvePoll;
  context.fetch=()=>new Promise(resolve=>resolvePoll=resolve);
  const poll=vm.runInContext('activeTranscriptionId="job-old";state.transcriptionDraft="保留草稿";pollTranscription()',context);
  vm.runInContext('activeTranscriptionId=null',context);
  resolvePoll({ok:true,json:async()=>({status:"completed",result:{text:"迟到的结果"}})});await poll;
  assert.equal(vm.runInContext('state.transcriptionDraft',context),"保留草稿");
  context.fetch=async()=>{throw Error("temporary")};
  await vm.runInContext('activeTranscriptionId="job-retry";pollTranscription()',context);
  assert.equal(vm.runInContext('activeTranscriptionId',context),"job-retry");

  // A file read owns the workspace until it either commits the text or fails.
  context.confirm=()=>true;
  vm.runInContext('activeTranscriptionId=null;state.running=false;state.proseRunning=false;workspaceChanging=false;el.sourceText.value="保留原文"',context);
  let finishRead;
  context.importFile={size:10,text:()=>new Promise(resolve=>finishRead=resolve)};
  const reading=vm.runInContext('importTextFile(importFile)',context);
  assert.equal(vm.runInContext('workspaceBusy()',context),true);
  assert.equal(await vm.runInContext('newTask()',context),false);
  assert.equal(elements.get("#sourceText").value,"保留原文");
  finishRead("新导入文字");assert.equal(await reading,true);
  assert.equal(elements.get("#sourceText").value,"新导入文字");
  assert.equal(vm.runInContext('workspaceBusy()',context),false);
  context.importFile={size:10,text:async()=>{throw Error("模拟读取失败")}};
  assert.equal(await vm.runInContext('importTextFile(importFile)',context),false);
  // Export completion must keep the requested document's name and content even
  // when a different project is opened before the Word response arrives.
  context.confirm=()=>true;context.downloads=[];context.wordRequests=[];
  vm.runInContext('download=(...args)=>downloads.push(args);state.projectTitle="导出时的工程";state.workingText="导出时的内容";state.status="completed";state.reviewSourceHash=reviewInputHash()',context);
  let finishWord;
  context.fetch=(url,options)=>{context.wordRequests.push({url,body:JSON.parse(options.body)});return new Promise(resolve=>finishWord=resolve)};
  const exporting=vm.runInContext('exportResult("docx")',context);
  assert.equal(vm.runInContext('exportingReview',context),true);
  assert.equal(await vm.runInContext('exportResult("docx")',context),false);
  vm.runInContext('state.taskId="task-other-export";state.projectTitle="另一个工程";state.workingText="后来的修改"',context);
  finishWord({ok:true,blob:async()=>new Blob(["synthetic docx"])});assert.equal(await exporting,true);
  assert.equal(context.wordRequests.length,1);assert.equal(context.wordRequests[0].body.text,"导出时的内容");
  assert.equal(context.downloads[0][3],"导出时的工程-校订稿");
  context.fetch=async()=>{throw Error("offline")};
  assert.equal(await vm.runInContext('exportResult("docx")',context),false);
  assert.equal(elements.get("#reviewDocumentStatus").dataset.state,"error");
  assert.equal(elements.get("#downloadResult").disabled,false);
  assert.equal(vm.runInContext('state.workingText',context),"后来的修改");
  context.navigator={clipboard:{writeText:async()=>{throw Error("denied")}}};
  assert.equal(await vm.runInContext('copyTextAction("示例","已复制","prose")',context),false);
  assert.equal(elements.get("#proseDocumentStatus").dataset.state,"error");
  context.copied=[];context.navigator.clipboard.writeText=async text=>context.copied.push(text);
  vm.runInContext('state.proseText="## **标题**\\n正文"',context);
  await elements.get("#copyProse").onclick();await elements.get("#copyProsePlain").onclick();
  assert.deepEqual(context.copied,["## **标题**\n正文","标题\n正文"]);
  elements.get("#proseText").value="";elements.get("#proseText").oninput();
  assert.equal(elements.get("#copyProse").disabled,true);assert.equal(elements.get("#exportProse").disabled,true);
  vm.runInContext('renderProse()',context);assert.equal(elements.get("#proseResult").hidden,false,"empty manual editing must retain its editing surface");
  assert.equal(elements.get("#sourceText").value,"新导入文字");
  assert.match(elements.get("#textImportStatus").textContent,/已有原文未改变/);
  assert.equal(elements.get("#sourceText").readOnly,false);
  context.importFile={size:0,text:async()=>""};
  assert.equal(await vm.runInContext('importTextFile(importFile)',context),false);
  assert.equal(elements.get("#sourceText").value,"新导入文字");
  context.confirm=()=>false;
  context.importFile={size:10,text:()=>assert.fail("cancelled replacement must not read the file")};
  assert.equal(await vm.runInContext('importTextFile(importFile)',context),false);
});
