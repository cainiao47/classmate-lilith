import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { writeJsonAtomic } from "./json-file.mjs";

export function validTaskId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(value);
}

export function validVersionId(value) {
  return typeof value === "string" && /^version-[a-zA-Z0-9_-]+$/.test(value);
}

export class TaskStore {
  constructor({ tasksDir, versionsDir, trashDir = path.join(path.dirname(tasksDir), "trash"), transcriptionManager }) {
    this.tasksDir = tasksDir;
    this.versionsDir = versionsDir;
    this.transcriptionManager = transcriptionManager;
    this.trashDir = trashDir;
    this.pending = new Map();
  }

  exclusive(id, operation) {
    this.taskFile(id);
    const previous = this.pending.get(id) || Promise.resolve();
    const result = previous.catch(() => {}).then(operation);
    this.pending.set(id, result);
    result.finally(() => { if (this.pending.get(id) === result) this.pending.delete(id); }).catch(() => {});
    return result;
  }

  trashFile(id) { this.taskFile(id); return path.join(this.trashDir, `${id}.json`); }

  async assertActive(id) {
    try { await fs.access(this.trashFile(id)); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    throw Object.assign(new Error("该工程已移入回收站，请先恢复；未覆盖回收站内容。"), { statusCode: 410 });
  }

  taskFile(id) {
    if (!validTaskId(id)) throw Object.assign(new Error("任务编号无效。"), { statusCode: 400 });
    return path.join(this.tasksDir, `${id}.json`);
  }

  versionFile(taskId, versionId) {
    this.taskFile(taskId);
    if (!validVersionId(versionId)) throw Object.assign(new Error("版本编号无效。"), { statusCode: 400 });
    return path.join(this.versionsDir, taskId, `${versionId}.json`);
  }

  async list({ trash = false } = {}) {
    const directory = trash ? this.trashDir : this.tasksDir;
    await fs.mkdir(directory, { recursive: true });
    await fs.mkdir(this.trashDir, { recursive: true });
    const deletedIds = new Set((await fs.readdir(this.trashDir)).filter(name => name.endsWith(".json")));
    const tasks = [];
    for (const name of (await fs.readdir(directory)).filter((item) => item.endsWith(".json"))) {
      if (!trash && deletedIds.has(name)) continue;
      try {
        const entry = JSON.parse(await fs.readFile(path.join(directory, name), "utf8"));
        const task = trash ? entry.task : entry;
        if (!validTaskId(task?.id) || name !== `${task.id}.json`) continue;
        tasks.push({
          id: task.id,
          title: String(task.projectTitle || task.title || "未命名任务"),
          updatedAt: task.updatedAt,
          status: task.status || "draft",
          sourceLength: task.sourceText?.length || task.transcriptionDraft?.length || 0,
          hasAudio: Boolean(task.transcriptionMeta?.jobId),
          ...(trash ? { deletedAt: entry.deletedAt } : {})
        });
      } catch { /* A damaged entry should not hide the rest of the history. */ }
    }
    return tasks.sort((a, b) => String(b.deletedAt || b.updatedAt).localeCompare(String(a.deletedAt || a.updatedAt)) || a.id.localeCompare(b.id));
  }

  async listPage({ query = "", page = 1, pageSize = 20, trash = false } = {}) {
    const size = Math.max(1, Math.min(100, Math.floor(Number(pageSize)) || 20));
    const keyword = String(query ?? "").trim().slice(0, 200).toLocaleLowerCase();
    const all = (await this.list({ trash })).filter(task => !keyword || task.title.toLocaleLowerCase().includes(keyword));
    const pages = Math.max(1, Math.ceil(all.length / size));
    const current = Math.max(1, Math.min(pages, Math.floor(Number(page)) || 1));
    return { tasks: all.slice((current - 1) * size, current * size), total: all.length, page: current, pageSize: size, pages };
  }

  async get(id) {
    await this.assertActive(id);
    return JSON.parse(await fs.readFile(this.taskFile(id), "utf8"));
  }

  async save(id, input) {
    return this.exclusive(id, () => this.saveActive(id, input));
  }

  async saveActive(id, input) {
    await this.assertActive(id);
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw Object.assign(new Error("任务内容格式无效。"), { statusCode: 400 });
    }
    const task = { ...(input || {}), id };
    task.updatedAt = new Date().toISOString();
    task.createdAt ||= task.updatedAt;
    await fs.mkdir(this.tasksDir, { recursive: true });
    await writeJsonAtomic(this.taskFile(id), task);
    return { saved: true, updatedAt: task.updatedAt };
  }

