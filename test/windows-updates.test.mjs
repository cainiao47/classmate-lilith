import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { compareVersions, verifyUpdateEnvelope, WindowsUpdates, RELEASE_REPO } from "../lib/windows-updates.mjs";
import { UpdateActivity } from "../lib/update-activity.mjs";

const keys = generateKeyPairSync("ed25519");
const bytes = Buffer.from("fake installer contents, never executable");
const version = "0.19.0";
const manifest = () => ({ version, platform: "win32", arch: "x64", url: `https://github.com/${RELEASE_REPO}/releases/download/v${version}/Classmate-Lilith-Setup-${version}.exe`, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
function envelope(data = manifest()) { const buffer = Buffer.from(JSON.stringify(data)); return { payload: buffer.toString("base64"), signature: sign(null, buffer, keys.privateKey).toString("base64") }; }
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lilith-update-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "app"), dataDir = path.join(directory, "profile", "data");
  await fs.mkdir(root); await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(root, "installation.json"), "{}"); await fs.writeFile(path.join(root, "UpdateHelper.exe"), "fake helper");
  await fs.writeFile(path.join(root, "package.json"), '{"version":"0.18.0"}');
  await fs.writeFile(path.join(dataDir, "settings.json"), "fake user settings");
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/releases/latest")) return Response.json({ tag_name: `v${version}`, draft: false, prerelease: false, assets: [{ name: "windows-update.json", browser_download_url: `https://github.com/${RELEASE_REPO}/releases/download/v${version}/windows-update.json` }] });
    if (url.endsWith("windows-update.json")) return Response.json(envelope());
    return new Response(options.badBytes ? Buffer.from("tampered") : bytes);
  };
  const updater = new WindowsUpdates({ root, dataDir, version: "0.18.0", platform: "win32", arch: "x64", installed: true, publicKey: keys.publicKey, fetchImpl, ...options });
  return { updater, root, dataDir, calls };
}

test("update versions compare numerically and reject prerelease or malformed input", () => {
  assert.equal(compareVersions("0.18.0", "0.17.10"), 1);
  assert.equal(compareVersions("v0.18.0", "0.18.0"), 0);
  for (const input of ["latest", "0.18.0-rc", "01.0.0", "1.2", "999999999999999999.0.0"]) assert.throws(() => compareVersions(input, "0.1.0"));
});

test("release signature prevents altered payloads, wrong signers and wrong package destinations", () => {
  assert.equal(verifyUpdateEnvelope(envelope(), keys.publicKey).version, version);
  const tampered = envelope(); tampered.payload = Buffer.from(JSON.stringify({ ...manifest(), version: "99.0.0" })).toString("base64");
  assert.throws(() => verifyUpdateEnvelope(tampered, keys.publicKey), /签名验证失败/);
  assert.throws(() => verifyUpdateEnvelope(envelope(), generateKeyPairSync("ed25519").publicKey), /签名验证失败/);
  assert.throws(() => verifyUpdateEnvelope(envelope({ ...manifest(), url: "https://example.com/evil.exe" }), keys.publicKey), /下载地址/);
  assert.throws(() => verifyUpdateEnvelope(envelope({ ...manifest(), arch: "arm64" }), keys.publicKey), /平台/);
});

test("cached release checking and verified download use no repository token", async t => {
  const { updater, calls } = await fixture(t);
  assert.equal((await updater.check()).status, "available");
  await updater.check(); assert.equal(calls.length, 2);
  assert.ok(calls.every(call => !call.init?.headers?.Authorization));
  await updater.download(); await updater.pendingDownload;
  assert.equal(updater.view().status, "ready");
  assert.deepEqual(await fs.readFile(updater.file), bytes);
});

test("corrupt or truncated downloads cannot become an installable update", async t => {
  const { updater } = await fixture(t, { badBytes: true });
  await updater.check(); await updater.download(); await updater.pendingDownload;
  assert.equal(updater.view().status, "error");
  await assert.rejects(updater.apply({ launcherPid: 123 }), /下载并校验/);
  assert.deepEqual(await fs.readdir(updater.directory), []);
});

test("busy, unsaved and portable sessions cannot install an update", async t => {
  const { updater } = await fixture(t, { busyReasons: () => ["实时录音尚未保存"] });
  await updater.check(); await updater.download(); await updater.pendingDownload;
  await assert.rejects(updater.apply({ launcherPid: 123 }), /实时录音尚未保存/);
  assert.equal(updater.installing, false);
  updater.installed = false;
  await assert.rejects(updater.apply({ launcherPid: 123 }), /已安装/);
});

test("install handoff waits for helper readiness and keeps user metadata and programs backed up", async t => {
  let launched = 0;
  const { updater, dataDir } = await fixture(t, { launch: async (file, args) => { launched++; assert.equal(args[7], version); await fs.writeFile(args[6], "ready"); } });
  await updater.check(); await updater.download(); await updater.pendingDownload;
  const result = await updater.apply({ launcherPid: 123 });
  assert.equal(result.installing, true); assert.equal(launched, 1);
  const backup = (await fs.readdir(updater.directory)).find(name => name.startsWith("rollback-"));
  assert.equal(await fs.readFile(path.join(updater.directory, backup, "metadata", "settings.json"), "utf8"), "fake user settings");
  assert.equal(await fs.readFile(path.join(dataDir, "settings.json"), "utf8"), "fake user settings");
  assert.ok(await fs.stat(path.join(updater.directory, backup, "app", "package.json")));
});

test("download tampering after verification is detected again before handoff", async t => {
  const { updater } = await fixture(t);
  await updater.check(); await updater.download(); await updater.pendingDownload;
  await fs.writeFile(updater.file, "changed afterwards");
  await assert.rejects(updater.apply({ launcherPid: 123 }), /校验失败/);
  assert.equal(updater.installing, false);
});

test("update activity protects background requests and unsaved recordings, clearing closed clients", () => {
  let now = 100;
  const activity = new UpdateActivity({ now: () => now });
  activity.report({ id: "client-example", kind: "live", dirty: true });
  assert.match(activity.reasons().join(" "), /实时录音尚未保存/);
  activity.report({ id: "client-example", closed: true }); assert.deepEqual(activity.reasons(), []);
  activity.report({ id: "client-example", busy: true }); now += 181_000;
  assert.deepEqual(activity.reasons(), []);
  activity.requests = 1; assert.match(activity.reasons().join(" "), /后台请求/);
});
