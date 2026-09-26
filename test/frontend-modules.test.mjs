import assert from "node:assert/strict";
import test from "node:test";
import { findIssueAudioCue, formatClock, parseSrtSegments, srtSeconds } from "../public/modules/srt.js";
import { freshState, restoreTaskState } from "../public/modules/task-state.js";
import { buildIssueContext } from "../public/modules/review-context.js";
import { DEFAULT_SHORTCUTS, displayShortcut, isReservedShortcut, shortcutFromEvent } from "../public/modules/shortcuts.js";
import { combineGlossary, createTerminologySnapshot, formatTerminologyPrompt } from "../public/modules/terminology.js";
import { configuredProviderCount, preferredOnlineProvider, providerConfigured } from "../public/modules/online-providers.js";

const SRT = `1
00:00:02,500 --> 00:00:05,000
第一次田野访谈

2
00:01:10,000 --> 00:01:13,000
第二次田野访谈
`;

test("SRT helpers preserve timing and choose the occurrence nearest the review anchor", () => {
  assert.equal(srtSeconds("00:01:10,000"), 70);
  assert.equal(formatClock(70), "01:10");
  assert.equal(parseSrtSegments(SRT).length, 2);
  const cue = findIssueAudioCue({ original: "田野访谈", globalStart: 90 }, SRT, "x".repeat(100));
  assert.equal(cue.start, 70);
});

test("restored tasks reset transient runtime state", () => {
  const state = restoreTaskState({ id: "task-example", running: true, proseRunning: true, proseStatus: "running", workingText: "正文" });
  assert.equal(state.taskId, "task-example");
  assert.equal(state.running, false);
  assert.equal(state.proseRunning, false);
  assert.equal(state.proseStatus, "paused");
  assert.equal(freshState().status, "draft");
});

test("new and restored tasks use an online transcription provider", () => {
  assert.equal(freshState().transcriptionEngine, "alibaba");
  assert.equal(restoreTaskState({ id: "legacy-task", transcriptionEngine: "whisper" }).transcriptionEngine, "alibaba");
});

test("online provider readiness requires complete credentials", () => {
  assert.equal(providerConfigured({ saved: { tencentSecretKey: true } }, "tencent"), false);
  assert.equal(providerConfigured({ saved: { tencentSecretId: true, tencentSecretKey: true } }, "tencent"), true);
  assert.equal(configuredProviderCount({ saved: { tencentSecretId: true, tencentSecretKey: true, alibabaApiKey: true } }), 2);
  assert.equal(preferredOnlineProvider("whisper", "openai"), "openai");
  assert.equal(preferredOnlineProvider("whisper", "whisper"), "alibaba");
});

test("issue context separates previous, current, target, and next sentences", () => {
  const text = "前一句。这里包含田野访谈，需要复听。后一句。";
  const start = text.indexOf("田野访谈");
  const context = buildIssueContext(text, start, start + 4);
  assert.equal(context.previous, "前一句。");
  assert.equal(context.before, "这里包含");
  assert.equal(context.target, "田野访谈");
  assert.equal(context.after, "，需要复听。");
  assert.equal(context.next, "后一句。");
});

test("shortcut helpers normalize keys and reject browser-reserved combinations", () => {
  assert.equal(shortcutFromEvent({ key: "ArrowDown", ctrlKey: false, altKey: true, shiftKey: false, metaKey: false, isComposing: false }), "Alt+ArrowDown");
  assert.equal(displayShortcut(DEFAULT_SHORTCUTS.applyCurrent), "Ctrl + Enter");
  assert.equal(isReservedShortcut("Control+W"), true);
  assert.equal(isReservedShortcut("F8"), false);
});

test("terminology snapshots include only selected enabled groups and remain independent", () => {
  const library = { groups: [{ id: "general", name: "通用" }, { id: "sociology", name: "社会学" }], terms: [
    { id: "1", canonical: "田野访谈", aliases: ["田野荡谈"], groupId: "sociology", enabled: true },
    { id: "2", canonical: "停用词", aliases: [], groupId: "sociology", enabled: false },
    { id: "3", canonical: "别组术语", aliases: [], groupId: "general", enabled: true }
  ] };
  const snapshot = createTerminologySnapshot(library, ["sociology"]);
  assert.deepEqual(snapshot.terms.map((term) => term.canonical), ["田野访谈"]);
  library.terms[0].canonical = "已修改";
  assert.equal(snapshot.terms[0].canonical, "田野访谈");
  assert.match(formatTerminologyPrompt(snapshot, "出现田野荡谈"), /田野访谈（常见误写\/别称：田野荡谈）/);
  assert.match(combineGlossary("梁漱溟", snapshot, "田野荡谈"), /^梁漱溟\n/);
});
