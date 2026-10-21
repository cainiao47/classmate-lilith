import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { appStoragePaths } from "../lib/app-paths.mjs";

test("Windows keeps portable data and logs beside the application", () => {
  const root = path.resolve("portable-app");
  const result = appStoragePaths(root, { platform: "win32", environment: {}, home: path.resolve("home") });
  assert.equal(result.dataDir, path.join(root, "data"));
  assert.equal(result.logsDir, path.join(root, "logs"));
});

test("Windows installed mode stores data under the actual Documents folder, separate from program files", () => {
  const documents = path.resolve("redirected-documents");
  const result = appStoragePaths(path.resolve("program"), { platform: "win32", installed: true, documents, environment: { LOCALAPPDATA: path.resolve("unused-local-profile") } });
  assert.equal(result.installed, true);
  assert.equal(result.dataDir, path.join(documents, "Classmate Lilith", "data"));
  assert.equal(result.logsDir, path.join(documents, "Classmate Lilith", "logs"));
});

test("Windows launcher-provided redirected Documents path is respected", () => {
  const documents = path.resolve("OneDrive", "文档");
  const result = appStoragePaths(path.resolve("program"), { platform: "win32", installed: true, environment: { CLASSMATE_DOCUMENTS_DIR: documents } });
  assert.equal(result.dataDir, path.join(documents, "Classmate Lilith", "data"));
  assert.equal(result.logsDir, path.join(documents, "Classmate Lilith", "logs"));
});

test("Windows explicit data and log overrides need no Documents discovery", () => {
  const dataDir = path.resolve("isolated", "data"), logsDir = path.resolve("isolated", "logs");
  const result = appStoragePaths(path.resolve("program"), { platform: "win32", installed: true, environment: { CLASSMATE_DATA_DIR: dataDir, CLASSMATE_LOG_DIR: logsDir } });
  assert.equal(result.dataDir, dataDir);
  assert.equal(result.logsDir, logsDir);
});

test("macOS stores mutable files outside the signed app bundle", () => {
  const root = path.resolve("Classmate Lilith.app", "Contents", "Resources", "app");
  const home = path.resolve("Users", "lilith");
  const result = appStoragePaths(root, { platform: "darwin", environment: {}, home });
  assert.equal(result.dataDir, path.join(home, "Library", "Application Support", "Classmate Lilith", "data"));
  assert.equal(result.logsDir, path.join(home, "Library", "Logs", "Classmate Lilith"));
  assert.equal(result.dataDir.startsWith(root), false);
});

test("launcher-provided storage paths override platform defaults", () => {
  const result = appStoragePaths("/app", {
    platform: "darwin",
    home: "/Users/lilith",
    environment: { CLASSMATE_DATA_DIR: "/tmp/lilith-data", CLASSMATE_LOG_DIR: "/tmp/lilith-logs" }
  });
  assert.equal(result.dataDir, path.resolve("/tmp/lilith-data"));
  assert.equal(result.logsDir, path.resolve("/tmp/lilith-logs"));
});
