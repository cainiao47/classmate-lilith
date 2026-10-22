import { ONLINE_TRANSCRIPTION_PROVIDERS, providerConfigured } from "./modules/online-providers.js";
import { reportUpdateActivity } from "./modules/windows-updates.js";
import { liveProtection } from "./modules/workspace-lifecycle.js";
import { createLiveBackup } from "./modules/live-backup.js";

const $ = (selector) => document.querySelector(selector);
const elements = {
  provider: $("#liveProvider"), model: $("#liveModel"), modelField: $("#liveModelField"), language: $("#liveLanguage"), microphone: $("#liveMicrophone"),
  noiseReduction: $("#liveNoiseReduction"), topic: $("#liveTopic"), keywords: $("#liveKeywords"),
  start: $("#liveStart"), pause: $("#livePause"), stop: $("#liveStop"), elapsed: $("#liveElapsed"),
  meterBar: $("#liveMeterBar"), connection: $("#liveConnectionState"), headerStatus: $("#liveHeaderStatus"),
  partial: $("#livePartial"), segments: $("#liveSegments"), transcript: $("#liveTranscript"),
  wordCount: $("#liveWordCount"), exportTxt: $("#liveExportTxt"), exportMd: $("#liveExportMd"),
  exportSrt: $("#liveExportSrt"), downloadAudio: $("#liveDownloadAudio"), saveTask: $("#liveSaveTask"),
  sendToReview: $("#liveSendToReview"), saveState: $("#liveSaveState"), toast: $("#liveToast")
};

let settings = null;
let socket = null;
let stream = null;
let audioContext = null;
let processor = null;
let silentGain = null;
let mediaRecorder = null;
let recordingChunks = [];
let recordingBlob = null;
let recordingExtension = "webm";
let recordingName = "";
let sampleRate = 16000;
let phase = "idle";
let startedAt = 0;
let pausedAt = 0;
let pausedTotal = 0;
let timer = null;
let connectionTimer = null;
let speechActive = false;
let lastVoiceAt = 0;
let segments = [];
let partials = new Map();
let importedJob = null;
let savedTaskId = "";
let transcriptEdited = false;
let updateLease = { flush: async () => {} };
let liveRevision = 0, liveSavedRevision = 0, saving = false, leavingConfirmed = false;
let backup = null, recoveryId = "", stoppedDuration = null, recoveryLoading = false;
let lastCheckpointAt = 0;
const returnTask = new URLSearchParams(location.search).get("returnTask");
const returnPath = returnTask && /^[a-zA-Z0-9_-]{8,80}$/.test(returnTask) ? `/?task=${encodeURIComponent(returnTask)}` : "/";
function protection() { return liveProtection({ phase, hasRecording: Boolean(recordingBlob?.size || (recoveryId && transcriptText())), savedTaskId, revision: liveRevision, savedRevision: liveSavedRevision, saving: saving || recoveryLoading }); }
function setSaving(value) {
  saving = value;
  elements.saveTask.disabled = value; elements.sendToReview.disabled = value;
  elements.transcript.readOnly = value; elements.topic.readOnly = value; elements.keywords.readOnly = value;
  elements.start.disabled = value || !configuredForLive(elements.provider.value) || protection().busy;
  updateLease.flush();
}

function toast(message, kind = "info") {
  elements.toast.textContent = message;
  elements.toast.className = `toast ${kind}`;
  elements.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { elements.toast.hidden = true; }, 3200);
}

function setConnection(label, state = "idle") {
  elements.connection.textContent = label;
  elements.connection.className = `live-connection-state ${state}`;
  elements.headerStatus.textContent = label;
  updateLease.flush();
}

function formatClock(milliseconds, withMillis = false) {
  const value = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor(value % 3_600_000 / 60_000);
  const seconds = Math.floor(value % 60_000 / 1000);
  const millis = value % 1000;
  const base = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return withMillis ? `${base},${String(millis).padStart(3, "0")}` : base;
}

