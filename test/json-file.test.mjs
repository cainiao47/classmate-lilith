import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readJsonFile, writeJsonAtomic } from "../lib/json-file.mjs";

test("atomic JSON writes replace complete documents without temporary leftovers", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "classmate-lilith-json-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "task.json");
  await writeJsonAtomic(file, { version: 1, text: "第一版" });
  await writeJsonAtomic(file, { version: 2, text: "第二版" });
  assert.deepEqual(await readJsonFile(file), { version: 2, text: "第二版" });
  assert.deepEqual(await fs.readdir(directory), ["task.json"]);
});
