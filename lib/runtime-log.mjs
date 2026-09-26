import fs from "node:fs/promises";
import path from "node:path";

const FILE_PATTERN = /^classmate-lilith-\d{8}-\d{6}-\d+\.log$/;

function stamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

function oneLine(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

export class RuntimeLog {
  constructor({ directory, maxFiles = 20, now = () => new Date(), pid = process.pid }) {
    this.directory = directory;
    this.maxFiles = maxFiles;
    this.now = now;
    this.pid = pid;
    this.file = null;
    this.pending = Promise.resolve();
  }

  async initialize() {
    await fs.mkdir(this.directory, { recursive: true });
    this.file = path.join(this.directory, `classmate-lilith-${stamp(this.now())}-${this.pid}.log`);
    await fs.appendFile(this.file, "", "utf8");
    await this.prune();
    return this.file;
  }

  async prune() {
    const entries = await fs.readdir(this.directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile() || !FILE_PATTERN.test(entry.name)) continue;
      const file = path.join(this.directory, entry.name);
      const stat = await fs.stat(file);
      files.push({ file, mtimeMs: stat.mtimeMs });
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs || b.file.localeCompare(a.file));
    await Promise.all(files.slice(this.maxFiles).map((item) => fs.unlink(item.file).catch(() => {})));
  }

  write(level, scope, message) {
    if (!this.file) return;
    const line = `${this.now().toISOString()} [${oneLine(level).toUpperCase()}] [${oneLine(scope)}] ${oneLine(message)}\n`;
    this.pending = this.pending.then(() => fs.appendFile(this.file, line, "utf8")).catch((error) => console.error("运行日志写入失败：", error.message));
  }

  info(scope, message) { this.write("INFO", scope, message); }
  warn(scope, message) { this.write("WARN", scope, message); }
  error(scope, message) { this.write("ERROR", scope, message); }

  async readSince(offset = 0) {
    await this.pending;
    const data = await fs.readFile(this.file);
    const start = Math.max(0, Math.min(Number(offset) || 0, data.length));
    return { file: path.basename(this.file), text: data.subarray(start).toString("utf8"), offset: data.length };
  }

  async list() {
    const entries = await fs.readdir(this.directory, { withFileTypes: true });
    const logs = [];
    for (const entry of entries) {
      if (!entry.isFile() || !FILE_PATTERN.test(entry.name)) continue;
      const stat = await fs.stat(path.join(this.directory, entry.name));
      logs.push({ name: entry.name, size: stat.size, updatedAt: stat.mtime.toISOString(), current: path.join(this.directory, entry.name) === this.file });
    }
    return logs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, this.maxFiles);
  }
}