function elapsedMs() {
  if (stoppedDuration !== null) return stoppedDuration;
  if (!startedAt) return 0;
  return Math.max(0, (pausedAt || Date.now()) - startedAt - pausedTotal);
}

function backupSnapshot() {
  return { topic: elements.topic.value, keywords: elements.keywords.value, provider: elements.provider.value, model: elements.model.value,
    language: elements.language.value, text: transcriptText(), segments, durationMs: elapsedMs(), phase };
}

function newBackup() {
  const instance = createLiveBackup({ snapshot: backupSnapshot,
    onStatus(state) {
      if (backup !== instance) return;
      const status = $("#liveBackupStatus");
      status.classList.toggle("backup-error", state.failed);
      status.textContent = state.failed ? `恢复点写入失败，${state.pending} 段音频等待重试。请勿关闭程序；可结束后手动保存录音。`
        : `本机已落盘 ${state.count} 段${state.lastSavedAt ? ` · ${new Date(state.lastSavedAt).toLocaleTimeString()}` : ""}${state.pending ? ` · ${state.pending} 段等待写入` : ""}。异常退出后可从此页恢复。`;
    }, onError() { /* Persistent status above is deliberately not a transient toast. */ }
  });
  return instance;
}

async function refreshRecoveries() {
  const panel = $("#liveRecoveryPanel"), list = $("#liveRecoveryList");
  try {
    const response = await fetch("/api/live-recordings", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw Error(payload.error || "恢复点列表读取失败。");
    list.replaceChildren();
    const recordings = (payload.recordings || []).filter(item => item.id !== recoveryId);
    panel.hidden = !recordings.length;
    for (const item of recordings) {
      const row = document.createElement("div"), text = document.createElement("p"), button = document.createElement("button");
      row.className = "live-recovery-item";
      text.textContent = `${item.topic || "未命名录音"} · ${item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "时间未知"} · ${item.persistedChunks || 0} 段 · ${((item.bytes || 0) / 1024 / 1024).toFixed(1)} MB${item.damaged ? " · 文件可能不完整" : ""}`;
      button.type = "button"; button.className = "secondary-button"; button.textContent = item.active ? "其他窗口正在录音" : "恢复录音与文稿"; button.disabled = Boolean(item.active);
      button.onclick = () => restoreRecording(item.id);
      row.append(text, button); list.append(row);
    }
  } catch (error) { panel.hidden = false; list.textContent = error.message || "恢复点列表读取失败，可点击刷新重试。"; }
}

async function restoreRecording(id) {
  if (protection().busy) return toast("请先结束录音或保存，再恢复其他录音。", "error");
  if (protection().dirty && !confirm("当前录音尚未保存，切换后仍可从恢复点找回已落盘的部分。是否恢复所选录音？")) return;
  recoveryLoading = true; elements.start.disabled = true; await updateLease.flush();
  try {
    if (backup) await backup.flush();
    const response = await fetch(`/api/live-recordings/${id}`, { cache: "no-store" }), record = await response.json();
    if (!response.ok) throw Error(record.error || "读取恢复点失败。");
    if (record.active) throw Error("该录音仍在其他窗口进行。异常中断后请稍候 15 秒，再刷新列表。");
    if (record.savedTaskId) throw Error("该录音已保存为工程，请从工程历史打开。");
    let blob = null, audioWarning = "";
    if (record.bytes && !record.damaged) {
      const audio = await fetch(`/api/live-recordings/${id}/audio`);
      if (!audio.ok) throw Error("合并恢复音频失败；恢复点仍保留，可稍后重试。");
      blob = await audio.blob();
    } else audioWarning = "音频为空或不完整，已保留原文件；可以先保存恢复的文稿。";
    backup?.stop();
    recoveryId = id; importedJob = null; savedTaskId = ""; liveRevision = 0; liveSavedRevision = 0;
    recordingChunks = []; recordingBlob = blob; recordingExtension = record.extension;
    recordingName = `recovered-${id}.${record.extension}`;
    stoppedDuration = record.durationMs; phase = "done";
    elements.topic.value = record.topic; elements.keywords.value = record.keywords;
    elements.provider.value = record.provider; elements.model.value = record.model; elements.language.value = record.language;
    elements.modelField.hidden = record.provider !== "alibaba";
    segments = record.segments || []; partials.clear(); renderPartial(); transcriptEdited = true;
    elements.transcript.value = typeof record.text === "string" ? record.text : segments.map(item => item.text).join("\n"); renderSegments();
    elements.transcript.disabled = false; elements.pause.disabled = true; elements.stop.disabled = true;
    updateTimer(); enableResults(Boolean(blob?.size || transcriptText())); elements.downloadAudio.disabled = !blob?.size;
    backup = newBackup(); backup.attach(record);
    setConnection("已恢复，待保存", "ready");
    elements.saveState.textContent = audioWarning || "已恢复落盘部分；异常发生前尚未写入的末尾音频或文字可能缺失。请试听并保存为工程。";
    await refreshRecoveries();
    toast("已恢复本机录音与最近保存的文稿。 ");
  } catch (error) { toast(error.message || "录音恢复失败。", "error"); }
  finally { recoveryLoading = false; elements.start.disabled = !configuredForLive(elements.provider.value); await updateLease.flush(); }
}

function updateTimer() {
  elements.elapsed.textContent = formatClock(elapsedMs());
  if (["recording", "paused"].includes(phase) && Date.now() - lastCheckpointAt > 5000) { lastCheckpointAt = Date.now(); backup?.checkpoint(); }
}

function cleanText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, "").trim();
}

