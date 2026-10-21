import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
const css = await fs.readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const liveHtml = await fs.readFile(new URL("../public/live.html", import.meta.url), "utf8");
const liveCss = await fs.readFile(new URL("../public/live.css", import.meta.url), "utf8");
const launcher = await fs.readFile(new URL("../launcher/Launcher.cs", import.meta.url), "utf8");

test("page IDs remain unique after settings layout changes", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test("recording and review areas expose provider-aware account status queries", () => {
  assert.match(html, /id="queryAsrAccountStatus"/);
  assert.match(html, /id="asrAccountStatusValue"/);
  assert.match(html, /id="queryTextAccountStatus"/);
  assert.match(html, /id="reviewAccountStatusValue"/);
  assert.match(html, /id="settingsTextAccountStatusButton"/);
  assert.match(html, /<span class="step">3<\/span>\s*<div><h2>粘贴转写稿<\/h2>/);
});

test("project actions are grouped with history at the far right", () => {
  assert.match(html, /id="apiSettingsButton" class="header-button settings-action"/);
  assert.match(html, /class="project-actions"[\s\S]*?id="newTaskButton"[\s\S]*?id="saveVersionButton"[\s\S]*?id="historyButton"/);
  assert.match(html, />新建工程<|>＋<\/span>新建工程/);
  assert.match(html, />保存工程版本</);
  assert.match(html, /工程历史/);
  assert.doesNotMatch(html, /本地运行|local-badge/);
  assert.match(css, /\.header-button\.settings-action/);
  assert.match(css, /\.header-button\.save-project-action/);
});

test("history drawer exposes prominent project cards and a reusable naming dialog", () => {
  assert.match(html, /id="historyDrawer"[\s\S]*?<h2>工程历史<\/h2>/);
  assert.match(html, /当前工程的保存版本/);
  assert.match(html, /id="nameDialog"/);
  assert.match(html, /id="nameDialogInput"/);
  assert.match(css, /\.project-history-item \{ min-height: 88px;/);
  assert.match(css, /\.history-item \{[^}]*border: 1\.5px solid/);
  assert.match(css, /\.item-action-menu/);
});

test("review settings keep the heading aligned with the compact balance card", () => {
  assert.match(css, /\.settings-card > \.section-title \{ grid-column: 1 \/ 3; grid-row: 1;/);
  assert.match(css, /\.settings-card > \.context-group > \.settings-group-heading \{ grid-column: 1 \/ -1; \}/);
  assert.match(css, /\.settings-card > \.context-group > \.field input,[\s\S]*?\.field textarea \{ height: 70px; min-height: 70px; max-height: 70px; \}/);
});

test("proofreading mode sits beside the editor execution controls", () => {
  assert.doesNotMatch(html, /class="settings-group mode-group"/);
  assert.match(html, /class="editor-mode-control"[\s\S]*?name="mode"[\s\S]*?id="polishButton"/);
  assert.match(css, /\.editor-mode-picker \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.editor-execution-row \{ display: flex;/);
});

test("launcher bypasses proxy for localhost and can recover the workspace", () => {
  assert.match(launcher, /request\.Proxy = null;/);
  assert.match(launcher, /Environment\.SetEnvironmentVariable\("NO_PROXY", "127\.0\.0\.1,localhost", EnvironmentVariableTarget\.Process\);/);
  assert.doesNotMatch(launcher, /info\.EnvironmentVariables/);
  assert.match(launcher, /private void OpenWorkspace\(\)/);
  assert.doesNotMatch(launcher, /\?open=/);
});

test("Windows launcher hosts the workspace in a dedicated WebView2 window", () => {
  assert.match(launcher, /Microsoft\.Web\.WebView2\.WinForms/);
  assert.match(launcher, /sealed class WorkspaceForm : Form/);
  assert.match(launcher, /disable-background-timer-throttling/);
  assert.match(launcher, /CoreWebView2PermissionKind\.Microphone/);
  assert.match(launcher, /已缩到系统托盘/);
  assert.match(launcher, /DwmCaptionColor/);
});

test("Windows launcher persists its shutdown credential without trusting a forgeable root header", () => {
  assert.match(launcher, /LoadOrCreateToken\(baseDir\)/);
  assert.match(launcher, /\.launcher-token/);
  assert.match(launcher, /X-Launcher-Token/);
  assert.doesNotMatch(launcher, /X-App-Root/);
});

test("first review-efficiency batch exposes playback follow, navigation, and shortcut settings", () => {
  assert.match(html, /id="followPlayback"/);
  assert.match(html, /id="previousReview"/);
  assert.match(html, /id="nextReview"/);
  assert.match(html, /id="shortcutsEnabled"/);
  assert.match(html, /id="shortcutBindings"/);
  assert.match(css, /\.transcription-segment\.playing/);
  assert.match(css, /\.issue-context-target/);
  assert.match(css, /\.source-highlight \{ background: #dce9e2/);
});

test("second batch exposes task terminology snapshots and the global library manager", () => {
  assert.match(html, /id="taskTerminologyGroups"/);
  assert.match(html, /id="refreshTerminologySnapshot"/);
  assert.match(html, /id="terminologyGroupSelect"/);
  assert.match(html, /id="terminologyTermList"/);
  assert.match(html, /id="importTerminology"/);
  assert.match(html, /id="exportTerminology"/);
  assert.match(css, /\.terminology-term-row/);
  assert.match(css, /\.add-term-library/);
});

test("written prose export offers text, Markdown, and Word formats", () => {
  assert.match(html, /id="proseExportMenu"/);
  assert.match(html, /data-prose-export="txt"/);
  assert.match(html, /data-prose-export="md"/);
  assert.match(html, /data-prose-export="docx"/);
});

test("runtime log is visible in the UI and explains the 20-file retention policy", () => {
  assert.match(html, /id="runtimeLogButton"/);
  assert.match(html, /id="runtimeLogDialog"/);
  assert.match(html, /id="runtimeLogText"/);
  assert.match(html, /最多保留最近 20 份/);
  assert.match(css, /\.runtime-log-text/);
});

test("transcription UI is online-only and exposes API configuration directly", () => {
  assert.match(html, /id="transcriptionEngine"/);
  assert.match(html, /id="transcriptionModel"/);
  assert.match(html, /id="transcriptionSettingsButton"/);
  assert.match(html, /在线转写服务/);
  assert.match(html, /千问录音模型/);
  assert.doesNotMatch(html, /id="transcriptionMode"/);
  assert.doesNotMatch(html, /id="offlineComponents"/);
  assert.doesNotMatch(html, /id="transcriptionBatch"/);
  assert.doesNotMatch(css, /\.offline-component-list/);
});

test("Lilith branding replaces the unused empty result card", () => {
  assert.match(html, /id="resultCard" class="result-card empty"/);
  assert.doesNotMatch(html, /id="emptyState"/);
  assert.doesNotMatch(html, /校订结果会出现在这里/);
  assert.match(html, /assets\/lilith-app-icon\.png/);
  assert.match(html, /href="\/favicon\.ico\?v=0\.21\.1"/);
  assert.match(css, /lilith-web-background-v1\.png/);
  assert.match(css, /\.result-card\.empty \{ display: none; \}/);
  assert.match(css, /width: min\(1240px, calc\(100% - 360px\)\)/);
});

test("realtime transcription has a dedicated cross-platform workspace and handoff actions", () => {
  assert.match(html, /<h2>从录音开始<\/h2>\s*<a id="liveTranscriptionButton"[^>]+href="\/live\.html"/);
  assert.match(html, /<h2>校订设置<\/h2><p>补充语境<\/p>/);
  assert.match(css, /\.live-entry-button \{[^}]+background: var\(--green\)/);
  assert.match(liveHtml, /id="liveMicrophone"/);
  assert.match(liveHtml, /id="liveExportTxt"/);
  assert.match(liveHtml, /id="liveExportMd"/);
  assert.match(liveHtml, /id="liveExportSrt"/);
  assert.match(liveHtml, /id="liveDownloadAudio"/);
  assert.match(liveHtml, /id="liveSaveTask"/);
  assert.match(liveHtml, /id="liveSendToReview"/);
  assert.match(liveCss, /\.live-shell/);
  assert.match(liveHtml, /qwen-audio-3\.0-asr-flash-streaming/);
  assert.match(liveHtml, /qwen-audio-3\.1-asr-flash-streaming/);
  assert.match(liveHtml, /fun-asr-realtime/);
});
