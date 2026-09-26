import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RuntimeLog } from "../lib/runtime-log.mjs";

test("runtime log writes incrementally and keeps only the newest 20 sessions", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "classmate-log-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (let index = 0; index < 22; index += 1) {
    const name = `classmate-lilith-20260924-${String(index).padStart(6, "0")}-${1000 + index}.log`;
    const file = path.join(directory, name);
    await fs.writeFile(file, `old ${index}\n`);
    const time = new Date(2026, 8, 24, 0, 0, index);
    await fs.utimes(file, time, time);
  }
  await fs.writeFile(path.join(directory, "launcher-error.log"), "must stay");
  const logger = new RuntimeLog({ directory, maxFiles: 20, now: () => new Date("2026-09-25T01:02:03.000Z"), pid: 4321 });
  await logger.initialize();
  logger.info("test", "第一行\n不能另起一行");
  const first = await logger.readSince(0);
  assert.match(first.text, /\[INFO\] \[test\] 第一行 不能另起一行/);
  logger.error("test", "第二行");
  const second = await logger.readSince(first.offset);
  assert.match(second.text, /\[ERROR\] \[test\] 第二行/);
  assert.equal((await logger.list()).length, 20);
  assert.equal(await fs.readFile(path.join(directory, "launcher-error.log"), "utf8"), "must stay");
});
