import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeJsonAtomic } from "./json-file.mjs";

const error = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const FORMATS = { webm: "audio/webm", m4a: "audio/mp4", ogg: "audio/ogg" };
const exists = file => fs.access(file).then(() => true, e => { if (e.code === "ENOENT") return false; throw e; });
const runFile = promisify(execFile);

// Each MediaRecorder fragment is immutable and fsynced before acknowledgement.
// The initial container header (fragment 0) and exact order are preserved; a
// partial upload never replaces a durable fragment. No automatic expiry.
export class LiveRecordingStore {
  constructor({ directory, ffmpegPath = null, maxChunkBytes = 8 * 1024 * 1024, maxRecordingBytes = 2 * 1024 ** 3 }) {
    Object.assign(this, { directory, ffmpegPath, maxChunkBytes, maxRecordingBytes });
    this.pending = new Map();
    this.cache = new Map();
  }

  folder(id) {
    if (!/^live-[a-f0-9-]{36}$/.test(String(id))) throw error("录音恢复编号无效。");
    return path.join(this.directory, id);
  }

  exclusive(id, operation) {
    this.folder(id);
    const next = (this.pending.get(id) || Promise.resolve()).catch(() => {}).then(operation);
    this.pending.set(id, next);
    next.finally(() => { if (this.pending.get(id) === next) this.pending.delete(id); }).catch(() => {});
    return next;
  }

  sanitize(input = {}) {
    return {
      topic: String(input.topic || "").slice(0, 2000), keywords: String(input.keywords || "").slice(0, 20_000),
      provider: ["alibaba", "tencent", "openai"].includes(input.provider) ? input.provider : "alibaba",
      model: String(input.model || "").slice(0, 200), language: String(input.language || "zh").slice(0, 20),
      text: String(input.text || "").slice(0, 500_000),
      durationMs: Math.max(0, Math.min(7 * 24 * 3600_000, Number(input.durationMs) || 0)),
      phase: ["recording", "paused", "finalizing", "done"].includes(input.phase) ? input.phase : "recording",
      segments: (Array.isArray(input.segments) ? input.segments : []).slice(0, 20_000).map(segment => ({
        id: String(segment.id || "").slice(0, 200), text: String(segment.text || "").slice(0, 20_000),
        startMs: Math.max(0, Number(segment.startMs) || 0), endMs: Math.max(0, Number(segment.endMs) || 0)
      }))
    };
  }

  async create(input) {
    const extension = String(input?.extension || "webm");
    if (!Object.hasOwn(FORMATS, extension)) throw error("不支持的录音恢复格式。");
    const id = `live-${crypto.randomUUID()}`, now = new Date().toISOString();
    const meta = { ...this.sanitize(input), id, extension, mimeType: FORMATS[extension], createdAt: now, updatedAt: now, savedTaskId: "" };
    await writeJsonAtomic(path.join(this.folder(id), "recording.json"), meta);
    this.cache.set(id, { meta, count: 0, bytes: 0, damaged: false, activeAt: Date.now() });
    return this.view(this.cache.get(id));
  }

  async load(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const folder = this.folder(id);
    const meta = JSON.parse(await fs.readFile(path.join(folder, "recording.json"), "utf8"));
    if (meta.id !== id || !Object.hasOwn(FORMATS, meta.extension)) throw error("录音恢复信息损坏，原文件已保留。", 409);
    const parts = (await fs.readdir(folder)).filter(name => /^\d{8}\.part$/.test(name)).sort();
    const state = { meta, count: parts.length, bytes: 0, damaged: false };
    for (let index = 0; index < parts.length; index++) {
      if (parts[index] !== this.chunkName(index)) state.damaged = true;
      const stat = await fs.stat(path.join(folder, parts[index]));
      state.bytes += stat.size;
      if (stat.mtime.toISOString() > state.meta.updatedAt) state.meta.updatedAt = stat.mtime.toISOString();
    }
    this.cache.set(id, state);
    return state;
  }

  chunkName(index) { return `${String(index).padStart(8, "0")}.part`; }
  view(state) { return { ...state.meta, persistedChunks: state.count, bytes: state.bytes, damaged: state.damaged,
    active: ["recording", "paused", "finalizing"].includes(state.meta.phase) && Date.now() - (state.activeAt || 0) < 15_000 }; }
  async get(id) { return this.exclusive(id, async () => this.view(await this.load(id))); }

