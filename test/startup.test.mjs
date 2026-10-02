import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { freshState, restoreTaskState, TASK_SCHEMA_VERSION } from "../public/modules/task-state.js";
import { DEFAULT_SHORTCUTS } from "../public/modules/shortcuts.js";
import { ONLINE_TRANSCRIPTION_PROVIDERS, configuredProviderCount, preferredOnlineProvider, providerConfigured } from "../public/modules/online-providers.js";
import { createSaveQueue } from "../public/modules/save-queue.js";

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
    crypto: webcrypto, freshState, restoreTaskState, TASK_SCHEMA_VERSION, DEFAULT_SHORTCUTS,
    ONLINE_TRANSCRIPTION_PROVIDERS, configuredProviderCount, preferredOnlineProvider, providerConfigured,
    combineGlossary: () => "", createSaveQueue, setTimeout: () => 1, clearTimeout() {},
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
});
