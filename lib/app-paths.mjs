import os from "node:os";
import path from "node:path";
import fs from "node:fs";

function configuredPath(value, fallback) {
  return value ? path.resolve(String(value)) : fallback;
}

export function appStoragePaths(root, options = {}) {
  const platform = options.platform || process.platform;
  const environment = options.environment || process.env;
  const home = options.home || os.homedir();
  const macSupport = path.join(home, "Library", "Application Support", "Classmate Lilith");
  const macLogs = path.join(home, "Library", "Logs", "Classmate Lilith");
  const installed = platform === "win32" && (options.installed ?? fs.existsSync(path.join(root, "installation.json")));
  const windowsSupport = path.join(environment.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Classmate Lilith");

  const defaultData = platform === "darwin" ? path.join(macSupport, "data") : path.join(installed ? windowsSupport : root, "data");
  const defaultLogs = platform === "darwin" ? macLogs : path.join(installed ? windowsSupport : root, "logs");
  return {
    installed,
    dataDir: configuredPath(environment.CLASSMATE_DATA_DIR, defaultData),
    logsDir: configuredPath(environment.CLASSMATE_LOG_DIR, defaultLogs)
  };
}
