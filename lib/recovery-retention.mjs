import fs from "node:fs/promises";
import path from "node:path";

const RECOVERY_FILE = /^response-[a-zA-Z0-9_.-]+\.json$/;

export async function pruneRecoveryFiles(directory, { maxAgeDays = 30, maxFiles = 100, now = Date.now() } = {}) {
  await fs.mkdir(directory, { recursive: true });
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !RECOVERY_FILE.test(entry.name)) continue;
    const file = path.join(directory, entry.name);
    const stat = await fs.stat(file);
    files.push({ file, mtimeMs: stat.mtimeMs });
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const oldestAllowed = now - Math.max(1, maxAgeDays) * 86_400_000;
  const expired = files.filter((item, index) => index >= Math.max(1, maxFiles) || item.mtimeMs < oldestAllowed);
  await Promise.all(expired.map((item) => fs.unlink(item.file).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  })));
  return { kept: files.length - expired.length, removed: expired.length };
}
