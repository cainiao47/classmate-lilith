import fs from "node:fs/promises";
import path from "node:path";

const DAY_MS = 24 * 60 * 60 * 1000;

async function json(file) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return null; }
}

async function entries(directory) {
  try { return await fs.readdir(directory, { withFileTypes: true }); } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function oldEnough(target, cutoff) {
  try { return (await fs.stat(target)).mtimeMs < cutoff; } catch { return false; }
}

function containedFile(candidate, root) {
  const resolved = path.resolve(String(candidate || ""));
  const base = path.resolve(root);
  return resolved.startsWith(`${base}${path.sep}`) ? resolved : null;
}

export async function pruneOrphanedTranscriptions({
  dataDir,
  tasksDir = path.join(dataDir, "tasks"),
  now = Date.now(),
  uploadMaxAgeMs = DAY_MS,
  jobMaxAgeMs = 30 * DAY_MS
}) {
  const transcriptionRoot = path.join(dataDir, "transcriptions");
  const uploadsDir = path.join(transcriptionRoot, "uploads");
  const jobsDir = path.join(transcriptionRoot, "jobs");
  const referencedJobs = new Set();
  let damagedTaskFiles = 0;

  for (const entry of await entries(tasksDir)) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const task = await json(path.join(tasksDir, entry.name));
    if (!task) {
      damagedTaskFiles += 1;
      continue;
    }
    if (task?.transcriptionMeta?.jobId) referencedJobs.add(String(task.transcriptionMeta.jobId));
  }

  // A damaged task may still be the only reference to an audio file. If any
  // task cannot be inspected, skip this cleanup pass rather than risk data loss.
  if (damagedTaskFiles) return { jobsRemoved: 0, uploadsRemoved: 0, skipped: true, damagedTaskFiles };

  let jobsRemoved = 0;
  let uploadsRemoved = 0;
  for (const entry of await entries(jobsDir)) {
    if (!entry.isDirectory() || referencedJobs.has(entry.name)) continue;
    const jobDir = path.join(jobsDir, entry.name);
    if (!(await oldEnough(jobDir, now - jobMaxAgeMs))) continue;
    const meta = await json(path.join(jobDir, "job-meta.json"));
    const source = containedFile(meta?.sourcePath, uploadsDir);
    if (source) {
      const removed = await fs.unlink(source).then(() => true).catch((error) => {
        if (error.code === "ENOENT") return false;
        throw error;
      });
      if (removed) uploadsRemoved += 1;
    }
    await fs.rm(jobDir, { recursive: true, force: true });
    jobsRemoved += 1;
  }

  const claimedUploads = new Set();
  for (const entry of await entries(jobsDir)) {
    if (!entry.isDirectory()) continue;
    const meta = await json(path.join(jobsDir, entry.name, "job-meta.json"));
    const source = containedFile(meta?.sourcePath, uploadsDir);
    if (source) claimedUploads.add(source.toLowerCase());
  }
  for (const entry of await entries(uploadsDir)) {
    if (!entry.isFile()) continue;
    const file = path.resolve(uploadsDir, entry.name);
    if (claimedUploads.has(file.toLowerCase()) || !(await oldEnough(file, now - uploadMaxAgeMs))) continue;
    await fs.unlink(file);
    uploadsRemoved += 1;
  }

  return { jobsRemoved, uploadsRemoved, skipped: false, damagedTaskFiles: 0 };
}
