import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID, verify } from "node:crypto";
import { spawn } from "node:child_process";
import { writeJsonAtomic } from "./json-file.mjs";

export const RELEASE_REPO = "cainiao47/classmate-lilith";
const API_URL = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;
const exists = file => fs.access(file).then(() => true, () => false);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function compareVersions(left, right) {
  const parse = text => {
    if (!/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(String(text))) throw new Error("版本号格式无效。");
    const parts = String(text).replace(/^v/, "").split(".").map(Number);
    if (parts.some(x => !Number.isSafeInteger(x))) throw new Error("版本号过大。");
    return parts;
  };
  const a = parse(left), b = parse(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

export function verifyUpdateEnvelope(envelope, publicKey) {
  if (typeof envelope.payload !== "string" || typeof envelope.signature !== "string" || envelope.payload.length > 90_000) throw new Error("更新清单格式无效。");
  const payload = Buffer.from(envelope.payload, "base64");
  if (!verify(null, payload, publicKey, Buffer.from(envelope.signature, "base64"))) throw new Error("更新包发布签名验证失败，已停止更新。");
  const manifest = JSON.parse(payload.toString("utf8"));
  compareVersions(manifest.version, "0.0.0");
  const expected = `https://github.com/${RELEASE_REPO}/releases/download/v${manifest.version}/Classmate-Lilith-Setup-${manifest.version}.exe`;
  if (manifest.platform !== "win32" || manifest.arch !== "x64" || manifest.url !== expected || !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
      !Number.isSafeInteger(manifest.size) || manifest.size < 1 || manifest.size > 512 * 1024 * 1024) throw new Error("更新清单的平台、下载地址或校验信息无效。");
  return manifest;
}

export async function sha256(file) {
  const hash = createHash("sha256");
  const handle = await fs.open(file, "r");
  try { for await (const chunk of handle.readableWebStream()) hash.update(Buffer.from(chunk)); }
  finally { await handle.close(); }
  return hash.digest("hex");
}

async function limitedJson(response, limit = 100_000) {
  if (!response.ok) throw new Error(`更新服务暂不可用（HTTP ${response.status}），当前版本仍可使用。`);
  let length = 0; const buffers = [];
  for await (const chunk of response.body) { length += chunk.length; if (length > limit) throw new Error("更新服务返回内容过大。"); buffers.push(Buffer.from(chunk)); }
  return JSON.parse(Buffer.concat(buffers).toString("utf8"));
}

export class WindowsUpdates {
  constructor({ root, dataDir, version, installed, platform = process.platform, arch = process.arch, fetchImpl = fetch, publicKey = null,
    busyReasons = () => [], launch = null, now = () => Date.now() }) {
    Object.assign(this, { root, dataDir, version, installed, platform, arch, fetchImpl, publicKey, busyReasons, now });
    this.directory = path.join(path.dirname(dataDir), "updates");
    this.launch = launch || ((file, args) => {
      const child = spawn(file, args, { detached: true, windowsHide: true, stdio: "ignore", cwd: this.directory });
      child.on("error", error => { this.state.error = error.message; }); child.unref();
    });
    this.state = { status: "idle", currentVersion: version, latestVersion: null, error: "", downloaded: 0, total: 0, checkedAt: null };
    this.pendingCheck = null; this.pendingDownload = null; this.manifest = null; this.installing = false;
  }

  view() { return { ...this.state, dataDirectory: this.dataDir, supported: this.platform === "win32" && this.arch === "x64", installed: Boolean(this.installed),
    canInstall: Boolean(this.installed && this.platform === "win32" && this.arch === "x64"), busyReasons: this.busyReasons(),
    releaseUrl: this.state.latestVersion ? `https://github.com/${RELEASE_REPO}/releases/tag/v${this.state.latestVersion}` : `https://github.com/${RELEASE_REPO}/releases` }; }

  async check(force = false) {
    if (this.pendingCheck) return this.pendingCheck;
    if (this.platform !== "win32" || this.arch !== "x64" || this.installing || this.pendingDownload) return this.view();
    if (!force && this.state.checkedAt && this.now() - this.state.checkedAt < 6 * 60 * 60 * 1000) return this.view();
    this.pendingCheck = this.checkLatest().finally(() => { this.pendingCheck = null; });
    return this.pendingCheck;
  }

  async checkLatest() {
    this.state.status = "checking"; this.state.error = "";
    this.manifest = null; this.state.total = 0;
    try {
      const release = await limitedJson(await this.fetchImpl(API_URL, { headers: { Accept: "application/vnd.github+json", "User-Agent": "Classmate-Lilith-Updater" }, signal: AbortSignal.timeout(15_000) }));
      this.state.checkedAt = this.now();
      if (release.draft || release.prerelease) throw new Error("更新服务没有提供正式版本。");
      const latest = String(release.tag_name || "").replace(/^v/, "");
      this.state.latestVersion = latest;
      if (compareVersions(latest, this.version) <= 0) { this.manifest = null; this.state.status = "current"; return this.view(); }
      const asset = release.assets?.find(item => item.name === "windows-update.json");
      const expectedURL = `https://github.com/${RELEASE_REPO}/releases/download/v${latest}/windows-update.json`;
      if (!asset || asset.browser_download_url !== expectedURL) { this.state.status = "manual"; this.manifest = null; return this.view(); }
      const key = this.publicKey || await fs.readFile(path.join(this.root, "distribution", "windows-update-public.pem"), "utf8");
      const envelope = await limitedJson(await this.fetchImpl(expectedURL, { signal: AbortSignal.timeout(15_000) }));
      const manifest = verifyUpdateEnvelope(envelope, key);
      if (manifest.version !== latest) throw new Error("版本信息与更新包不一致。");
      this.manifest = manifest; this.state.total = manifest.size;
      this.state.status = "available";
    } catch (error) { this.state.status = "error"; this.state.error = error.message; this.state.checkedAt = this.now(); }
    return this.view();
  }

  async download() {
    if (this.pendingDownload) return this.view();
    if (!this.manifest || !["available", "ready", "error"].includes(this.state.status) || this.installing) throw new Error("请先成功检查可用的正式更新。");
    this.pendingDownload = this.downloadFile().catch(error => { this.state.status = "error"; this.state.error = error.message; }).finally(() => { this.pendingDownload = null; });
    return this.view();
  }

  async downloadFile() {
    const manifest = this.manifest;
    await fs.mkdir(this.directory, { recursive: true });
    const target = path.join(this.directory, `Classmate-Lilith-Setup-${manifest.version}.exe`);
    this.state.status = "downloading"; this.state.error = ""; this.state.downloaded = 0;
    if (await exists(target) && (await fs.stat(target)).size === manifest.size && await sha256(target) === manifest.sha256) {
      this.file = target; this.state.downloaded = manifest.size; this.state.status = "ready"; return;
    }
    const temporary = path.join(this.directory, `${randomUUID()}.part`);
    const handle = await fs.open(temporary, "wx");
    try {
      const response = await this.fetchImpl(manifest.url, { signal: AbortSignal.timeout(15 * 60_000) });
      if (!response.ok) throw new Error(`更新包下载失败（HTTP ${response.status}）。`);
      const hash = createHash("sha256");
      for await (const chunk of response.body) {
        this.state.downloaded += chunk.length;
        if (this.state.downloaded > manifest.size) throw new Error("更新包大小异常，已停止下载。");
        hash.update(chunk); await handle.writeFile(chunk);
      }
      if (this.state.downloaded !== manifest.size || hash.digest("hex") !== manifest.sha256) throw new Error("更新包完整性校验失败，请重新下载。");
      await handle.sync(); await handle.close();
      if (await exists(target)) await fs.unlink(target);
      await fs.rename(temporary, target);
      this.file = target; this.state.status = "ready";
    } finally { await handle.close().catch(() => {}); await fs.unlink(temporary).catch(() => {}); }
  }

  async apply({ launcherPid = 0, serverPid = process.pid } = {}) {
    if (!this.view().canInstall || !launcherPid) throw new Error("请从已安装的 Classmate Lilith 快捷方式启动后安装更新。");
    if (this.installing || this.state.status !== "ready" || !this.manifest || !this.file) throw new Error("请先下载并校验更新包。");
    const busy = this.busyReasons();
    if (busy.length) throw new Error(`暂不能更新：${busy.join("、")}。请完成并保存后重试。`);
    this.installing = true;
    const oldStatus = this.state.status;
    try {
      if (await sha256(this.file) !== this.manifest.sha256) throw new Error("更新包校验失败，未启动安装。");
      this.state.status = "preparing";
      const backup = path.join(this.directory, `rollback-${this.version}-${randomUUID()}`);
      await fs.mkdir(backup);
      // Only program files are copied. User recordings are never moved or removed.
      await fs.cp(this.root, path.join(backup, "app"), { recursive: true, filter: file => !["data", "logs", ".git", "updates"].includes(path.relative(this.root, file).split(path.sep)[0]) });
      const metadata = path.join(backup, "metadata"); await fs.mkdir(metadata);
      for (const name of ["settings.json", "terminology.json", "tasks", "versions"]) {
        const from = path.join(this.dataDir, name);
        if (await exists(from)) await fs.cp(from, path.join(metadata, name), { recursive: true });
      }
      await writeJsonAtomic(path.join(backup, "backup.json"), { version: this.version, createdAt: new Date().toISOString() });
      const nonce = randomUUID(), ready = path.join(this.directory, `${nonce}.ready`), helper = path.join(this.directory, `UpdateHelper-${nonce}.exe`);
      await fs.copyFile(path.join(this.root, "UpdateHelper.exe"), helper);
      const helperConfig = path.join(this.root, "UpdateHelper.exe.config");
      if (await exists(helperConfig)) await fs.copyFile(helperConfig, `${helper}.config`);
      await this.launch(helper, [this.file, this.manifest.sha256, String(serverPid), String(launcherPid), this.root, backup, ready, this.manifest.version]);
      for (let attempt = 0; attempt < 100 && !(await exists(ready)); attempt++) { if (this.state.error) throw new Error(this.state.error); await wait(100); }
      if (!(await exists(ready))) throw new Error("更新助手未能启动，程序保持运行，请重试。");
      this.state.status = "installing";
      return { installing: true };
    } catch (error) { this.installing = false; this.state.status = oldStatus; this.state.error = error.message; throw error; }
  }
}