function transcriptText() {
  return cleanText(transcriptEdited ? elements.transcript.value : (elements.transcript.value || segments.map((item) => item.text).join("\n")));
}

function renderPartial() {
  const text = [...partials.values()].filter(Boolean).join("");
  elements.partial.hidden = !text;
  elements.partial.querySelector("p").textContent = text;
}

function renderSegments() {
  const ordered = [...segments].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  elements.segments.replaceChildren();
  if (!ordered.length) {
    const empty = document.createElement("div");
    empty.className = "live-empty";
    empty.textContent = phase === "idle" ? "开始录音后，已确认的转写片段会依次出现在这里。" : "正在等待第一段稳定转写结果……";
    elements.segments.append(empty);
  } else {
    for (const segment of ordered) {
      const item = document.createElement("div");
      item.className = "live-segment";
      const time = document.createElement("time");
      time.textContent = formatClock(segment.startMs);
      const text = document.createElement("p");
      text.textContent = segment.text;
      item.append(time, text);
      elements.segments.append(item);
    }
    elements.segments.lastElementChild?.scrollIntoView({ block: "nearest" });
  }
  if (!transcriptEdited || phase === "recording" || phase === "paused" || phase === "finalizing") {
    elements.transcript.value = ordered.map((item) => item.text).join("\n");
  }
  const count = transcriptText().replace(/\s/g, "").length;
  elements.wordCount.textContent = `${count.toLocaleString()} 字 · ${ordered.length} 段`;
}

function enableResults(enabled) {
  for (const button of [elements.exportTxt, elements.exportMd, elements.downloadAudio, elements.saveTask, elements.sendToReview]) button.disabled = !enabled;
  elements.exportSrt.disabled = !enabled || !segments.length;
  elements.transcript.disabled = !enabled;
}

function configuredForLive(provider) {
  if (!providerConfigured(settings, provider)) return false;
  return provider !== "tencent" || Boolean(settings.tencentAppId);
}

function refreshProviderOptions() {
  for (const option of elements.provider.options) {
    const configured = configuredForLive(option.value);
    option.textContent = `${ONLINE_TRANSCRIPTION_PROVIDERS.find((item) => item.id === option.value)?.name || option.textContent}${configured ? "" : " · 未完整配置"}`;
  }
  const preferred = settings?.asrProvider || "alibaba";
  elements.provider.value = elements.provider.querySelector(`option[value="${preferred}"]`) ? preferred : "alibaba";
  elements.modelField.hidden = elements.provider.value !== "alibaba";
}

