import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export async function readJsonFile(file, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJsonAtomic(file, value, { mode = 0o600 } = {}) {
  return writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, { mode });
}

export async function writeFileAtomic(file, content, { mode = 0o600 } = {}) {
  const directory = path.dirname(file);
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  await fs.mkdir(directory, { recursive: true });
  try {
    const handle = await fs.open(temporary, "wx", mode);
    try { await handle.writeFile(content); await handle.sync(); }
    finally { await handle.close(); }
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}
