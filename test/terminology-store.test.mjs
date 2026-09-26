import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TerminologyStore, normalizeTerminologyLibrary } from "../lib/terminology-store.mjs";

test("terminology library always preserves the general group and normalizes terms", () => {
  const library = normalizeTerminologyLibrary({ groups: [], terms: [{ canonical: "田野访谈", aliases: "田野荡谈，田野谈谈", groupId: "missing" }] });
  assert.equal(library.groups[0].id, "general");
  assert.equal(library.terms[0].groupId, "general");
  assert.deepEqual(library.terms[0].aliases, ["田野荡谈", "田野谈谈"]);
});

test("explicit upsert merges aliases instead of creating duplicate canonical terms", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lilith-terms-"));
  const store = new TerminologyStore({ file: path.join(dir, "terminology.json") });
  await store.initialize();
  await store.upsertTerm({ canonical: "田野访谈", aliases: ["田野荡谈"] });
  const result = await store.upsertTerm({ canonical: "田野访谈", aliases: ["田野谈谈"] });
  assert.equal(result.library.terms.length, 1);
  assert.deepEqual(result.library.terms[0].aliases.sort(), ["田野荡谈", "田野谈谈"].sort());
  await fs.rm(dir, { recursive: true, force: true });
});