  async rename(id, title) {
    return this.exclusive(id, () => this.renameActive(id, title));
  }

  async renameActive(id, title) {
    await this.assertActive(id);
    const value = String(title || "").trim().slice(0, 100);
    if (!value) throw Object.assign(new Error("工程名称不能为空。"), { statusCode: 400 });
    const file = this.taskFile(id);
    const task = JSON.parse(await fs.readFile(file, "utf8"));
    task.projectTitle = value;
    task.title = value;
    task.updatedAt = new Date().toISOString();
    await writeJsonAtomic(file, task);
    return { renamed: true, id, title: value, updatedAt: task.updatedAt };
  }

  async transcriptionReferencedElsewhere(jobId, excludingTaskId) {
    if (!jobId) return false;
    await fs.mkdir(this.tasksDir, { recursive: true });
    for (const name of (await fs.readdir(this.tasksDir)).filter((item) => item.endsWith(".json") && item !== `${excludingTaskId}.json`)) {
      try {
        const task = JSON.parse(await fs.readFile(path.join(this.tasksDir, name), "utf8"));
        if (task.transcriptionMeta?.jobId === jobId) return true;
      } catch {
        // A damaged task may still be the only record pointing at this audio.
        // Retain the media until the task can be inspected or repaired.
        return true;
      }
    }
    let directories = [];
    try { directories = await fs.readdir(this.versionsDir, { withFileTypes: true }); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    for (const directory of directories) {
      if (!directory.isDirectory() || directory.name === excludingTaskId) continue;
      for (const name of await fs.readdir(path.join(this.versionsDir, directory.name))) {
        if (!name.endsWith(".json")) continue;
        try {
          const version = JSON.parse(await fs.readFile(path.join(this.versionsDir, directory.name, name), "utf8"));
          if (version.transcriptionMeta?.jobId === jobId) return true;
        } catch { return true; }
      }
    }
    return false;
  }

  async remove(id) {
    return this.exclusive(id, async () => {
      const task = await this.get(id);
      // The durable tombstone is authoritative even if the process stops before
      // unlinking the old file. Versions and recordings are never removed here.
      const deletedAt = new Date().toISOString();
      await writeJsonAtomic(this.trashFile(id), { task, deletedAt });
      const cleanupPending = await fs.unlink(this.taskFile(id)).then(() => false, error => error.code !== "ENOENT");
      return { deleted: true, trashed: true, deletedAt, cleanupPending, audioDeleted: false, transcriptionDeleted: false };
    });
  }

  async restoreDeleted(id) {
    return this.exclusive(id, async () => {
      const entry = JSON.parse(await fs.readFile(this.trashFile(id), "utf8"));
      if (entry.task?.id !== id) throw new Error("回收站工程数据不匹配，未恢复。");
      try {
        const active = JSON.parse(await fs.readFile(this.taskFile(id), "utf8"));
        if (JSON.stringify(active) !== JSON.stringify(entry.task)) throw Object.assign(new Error("同编号工程已有不同内容，未覆盖。请先备份并检查数据。"), { statusCode: 409 });
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      // Publish the active copy before removing its tombstone, so interruption
      // leaves either a recoverable trash entry or a complete active record.
      await writeJsonAtomic(this.taskFile(id), entry.task);
      await fs.unlink(this.trashFile(id));
      return { restored: true, id };
    });
  }

  async listVersions(taskId) {
    this.taskFile(taskId);
    const directory = path.join(this.versionsDir, taskId);
    await fs.mkdir(directory, { recursive: true });
    const versions = [];
    for (const name of (await fs.readdir(directory)).filter((item) => /^version-[a-zA-Z0-9_-]+\.json$/.test(item))) {
      try {
        const snapshot = JSON.parse(await fs.readFile(path.join(directory, name), "utf8"));
        versions.push({
          id: snapshot.versionId,
          label: snapshot.versionLabel,
          stage: snapshot.versionStage,
          createdAt: snapshot.versionCreatedAt,
          sourceLength: snapshot.sourceText?.length || snapshot.transcriptionDraft?.length || 0
        });
      } catch { /* Ignore a damaged snapshot. */ }
    }
    return versions.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async createVersion(taskId, input) {
    return this.exclusive(taskId, () => this.createVersionActive(taskId, input));
  }

  async createVersionActive(taskId, input) {
    await this.assertActive(taskId);
    this.taskFile(taskId);
    const versionId = `version-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const snapshot = { ...(input || {}) };
    snapshot.id = taskId;
    snapshot.versionId = versionId;
    snapshot.versionCreatedAt = new Date().toISOString();
    snapshot.versionStage = String(snapshot.versionStage || "手工版本").slice(0, 40);
    snapshot.versionLabel = String(snapshot.versionLabel || snapshot.versionStage).slice(0, 100);
    const directory = path.join(this.versionsDir, taskId);
    await fs.mkdir(directory, { recursive: true });
    await writeJsonAtomic(path.join(directory, `${versionId}.json`), snapshot);
    return { saved: true, id: versionId, createdAt: snapshot.versionCreatedAt };
  }

  async getVersion(taskId, versionId) {
    return JSON.parse(await fs.readFile(this.versionFile(taskId, versionId), "utf8"));
  }

  async restoreVersion(taskId, versionId) {
    return this.exclusive(taskId, () => this.restoreVersionActive(taskId, versionId));
  }

  async restoreVersionActive(taskId, versionId) {
    // Read and validate the target before writing anything. Never replace the
    // working record unless its independent recovery snapshot is durable.
    const target = await this.getVersion(taskId, versionId);
    if (!target || Array.isArray(target) || target.id !== taskId) {
      throw Object.assign(new Error("历史版本与当前工程不匹配，未恢复。"), { statusCode: 400 });
    }
    const current = await this.get(taskId);
    const backup = await this.createVersionActive(taskId, { ...current, versionStage: "恢复前自动备份",
      versionLabel: `恢复前自动备份 · ${new Date().toISOString()}` });
    const restored = { ...target };
    for (const key of ["versionId", "versionCreatedAt", "versionStage", "versionLabel"]) delete restored[key];
    await this.saveActive(taskId, restored);
    return { task: await this.get(taskId), backup };
  }

  async renameVersion(taskId, versionId, label) {
    return this.exclusive(taskId, () => this.renameVersionActive(taskId, versionId, label));
  }

  async renameVersionActive(taskId, versionId, label) {
    await this.assertActive(taskId);
    const file = this.versionFile(taskId, versionId);
    const value = String(label || "").trim().slice(0, 100);
    if (!value) throw Object.assign(new Error("版本名称不能为空。"), { statusCode: 400 });
    const snapshot = JSON.parse(await fs.readFile(file, "utf8"));
    snapshot.versionLabel = value;
    await writeJsonAtomic(file, snapshot);
    return { renamed: true, id: versionId, label: value };
  }

  async removeVersion(taskId, versionId) {
    return this.exclusive(taskId, async () => {
      await this.assertActive(taskId);
      await fs.unlink(this.versionFile(taskId, versionId));
      return { deleted: true, id: versionId };
    });
  }
}
