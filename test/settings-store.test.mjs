import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SettingsStore } from "../settings-store.mjs";

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "classmate-lilith-settings-"));
  return {
    directory,
    file: path.join(directory, "settings.json"),
    legacyFile: path.join(directory, "legacy.json")
  };
}

test("blank secret updates preserve the saved credential", async (t) => {
  const paths = await fixture();
  t.after(() => fs.rm(paths.directory, { recursive: true, force: true }));
  const store = new SettingsStore(paths);
  await store.save({ deepseekApiKey: "saved-secret" });
  await store.save({ deepseekApiKey: "" });
  assert.equal((await store.load()).deepseekApiKey, "saved-secret");
});

test("clearProvider actually removes credentials", async (t) => {
  const paths = await fixture();
  t.after(() => fs.rm(paths.directory, { recursive: true, force: true }));
  const store = new SettingsStore(paths);
  await store.save({ deepseekApiKey: "saved-secret", openaiApiKey: "other-secret" });
  await store.clearProvider("deepseek");
  const settings = await store.load();
  assert.equal(settings.deepseekApiKey, "");
  assert.equal(settings.openaiApiKey, "other-secret");
});

test("legacy credentials migrate once and are not resurrected", async (t) => {
  const paths = await fixture();
  t.after(() => fs.rm(paths.directory, { recursive: true, force: true }));
  await fs.writeFile(paths.legacyFile, JSON.stringify({ deepseek_api_key: "legacy-secret" }), "utf8");
  const store = new SettingsStore(paths);
  await store.initialize();
  assert.equal((await store.load()).deepseekApiKey, "legacy-secret");
  await store.clearProvider("deepseek");
  await store.initialize();
  assert.equal((await store.load()).deepseekApiKey, "");
});

test("public settings never expose secret values", async (t) => {
  const paths = await fixture();
  t.after(() => fs.rm(paths.directory, { recursive: true, force: true }));
  const store = new SettingsStore(paths);
  await store.save({ alibabaApiKey: "secret" });
  const view = store.publicView(await store.load());
  assert.equal(view.alibabaApiKey, "");
  assert.equal(view.saved.alibabaApiKey, true);
});

test("legacy DashScope endpoint migrates to the Qianwen API platform", async (t) => {
  const paths = await fixture();
  t.after(() => fs.rm(paths.directory, { recursive: true, force: true }));
  const store = new SettingsStore(paths);
  await store.save({ alibabaEndpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions" });
  await store.initialize();
  assert.equal((await store.load()).alibabaEndpoint, "https://maas.qianwenaiapi.com/compatible-mode/v1/chat/completions");
});

test("shortcut preferences persist custom and cleared bindings", async (t) => {
  const paths = await fixture();
  t.after(() => fs.rm(paths.directory, { recursive: true, force: true }));
  const store = new SettingsStore(paths);
  await store.save({ shortcutsEnabled: "false", shortcutTogglePlayback: "Control+P", shortcutApplyCurrent: "" });
  const settings = await store.load();
  assert.equal(settings.shortcutsEnabled, "false");
  assert.equal(settings.shortcutTogglePlayback, "Control+P");
  assert.equal(settings.shortcutApplyCurrent, "");
});

test("Tencent AppID is portable configuration and is removed with Tencent credentials", async (t) => {
  const paths = await fixture();
  t.after(() => fs.rm(paths.directory, { recursive: true, force: true }));
  const store = new SettingsStore(paths);
  await store.save({ tencentAppId: "1250000000", tencentSecretId: "id", tencentSecretKey: "key" });
  const view = store.publicView(await store.load());
  assert.equal(view.tencentAppId, "1250000000");
  assert.equal(view.tencentSecretId, "");
  await store.clearProvider("tencent");
  const cleared = await store.load();
  assert.equal(cleared.tencentAppId, "");
  assert.equal(cleared.tencentSecretId, "");
  assert.equal(cleared.tencentSecretKey, "");
});