async function loadInitialData() {
  const [settingsResponse, terminologyResponse] = await Promise.all([fetch("/api/settings", { cache: "no-store" }), fetch("/api/terminology", { cache: "no-store" })]);
  settings = await settingsResponse.json();
  if (!settingsResponse.ok) throw new Error(settings.error || "读取在线服务设置失败。");
  refreshProviderOptions();
  if (terminologyResponse.ok) {
    const library = await terminologyResponse.json();
    const defaultIds = new Set((library.groups || []).filter((group) => group.defaultEnabled).map((group) => group.id));
    const terms = (library.terms || []).filter((term) => term.enabled !== false && defaultIds.has(term.groupId)).map((term) => term.canonical).filter(Boolean);
    elements.keywords.value = [...new Set(terms)].join("\n");
  }
  await refreshMicrophones();
  if (returnPath !== "/") {
    const response = await fetch(`/api/tasks/${encodeURIComponent(returnTask)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("原工程读取失败，请返回工作台从工程历史重新打开。");
    const task = await response.json();
    elements.topic.value = task.background || ""; elements.keywords.value = task.glossary || elements.keywords.value;
  }
  for (const link of document.querySelectorAll('.live-topbar a[href="/"]')) link.href = returnPath;
  $("#liveConfigureLink").href = returnPath + (returnPath.includes("?") ? "&settings=1" : "?settings=1");
}

async function refreshMicrophones() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const selected = elements.microphone.value;
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
  elements.microphone.replaceChildren(new Option("系统默认麦克风", ""));
  devices.forEach((device, index) => elements.microphone.append(new Option(device.label || `麦克风 ${index + 1}`, device.deviceId)));
  if ([...elements.microphone.options].some((option) => option.value === selected)) elements.microphone.value = selected;
}

function mediaRecorderOptions() {
  const candidates = [
    ["audio/webm;codecs=opus", "webm"], ["audio/mp4", "m4a"], ["audio/webm", "webm"], ["audio/ogg;codecs=opus", "ogg"]
  ];
  const match = candidates.find(([mime]) => window.MediaRecorder?.isTypeSupported?.(mime));
  recordingExtension = match?.[1] || "webm";
  return match ? { mimeType: match[0], audioBitsPerSecond: 64000 } : { audioBitsPerSecond: 64000 };
}

function downsampleToPcm16(input, inputRate, outputRate) {
  if (outputRate > inputRate) outputRate = inputRate;
  const ratio = inputRate / outputRate;
  const length = Math.max(1, Math.round(input.length / ratio));
  const output = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
    let sum = 0;
    for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) sum += input[sourceIndex];
    const sample = Math.max(-1, Math.min(1, sum / (end - start)));
    output[index] = sample < 0 ? sample * 32768 : sample * 32767;
  }
  return output.buffer;
}

function stopAudioGraph() {
  processor?.disconnect();
  silentGain?.disconnect();
  processor = null;
  silentGain = null;
  audioContext?.close().catch(() => {});
  audioContext = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  elements.meterBar.style.width = "0%";
}

async function beginCapture() {
  clearTimeout(connectionTimer);
  if (backup) await backup.flush();
  const options = mediaRecorderOptions();
  const nextBackup = newBackup();
  const nextRecoveryId = await nextBackup.start({ ...backupSnapshot(), text: "", segments: [], durationMs: 0, phase: "recording", extension: recordingExtension });
  backup?.stop(); backup = nextBackup;
  segments = []; partials.clear(); elements.transcript.value = ""; transcriptEdited = false;
  liveRevision = 0; liveSavedRevision = 0; stoppedDuration = null; recoveryId = nextRecoveryId;
  startedAt = 0; pausedAt = 0; pausedTotal = 0;
  audioContext = new AudioContext({ latencyHint: "interactive" });
  const source = audioContext.createMediaStreamSource(stream);
  processor = audioContext.createScriptProcessor(4096, 1, 1);
  silentGain = audioContext.createGain();
  silentGain.gain.value = 0;
  source.connect(processor);
  processor.connect(silentGain);
  silentGain.connect(audioContext.destination);
  processor.onaudioprocess = (event) => {
    if (phase !== "recording" || socket?.readyState !== WebSocket.OPEN) return;
    const input = event.inputBuffer.getChannelData(0);
    let energy = 0;
    for (let index = 0; index < input.length; index += 1) energy += input[index] * input[index];
    const rms = Math.sqrt(energy / input.length);
    elements.meterBar.style.width = `${Math.min(100, Math.max(1, rms * 520))}%`;
    const now = Date.now();
    if (rms > .012) { speechActive = true; lastVoiceAt = now; }
    else if (speechActive && now - lastVoiceAt > 900) {
      speechActive = false;
      socket.send(JSON.stringify({ type: "commit" }));
    }
    socket.send(downsampleToPcm16(input, audioContext.sampleRate, sampleRate));
  };
  recordingChunks = [];
  recordingBlob = null;
  importedJob = null;
  savedTaskId = "";
  mediaRecorder = new MediaRecorder(stream, options);
  mediaRecorder.ondataavailable = (event) => { if (event.data.size) { recordingChunks.push(event.data); backup.append(event.data); } };
  mediaRecorder.onstop = () => {
    recordingBlob = new Blob(recordingChunks, { type: mediaRecorder.mimeType || options.mimeType || "audio/webm" });
    recordingName = `live-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.${recordingExtension}`;
    elements.downloadAudio.disabled = !recordingBlob.size;
    backup.checkpoint();
    maybeFinish();
  };
  mediaRecorder.start(1000);
  startedAt = Date.now();
  pausedTotal = 0;
  pausedAt = 0;
  phase = "recording";
  timer = setInterval(updateTimer, 250);
  elements.start.disabled = true;
  elements.pause.disabled = false;
  elements.stop.disabled = false;
  elements.provider.disabled = true;
  elements.model.disabled = true;
  elements.language.disabled = true;
  elements.microphone.disabled = true;
  setConnection("正在转写", "ready");
  renderSegments();
  await refreshMicrophones().catch(() => {});
}

async function startSession() {
  if (protection().busy) return;
  if (protection().dirty && !confirm("上一段录音或修改尚未保存。开始新录音会替换页面中的旧结果，仍要继续吗？")) return;
  if (!configuredForLive(elements.provider.value)) {
    return toast(elements.provider.value === "tencent" ? "请先在主工作台设置中补全腾讯云 AppID、SecretId 和 SecretKey。" : "请先在主工作台设置中配置所选服务的 API Key。", "error");
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast("当前浏览器不支持麦克风实时录音。", "error");
  elements.start.disabled = true;
  phase = "requesting";
  setConnection("请求麦克风…");
  try {
    const deviceId = elements.microphone.value;
    const processing = elements.noiseReduction.checked;
    stream = await navigator.mediaDevices.getUserMedia({ audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}), channelCount: 1,
      echoCancellation: processing, noiseSuppression: processing, autoGainControl: processing
    } });
    phase = "connecting";
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${location.host}/api/live`);
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      setConnection("连接在线服务…");
      const keywords = elements.keywords.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      socket.send(JSON.stringify({
        type: "start", provider: elements.provider.value, model: elements.model.value, language: elements.language.value,
        prompt: [elements.topic.value.trim(), keywords.join("，")].filter(Boolean).join("；"), keywords
      }));
      connectionTimer = setTimeout(() => {
        if (phase !== "connecting") return;
        socket.close();
        stopAudioGraph();
        phase = "idle";
        elements.start.disabled = false;
        setConnection("连接超时", "error");
        toast("在线实时服务连接超时，请检查网络、密钥和模型权限。", "error");
      }, 15000);
    };
    socket.onmessage = async (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "ready") {
        sampleRate = Number(message.sampleRate) || 16000;
        if (phase === "connecting") {
          try { await beginCapture(); }
          catch (error) { phase = "idle"; socket?.close(); stopAudioGraph(); elements.start.disabled = false; setConnection("无法开始", "error"); toast(error.message || "本机录音恢复点无法创建，未开始录音。", "error"); }
        }
        else if (["recording", "paused"].includes(phase)) {
          setConnection(message.reconnected ? "已恢复转写" : "正在转写", "ready");
          if (message.reconnected) toast(`实时转写已恢复${message.bufferedMs ? `，已补送约 ${(message.bufferedMs / 1000).toFixed(1)} 秒缓冲音频` : ""}。`);
        }
      } else if (message.type === "reconnecting") {
        partials.clear();
        renderPartial();
        setConnection(`重连中 ${message.attempt}`, "error");
        toast("在线识别暂时断开，正在自动重连；本机录音不会停止。", "error");
      } else if (message.type === "partial") {
        const previous = partials.get(message.id) || "";
        partials.set(message.id, message.append ? previous + message.text : message.text);
        renderPartial();
      } else if (message.type === "final") {
        liveRevision++;
        partials.delete(message.id);
        segments = segments.filter((item) => item.id !== message.id);
        segments.push({ id: message.id, text: cleanText(message.text), startMs: Number(message.startMs) || 0, endMs: Number(message.endMs) || elapsedMs() });
        renderPartial();
        renderSegments();
        backup?.checkpoint();
      } else if (message.type === "finished") {
        if (phase === "finalizing") phase = "done";
        maybeFinish();
      } else if (message.type === "error") {
        setConnection("识别异常", "error");
        toast(message.error || "实时识别失败，本机录音仍可保存。", "error");
        if (phase === "connecting") {
          clearTimeout(connectionTimer);
          socket.close();
          stopAudioGraph();
          phase = "idle";
          elements.start.disabled = false;
        } else if (["recording", "paused"].includes(phase)) {
          setConnection("识别暂不可用", "error");
          toast(`${message.error || "实时识别暂不可用"} 本机录音仍在继续，可稍后结束并保存。`, "error");
        }
      }
    };
    socket.onerror = () => {
      clearTimeout(connectionTimer);
      setConnection("连接失败", "error");
      toast("无法连接实时转写服务。", "error");
      if (["idle", "connecting"].includes(phase)) { stopAudioGraph(); phase = "idle"; elements.start.disabled = false; }
    };
    socket.onclose = () => {
      clearTimeout(connectionTimer);
      if (["recording", "paused"].includes(phase)) {
        toast("实时服务连接已断开，本机录音正在收尾。", "error");
        stopSession({ providerError: true });
      } else if (phase === "finalizing") {
        phase = "done";
        maybeFinish();
      }
    };
  } catch (error) {
    clearTimeout(connectionTimer);
    stopAudioGraph();
    phase = "idle";
    elements.start.disabled = false;
    setConnection("无法开始", "error");
    toast(error.name === "NotAllowedError" ? "没有获得麦克风权限，请在浏览器中允许后重试。" : (error.message || "无法开始实时录音。"), "error");
  }
}

