import fs from "node:fs/promises";
import path from "node:path";
import { migratePortableData } from "../lib/portable-migration.mjs";

const args = process.argv.slice(2), value = name => args[args.indexOf(name) + 1];
try {
  if (!args.includes("--source") || !args.includes("--destination")) throw new Error("需要指定旧版目录和新数据目录。");
  await migratePortableData({ sourceRoot: value("--source"), destination: value("--destination") });
  console.log("旧版数据已复制并校验，原目录完整保留。");
} catch (error) {
  const message = `数据迁移未完成：${error.message}\n旧数据未删除，请不要删除旧版文件夹。`;
  if (args.includes("--destination")) {
    const log = path.join(path.dirname(path.resolve(value("--destination"))), "migration-error.txt");
    await fs.mkdir(path.dirname(log), { recursive: true });
    await fs.writeFile(log, message, "utf8");
  }
  console.error(message); process.exitCode = 1;
}
