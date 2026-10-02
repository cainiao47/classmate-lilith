import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("repository declares maximally permissive licenses for original work", () => {
  const packageJson = JSON.parse(read("package.json"));
  assert.equal(packageJson.license, "0BSD");
  assert.match(read("LICENSE"), /Zero-Clause BSD/);
  assert.match(read("ASSETS_LICENSE.md"), /CC0 1\.0 Universal/);
  assert.match(read("README.md"), /原创程序代码采用 \[0BSD License\]/);
});

test("both release packages include project and third-party license notices", () => {
  const windowsBuild = read("distribution/build-windows-base.ps1");
  const macBuild = read("distribution/build-macos-arm64.sh");
  for (const file of ["LICENSE", "ASSETS_LICENSE.md", "THIRD_PARTY_NOTICES.txt"]) {
    assert.match(windowsBuild, new RegExp(file.replace(".", "\\.")));
    assert.match(macBuild, new RegExp(file.replace(".", "\\.")));
  }
});

test("Windows launcher build verifies and ships its WebView2 dependencies", () => {
  const build = read("launcher/build.ps1");
  assert.match(build, /WebView2 SDK checksum verification failed/);
  assert.match(build, /Microsoft\.Web\.WebView2\.WinForms\.dll/);
  assert.match(build, /THIRD_PARTY_WebView2_LICENSE\.txt/);
});