function togglePause() {
  if (phase === "recording") {
    phase = "paused";
    pausedAt = Date.now();
    mediaRecorder?.pause();
    elements.pause.textContent = "继续录音";
    setConnection("已暂停");
  } else if (phase === "paused") {
    pausedTotal += Date.now() - pausedAt;
    pausedAt = 0;
    phase = "recording";
    mediaRecorder?.resume();
    elements.pause.textContent = "暂停录音";
    setConnection("正在转写", "ready");
  }
  backup?.checkpoint();
}

function stopSession({ providerError = false } = {}) {
  if (!["recording", "paused"].includes(phase)) return;
  const duration = elapsedMs();
  if (phase === "paused") pausedTotal += Date.now() - pausedAt;
  phase = "finalizing";
  stoppedDuration = duration;
  backup?.checkpoint();
  clearInterval(timer);
  updateTimer();
  elements.pause.disabled = true;
  elements.stop.disabled = true;
  elements.pause.textContent = "暂停录音";
  setConnection(providerError ? "保存本机录音…" : "正在收尾…");
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  stopAudioGraph();
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "commit" }));
    socket.send(JSON.stringify({ type: "stop" }));
  } else {
    phase = "done";
    maybeFinish();
  }
}

function maybeFinish() {
  if (phase !== "done" || !recordingBlob) return;
  socket?.close();
  setConnection("转写完成", "ready");
  elements.start.disabled = false;
  elements.provider.disabled = false;
  elements.model.disabled = false;
  elements.language.disabled = false;
  elements.microphone.disabled = false;
  elements.transcript.disabled = false;
  enableResults(Boolean(recordingBlob?.size || transcriptText()));
  elements.saveState.textContent = "结果尚未保存到历史记录；可先人工修改或直接导出。";
  backup?.checkpoint();
  toast("实时转写已结束，可以导出或送入人工修订。 ");
}

