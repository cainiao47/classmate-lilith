import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { writeJsonAtomic } from "./json-file.mjs";

async function exists(file) { return fs.access(file).then(() => true, () => false); }
const inside = (root, file) => { const relative = path.relative(root, file); return !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative); };
async function filesBelow(root, current = root) {
  const files = [];
  for (const entry of await fs.readdir(current, { withFileTypes: true })) {
    const file = path.join(current, entry.name);
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) throw new Error("迁移目录含有符号链接，请先将数据复制到普通文件夹。");
    if (stat.isDirectory()) files.push(...await filesBelow(root, file));
    else if (stat.isFile()) files.push(path.relative(root, file));
  }
  return files;
}
async function hash(file) {
  const result = createHash("sha256");
  const handle = await fs.open(file, "r");
  try { for await (const chunk of handle.readableWebStream()) result.update(Buffer.from(chunk)); }
  finally { await handle.close(); }
  return result.digest("hex");
}

export function remapOwnedPaths(value, source, destination) {
  if (Array.isArray(value)) return value.map(item => remapOwnedPaths(item, source, destination));
  if (!value || typeof value !== "object") return value;
  const result = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (["sourcePath", "normalizedPath", "filePath", "jobDir"].includes(key) && typeof item === "string" && path.isAbsolute(item) && inside(source, item)) {
      result[key] = path.join(destination, path.relative(source, item));
    } else result[key] = remapOwnedPaths(item, source, destination);
  }
  return result;
}

export async function migratePortableData({ sourceRoot, destination, onProgress = () => {} }) {
  const source = path.resolve(sourceRoot, "data"), target = path.resolve(destination), parent = path.dirname(target);
  if (inside(source, target) || inside(target, source) || path.parse(target).root === target) throw new Error("旧版数据目录与新数据目录不能相互包含。");
  if (await exists(target) && (await fs.readdir(target)).length) throw new Error("安装版已存在用户数据，不能直接覆盖或合并。请使用空的数据目录迁移。");
  const legacySettings = path.resolve(sourceRoot, "config", "api-settings.json");
  if (!(await exists(source)) && !(await exists(legacySettings))) throw new Error("所选文件夹没有找到旧版 data 目录或设置文件。");
  if (await exists(source) && (await fs.lstat(source)).isSymbolicLink()) throw new Error("旧版 data 目录不能是符号链接。");
  await fs.mkdir(parent, { recursive: true });
  const lockFile = path.join(parent, ".portable-migration.lock");
  const lock = await fs.open(lockFile, "wx").catch(() => { throw new Error("另一次数据迁移正在进行；请等待完成后重试。"); });
  const staging = path.join(parent, `.migration-${randomUUID()}`);
  try {
    await fs.mkdir(staging);
    const files = await exists(source) ? await filesBelow(source) : [];
    let totalBytes = 0;
    for (let index = 0; index < files.length; index++) {
      const relative = files[index], from = path.join(source, relative), to = path.join(staging, relative);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL);
      if (await hash(from) !== await hash(to)) throw new Error(`数据复制校验失败：${relative}`);
      totalBytes += (await fs.stat(to)).size;
      onProgress({ copied: index + 1, total: files.length });
      if (relative.endsWith(".json") && relative !== "settings.json" && relative !== "terminology.json") {
        const value = JSON.parse(await fs.readFile(to, "utf8"));
        const rewritten = remapOwnedPaths(value, source, target);
        if (JSON.stringify(value) !== JSON.stringify(rewritten)) await writeJsonAtomic(to, rewritten);
      }
    }
    if (!(await exists(path.join(staging, "settings.json"))) && await exists(legacySettings)) await fs.copyFile(legacySettings, path.join(staging, "settings.json"));
    const record = { format: 1, sourceRoot: path.resolve(sourceRoot), migratedAt: new Date().toISOString(), files: files.length, bytes: totalBytes, originalPreserved: true };
    await writeJsonAtomic(path.join(staging, "migration.json"), record);
    // Never replace nonempty data that appeared while copying.
    if (await exists(target)) await fs.rmdir(target);
    await fs.rename(staging, target);
    return record;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
    await lock.close(); await fs.unlink(lockFile);
  }
}
