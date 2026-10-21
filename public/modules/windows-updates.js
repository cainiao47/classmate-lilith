export function reportUpdateActivity(getState, kind = "main") {
  const id = crypto.randomUUID(); let enabled = false;
  const flush = async () => {
    if (!enabled) return;
    await fetch("/api/client-activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, kind, ...getState() }) }).catch(() => {});
  };
  fetch("/api/updates").then(r => r.json()).then(info => {
    if (!info.supported) return;
    enabled = true; flush();
    const timer = setInterval(flush, 5_000);
    document.addEventListener("input", flush);
    window.addEventListener("pagehide", () => {
      clearInterval(timer);
      navigator.sendBeacon?.("/api/client-activity", new Blob([JSON.stringify({ id, closed: true })], { type: "application/json" }));
    }, { once: true });
  }).catch(() => {});
  return { flush };
}

export function initWindowsUpdates({ save, activity }) {
  const button = document.querySelector("#windowsUpdateButton"), dialog = document.querySelector("#windowsUpdateDialog");
  if (!button || !dialog) return;
  const $ = selector => dialog.querySelector(selector);
  let info, polling = null;
  const leases = reportUpdateActivity(activity);
  async function api(url, body) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    const result = await response.json(); if (!response.ok) throw Error(result.error || "更新操作失败"); return result;
  }
  function render(value) {
    info = value;
    $("#updateVersion").textContent = `当前版本 ${value.currentVersion}${value.latestVersion ? ` · 最新正式版 ${value.latestVersion}` : ""}`;
    const labels = { idle: "等待检查", checking: "正在检查更新…", current: "当前已是最新版本", available: "发现可用更新", manual: "新版需要手动下载安装包", downloading: "正在下载更新…", ready: "更新包已下载并通过校验", preparing: "正在备份程序与任务信息…", installing: "正在安装，稍后将重新打开工作台", error: "检查或下载未完成，当前版本仍可使用" };
    $("#updateMessage").textContent = value.error || labels[value.status] || "";
    $("#updateDownload").hidden = !value.installed || !["available", "error"].includes(value.status) || !value.total;
    $("#updateInstall").hidden = value.status !== "ready" || !value.canInstall;
    $("#updateInstall").disabled = Boolean(value.busyReasons?.length);
    $("#updateBusy").textContent = value.busyReasons?.length ? `安装前请处理：${value.busyReasons.join("、")}` : "更新会保留设置、术语库、任务和录音。";
    $("#updateReleaseLink").href = value.releaseUrl;
    $("#updateDataDirectory").textContent = value.dataDirectory ? `数据位置：${value.dataDirectory}` : "";
    $("#updatePortable").hidden = value.installed;
    const percent = value.total ? Math.min(100, Math.round(value.downloaded / value.total * 100)) : 0;
    $("#updateDownloadProgress").hidden = value.status !== "downloading";
    $("#updateDownloadProgress").textContent = `已下载 ${percent}%`;
    $("#updateCheck").disabled = ["checking", "downloading", "preparing", "installing"].includes(value.status);
    if (value.status === "available") button.textContent = "有可用更新";
    else button.textContent = "检查更新";
  }
  function error(error) { $("#updateMessage").textContent = error.message || "更新操作失败"; }
  async function refresh() {
    try { const response = await fetch("/api/updates"); render(await response.json()); }
    catch { if (info?.status === "installing") $("#updateMessage").textContent = "应用正在更新，请等待工作台重新打开。"; }
  }
  button.onclick = async () => { dialog.showModal(); await refresh(); clearInterval(polling); polling = setInterval(refresh, 1_000); };
  $("#updateClose").onclick = () => dialog.close();
  dialog.addEventListener("close", () => { clearInterval(polling); polling = null; });
  $("#updateCheck").onclick = async () => { try { render(await api("/api/updates/check", { force: true })); } catch (e) { error(e); } };
  $("#updateDownload").onclick = async () => { try { render(await api("/api/updates/download")); } catch (e) { error(e); } };
  $("#updateInstall").onclick = async () => {
    if (activity().busy) return error(new Error("请先完成转写或整理任务。"));
    if (!confirm("将保存当前任务，退出本地服务并安装新版。设置、历史任务和录音会保留，是否继续？")) return;
    try {
      await save(); await leases.flush();
      $("#updateInstall").disabled = true;
      $("#updateMessage").textContent = "正在备份并准备安装，请稍候…";
      const result = await api("/api/updates/install");
      if (result.installing) { info.status = "installing"; $("#updateMessage").textContent = "正在安装更新，稍后将自动重新打开工作台。"; }
    } catch (e) { error(e); $("#updateInstall").disabled = false; }
  };
  fetch("/api/updates").then(r => r.json()).then(async value => {
    if (!value.supported) return;
    button.hidden = false; render(value);
    try { render(await api("/api/updates/check")); } catch { /* Offline startup must remain usable. */ }
  }).catch(() => {});
}