  async list() {
    await fs.mkdir(this.directory, { recursive: true });
    const recordings = [];
    for (const entry of await fs.readdir(this.directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^live-[a-f0-9-]{36}$/.test(entry.name)) continue;
      try {
        const value = await this.get(entry.name);
        if (!value.savedTaskId && (value.bytes || value.text)) {
          const { text, segments, keywords, ...summary } = value;
          recordings.push({ ...summary, textLength: text.length });
        }
      } catch { recordings.push({ id: entry.name, topic: "恢复信息损坏（文件已保留）", damaged: true }); }
    }
    return recordings.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async append(id, index, request) {
    if (!Number.isInteger(index) || index < 0 || index >= 100_000) throw error("录音分段编号无效。");
    // Read bounded input before acquiring the disk queue; disconnected requests
    // cannot leave incomplete .part files behind.
    const chunks = []; let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > this.maxChunkBytes) throw error("录音分段过大，尚未写入。", 413);
      chunks.push(chunk);
    }
    if (!size) throw error("录音分段为空。");
    const data = Buffer.concat(chunks);
    return this.exclusive(id, async () => {
      const state = await this.load(id);
      if (state.meta.savedTaskId || state.damaged) throw error("录音已归档或存在分段缺失，未追加。", 409);
      const target = path.join(this.folder(id), this.chunkName(index));
      if (index < state.count) {
        if (!(await fs.readFile(target)).equals(data)) throw error("同一分段内容不一致，未覆盖原录音。", 409);
        return this.view(state); // Lost acknowledgement: retry is idempotent.
      }
      if (index !== state.count) throw error("录音分段顺序不连续，未追加。", 409);
      if (state.bytes + size > this.maxRecordingBytes) throw error("恢复录音已达到本机单段容量上限。", 413);
      const temporary = path.join(this.folder(id), `.${crypto.randomUUID()}.tmp`);
      const handle = await fs.open(temporary, "wx", 0o600);
      try { await handle.writeFile(data); await handle.sync(); }
      finally { await handle.close(); }
      await fs.rename(temporary, target);
      state.count++; state.bytes += size; state.activeAt = Date.now(); state.meta.updatedAt = new Date().toISOString();
      return this.view(state);
    });
  }

  async checkpoint(id, input) {
    return this.exclusive(id, async () => {
      const state = await this.load(id);
      const meta = { ...state.meta, ...this.sanitize(input), savedTaskId: "", updatedAt: new Date().toISOString() };
      await writeJsonAtomic(path.join(this.folder(id), "recording.json"), meta);
      state.meta = meta;
      state.activeAt = Date.now();
      return this.view(state);
    });
  }

  async audioPath(id) {
    return this.exclusive(id, async () => {
      const state = await this.load(id);
      if (!state.count || state.damaged) throw error("录音为空或分段不完整；原文件已保留，可先恢复文稿。", 409);
      const target = path.join(this.folder(id), `assembled-${state.count}.${state.meta.extension}`);
      if (!await exists(target)) {
        const temporary = `${target}.${crypto.randomUUID()}.tmp`;
        const handle = await fs.open(temporary, "wx", 0o600);
        try {
          for (let index = 0; index < state.count; index++) await handle.writeFile(await fs.readFile(path.join(this.folder(id), this.chunkName(index))));
          await handle.sync();
        } finally { await handle.close(); }
        await fs.rename(temporary, target);
      }
      // A crashed recorder may omit the container trailer/duration. Remux the
      // decodable prefix without re-encoding; retain every original fragment.
      const repaired = path.join(this.folder(id), `recovered-${state.count}.${state.meta.extension}`);
      if (await exists(repaired)) return repaired;
      if (!this.ffmpegPath || !await exists(this.ffmpegPath)) return target;
      const temporary = path.join(this.folder(id), `repair-${crypto.randomUUID()}.${state.meta.extension}`);
      try {
        await runFile(this.ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", target, "-map", "0:a:0", "-c:a", "copy",
          ...(state.meta.extension === "m4a" ? ["-movflags", "+faststart"] : []), temporary], { windowsHide: true, timeout: 45_000, maxBuffer: 8192 });
        if (!(await fs.stat(temporary)).size) throw Error("Empty repaired recording");
        const repairedHandle = await fs.open(temporary, "r+");
        try { await repairedHandle.sync(); } finally { await repairedHandle.close(); }
        await fs.rename(temporary, repaired);
        return repaired;
      } catch {
        await fs.unlink(temporary).catch(() => {});
        return target; // Do not sacrifice recoverable bytes if repair fails.
      }
    });
  }

  async complete(id, taskId) {
    return this.exclusive(id, async () => {
      const state = await this.load(id);
      const meta = { ...state.meta, savedTaskId: taskId, phase: "done", updatedAt: new Date().toISOString() };
      await writeJsonAtomic(path.join(this.folder(id), "recording.json"), meta);
      state.meta = meta;
      return { saved: true };
    });
  }
}
