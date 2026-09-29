import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pruneRecoveryFiles } from "../lib/recovery-retention.mjs";

test("recovery retention removes expired and excess response files only", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lilith-recovery-"));
  try {
    const now = Date.now();
    for (let index = 0; index < 4; index += 1) {
      const file = path.join(directory, `response-test-${index}.json`);
      await fs.writeFile(file, "{}", "utf8");
      const timestamp = new Date(now - index * 86_400_000);
      await fs.utimes(file, timestamp, timestamp);
    }
    await fs.writeFile(path.join(directory, "keep-me.txt"), "user file", "utf8");
    const result = await pruneRecoveryFiles(directory, { maxAgeDays: 2, maxFiles: 2, now });
    assert.deepEqual(result, { kept: 2, removed: 2 });
    assert.deepEqual((await fs.readdir(directory)).sort(), ["keep-me.txt", "response-test-0.json", "response-test-1.json"]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
