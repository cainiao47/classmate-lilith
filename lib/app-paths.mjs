import os from "node:os";
import path from "node:path";

function configuredPath(value, fallback) {
  return value ? path.resolve(String(value)) : fallback;
}

export function appStoragePaths(root, options = {}) {
  const platform = options.platform || process.platform;
  const environment = options.environment || process.env;
  const home = options.home || os.homedir();
  const macSupport = path.join(home, "Library", "Application Support", "Classmate Lilith");
  const macLogs = path.join(home, "Library", "Logs", "Classmate Lilith");

  const defaultData = platform === "darwin" ? path.join(macSupport, "data") : path.join(root, "data");
  const defaultLogs = platform === "darwin" ? macLogs : path.join(root, "logs");
  return {
    dataDir: configuredPath(environment.CLASSMATE_DATA_DIR, defaultData),
    logsDir: configuredPath(environment.CLASSMATE_LOG_DIR, defaultLogs)
  };
}