function safeBaseName() {
  return (elements.topic.value.trim() || "实时课堂转写").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 80);
}

function download(content, extension, type = "text/plain;charset=utf-8") {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  link.download = `${safeBaseName()}.${extension}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function srtText() {
  return [...segments].sort((a, b) => a.startMs - b.startMs).map((segment, index) => `${index + 1}\n${formatClock(segment.startMs, true)} --> ${formatClock(Math.max(segment.endMs, segment.startMs + 200), true)}\n${segment.text}\n`).join("\n");
}

async function ensureImportedJob() {
  if (importedJob) return importedJob;
  if (!recordingBlob?.size && recoveryId && transcriptText()) return null;
  if (!recordingBlob?.size) throw new Error("没有可保存的本机录音。");
  elements.saveState.textContent = "正在保存录音与实时转写稿……";
  const uploadResponse = await fetch(`/api/transcription/upload?filename=${encodeURIComponent(recordingName)}`, { method: "POST", body: recordingBlob });
  const upload = await uploadResponse.json();
  if (!uploadResponse.ok) throw new Error(upload.error || "保存本机录音失败。");
  const importResponse = await fetch("/api/transcription/live-result", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourcePath: upload.filePath, originalName: recordingName, engine: elements.provider.value,
      language: elements.language.value, text: transcriptText(), durationMs: elapsedMs(), segments
    })
  });
  const imported = await importResponse.json().catch(() => ({}));
  if (!importResponse.ok) throw new Error(imported.error || "保存实时转写结果失败。");
  if (!imported?.id) throw new Error("服务没有返回有效的实时转写任务编号。");
  importedJob = imported;
  return importedJob;
}

async function createHistoryTask() {
  const revision = liveRevision;
  const job = await ensureImportedJob();
  const id = savedTaskId || `task-${crypto.randomUUID()}`;
  const text = transcriptText();
  const now = new Date().toISOString();
  const task = {
    schemaVersion: 3, id, title: elements.topic.value.trim() || `实时课堂 ${new Date().toLocaleString()}`,
    status: "draft", sourceText: text, background: elements.topic.value.trim(), glossary: elements.keywords.value.trim(),
    textProvider: settings?.textProvider || "deepseek", mode: "standard", transcriptionDraft: text,
    transcriptionEngine: elements.provider.value,
    liveRecordingRecoveryId: recoveryId || undefined,
    transcriptionMeta: job ? {
      jobId: job.id, engine: job.engine, engineName: job.engineName, sourceName: recordingName,
      completedAt: now, srt: job.result?.srt || srtText(), approximateTimestamps: Boolean(job.result?.approximateTimestamps),
      audioUrl: `/api/transcription/jobs/${job.id}/audio`, realtime: true
    } : null
  };
  const response = await fetch(`/api/tasks/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(task) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "保存历史任务失败。");
  const wasSaved = Boolean(savedTaskId);
  savedTaskId = id;
  liveSavedRevision = revision;
  if (backup) {
    try {
      if (!await backup.complete(id)) elements.saveState.textContent = "工程已保存，录音恢复点归档未完成，仍保留在本机。";
      else $("#liveBackupStatus").textContent = "已保存为工程，恢复点已归档（原分段仍保留在本机）。";
    } catch { $("#liveBackupStatus").textContent = "工程已保存，恢复点尚未归档；原分段仍保留，可稍后重试。"; }
  }
  await updateLease.flush();
  elements.saveState.textContent = wasSaved
    ? "已更新历史任务；录音仍与此任务关联。"
    : "已保存为历史任务；录音会随任务一同保留。";
  return id;
}

