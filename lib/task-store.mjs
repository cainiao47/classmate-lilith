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
  constructor({ tasksDir, versionsDir, transcriptionManager }) {
    this.tasksDir = tasksDir;
    this.versionsDir = versionsDir;
    this.transcriptionManager = transcriptionManager;
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

  async list() {
    await fs.mkdir(this.tasksDir, { recursive: true });
    const tasks = [];
    for (const name of (await fs.readdir(this.tasksDir)).filter((item) => item.endsWith(".json"))) {
      try {
        const task = JSON.parse(await fs.readFile(path.join(this.tasksDir, name), "utf8"));
        tasks.push({
          id: task.id,
          title: task.title || "未命名任务",
          updatedAt: task.updatedAt,
          status: task.status || "draft",
          sourceLength: task.sourceText?.length || task.transcriptionDraft?.length || 0,
          hasAudio: Boolean(task.transcriptionMeta?.jobId)
        });
      } catch { /* A damaged entry should not hide the rest of the history. */ }
    }
    return tasks.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 50);
  }

  async get(id) {
    return JSON.parse(await fs.readFile(this.taskFile(id), "utf8"));
  }

  async save(id, input) {
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
    return false;
  }

  async remove(id) {
    const file = this.taskFile(id);
    let task = null;
    try { task = JSON.parse(await fs.readFile(file, "utf8")); } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const jobId = task?.transcriptionMeta?.jobId;
    let transcriptionDeleted = false;
    let audioDeleted = false;
    const audioRetainedShared = Boolean(jobId && await this.transcriptionReferencedElsewhere(jobId, id));
    if (jobId && !audioRetainedShared) {
      const removed = await this.transcriptionManager.remove(jobId);
      transcriptionDeleted = removed.deleted;
      audioDeleted = removed.audioDeleted;
    }
    await fs.unlink(file).catch((error) => { if (error.code !== "ENOENT") throw error; });
    await fs.rm(path.join(this.versionsDir, id), { recursive: true, force: true });
    return { deleted: true, transcriptionDeleted, audioDeleted, audioRetainedShared };
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

  async renameVersion(taskId, versionId, label) {
    const file = this.versionFile(taskId, versionId);
    const value = String(label || "").trim().slice(0, 100);
    if (!value) throw Object.assign(new Error("版本名称不能为空。"), { statusCode: 400 });
    const snapshot = JSON.parse(await fs.readFile(file, "utf8"));
    snapshot.versionLabel = value;
    await writeJsonAtomic(file, snapshot);
    return { renamed: true, id: versionId, label: value };
  }

  async removeVersion(taskId, versionId) {
    await fs.unlink(this.versionFile(taskId, versionId));
    return { deleted: true, id: versionId };
  }
}
