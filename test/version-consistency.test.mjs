import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const read = relative => fs.readFile(new URL(relative, new URL("../", import.meta.url)), "utf8");

test("package and lockfile agree on the application version", async () => {
  const pkg = JSON.parse(await read("package.json"));
  const lock = JSON.parse(await read("package-lock.json"));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
});

test("current Windows documentation agrees with the package version", async () => {
  const { version } = JSON.parse(await read("package.json"));
  assert.ok((await read("README.md")).includes(`Windows 开发版本：${version}（未发布）`));
  assert.ok((await read("WORKBENCH_INFO.txt")).split(/\r?\n/).includes(`Version: ${version}`));
  assert.ok((await read("Classmate Lilith 使用说明.txt")).startsWith(`Classmate Lilith ${version}（`));
});
