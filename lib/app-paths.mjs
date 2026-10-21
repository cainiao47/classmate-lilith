import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

function configuredPath(value, fallback) {
  return value ? path.resolve(String(value)) : fallback;
}

function windowsDocumentsDirectory() {
  // Use the Windows known folder, not a hard-coded home/Documents path:
  // Documents may be redirected to another drive or managed by OneDrive.
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const command = "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); [Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments)";
  try {
    const result = execFileSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", windowsHide: true, timeout: 5000 }).replace(/^\uFEFF/, "").trim();
    if (path.isAbsolute(result)) return result;
  } catch { /* Report a visible error rather than starting with a wrong empty data directory. */ }
  throw new Error("无法定位系统文档文件夹，请从已安装的 Classmate Lilith 快捷方式启动。");
}

export function appStoragePaths(root, options = {}) {
  const platform = options.platform || process.platform;
  const environment = options.environment || process.env;
  const home = options.home || os.homedir();
  const macSupport = path.join(home, "Library", "Application Support", "Classmate Lilith");
  const macLogs = path.join(home, "Library", "Logs", "Classmate Lilith");
  const installed = platform === "win32" && (options.installed ?? fs.existsSync(path.join(root, "installation.json")));
  const documents = options.documents || environment.CLASSMATE_DOCUMENTS_DIR ||
    (installed && (!environment.CLASSMATE_DATA_DIR || !environment.CLASSMATE_LOG_DIR) ? windowsDocumentsDirectory() : path.join(home, "Documents"));
  const windowsSupport = path.join(documents, "Classmate Lilith");

  const defaultData = platform === "darwin" ? path.join(macSupport, "data") : path.join(installed ? windowsSupport : root, "data");
  const defaultLogs = platform === "darwin" ? macLogs : path.join(installed ? windowsSupport : root, "logs");
  return {
    installed,
    dataDir: configuredPath(environment.CLASSMATE_DATA_DIR, defaultData),
    logsDir: configuredPath(environment.CLASSMATE_LOG_DIR, defaultLogs)
  };
}