async function saveTask() {
  if (saving) return;
  setSaving(true);
  try {
    await createHistoryTask();
    toast("实时转写和录音已保存到历史记录。 ");
  } catch (error) {
    toast(error.message || "保存失败。", "error");
  } finally {
    setSaving(false);
  }
}

async function sendToReview() {
  if (saving) return;
  setSaving(true);
  try {
    const id = await createHistoryTask();
    leavingConfirmed = true;
    location.href = `/?task=${encodeURIComponent(id)}&source=live`;
  } catch (error) {
    toast(error.message || "无法送入人工修订。", "error");
    setSaving(false);
  }
}

elements.start.onclick = startSession;
elements.pause.onclick = togglePause;
elements.stop.onclick = () => stopSession();
elements.provider.onchange = () => {
  elements.modelField.hidden = elements.provider.value !== "alibaba";
  setConnection(configuredForLive(elements.provider.value) ? "等待开始" : "需要配置", configuredForLive(elements.provider.value) ? "idle" : "error");
  elements.start.disabled = !configuredForLive(elements.provider.value);
  $("#livePreflight").hidden = configuredForLive(elements.provider.value);
};
elements.transcript.oninput = () => {
  transcriptEdited = true;
  liveRevision++;
  elements.wordCount.textContent = `${transcriptText().replace(/\s/g, "").length.toLocaleString()} 字 · 已人工编辑`;
  if (savedTaskId) elements.saveState.textContent = "文稿已有修改，请再次保存以更新历史任务。";
  backup?.checkpoint();
};
elements.exportTxt.onclick = () => download(`${transcriptText()}\n`, "txt");
elements.exportMd.onclick = () => download(`# ${safeBaseName()}\n\n${transcriptText().replace(/\n/g, "\n\n")}\n`, "md", "text/markdown;charset=utf-8");
elements.exportSrt.onclick = () => download(srtText(), "srt");
elements.downloadAudio.onclick = () => recordingBlob && download(recordingBlob, recordingExtension, recordingBlob.type);
elements.saveTask.onclick = saveTask;
elements.sendToReview.onclick = sendToReview;
for (const element of [elements.topic, elements.keywords]) element.addEventListener("input", () => { liveRevision++; if(savedTaskId) elements.saveState.textContent="课程语境已有修改，请再次保存。"; backup?.checkpoint(); updateLease.flush(); });
for (const link of document.querySelectorAll('.live-topbar a')) link.addEventListener("click", event => {
  const current = protection();
  if (current.busy) { event.preventDefault(); toast(current.message, "error"); return; }
  if (current.dirty) {
    if (!confirm("录音或文稿修改尚未保存，离开将放弃页面中未保存的内容。建议先保存。仍要离开吗？")) event.preventDefault();
    else leavingConfirmed = true;
  }
});
window.addEventListener("beforeunload", event => { if(!leavingConfirmed && protection().warn) { event.preventDefault(); event.returnValue=""; } });
window.classmatePrepareExit = () => { window.classmateExitStatus = protection().warn ? "blocked" : "ready"; };
window.classmateCancelExit = () => { window.classmateExitStatus = "idle"; };

elements.start.disabled = true;
$("#liveRefreshRecovery").onclick = refreshRecoveries;
loadInitialData().then(() => { const ready=configuredForLive(elements.provider.value);setConnection(ready?"等待开始":"需要配置",ready?"idle":"error");elements.start.disabled=!ready;$("#livePreflight").hidden=ready; return refreshRecoveries(); }).catch((error) => { setConnection("初始化失败", "error"); toast(error.message, "error"); });
updateLease = reportUpdateActivity(() => ({ busy: protection().busy, dirty: protection().dirty }), "live");
