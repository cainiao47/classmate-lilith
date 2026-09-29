import { ONLINE_TRANSCRIPTION_PROVIDERS, providerConfigured } from "./modules/online-providers.js";

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
  if (!startedAt) return 0;
  return Math.max(0, (pausedAt || Date.now()) - startedAt - pausedTotal);
}

function updateTimer() {
  elements.elapsed.textContent = formatClock(elapsedMs());
}

function cleanText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, "").trim();
}

function transcriptText() {
  return cleanText(elements.transcript.value || segments.map((item) => item.text).join("\n"));
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
  const options = mediaRecorderOptions();
  mediaRecorder = new MediaRecorder(stream, options);
  mediaRecorder.ondataavailable = (event) => { if (event.data.size) recordingChunks.push(event.data); };
  mediaRecorder.onstop = () => {
    recordingBlob = new Blob(recordingChunks, { type: mediaRecorder.mimeType || options.mimeType || "audio/webm" });
    recordingName = `live-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.${recordingExtension}`;
    elements.downloadAudio.disabled = !recordingBlob.size;
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
  await refreshMicrophones();
}

async function startSession() {
  if (!configuredForLive(elements.provider.value)) {
    return toast(elements.provider.value === "tencent" ? "请先在主工作台设置中补全腾讯云 AppID、SecretId 和 SecretKey。" : "请先在主工作台设置中配置所选服务的 API Key。", "error");
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast("当前浏览器不支持麦克风实时录音。", "error");
  elements.start.disabled = true;
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
        if (phase === "connecting") await beginCapture();
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
        partials.delete(message.id);
        segments = segments.filter((item) => item.id !== message.id);
        segments.push({ id: message.id, text: cleanText(message.text), startMs: Number(message.startMs) || 0, endMs: Number(message.endMs) || elapsedMs() });
        renderPartial();
        renderSegments();
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
      }
    };
  } catch (error) {
    clearTimeout(connectionTimer);
    stopAudioGraph();
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
}

function stopSession({ providerError = false } = {}) {
  if (!["recording", "paused"].includes(phase)) return;
  if (phase === "paused") pausedTotal += Date.now() - pausedAt;
  phase = "finalizing";
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
  enableResults(Boolean(transcriptText()));
  elements.saveState.textContent = "结果尚未保存到历史记录；可先人工修改或直接导出。";
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
  importedJob = await importResponse.json();
  if (!importResponse.ok) throw new Error(importedJob.error || "保存实时转写结果失败。");
  return importedJob;
}

async function createHistoryTask() {
  if (savedTaskId) return savedTaskId;
  const job = await ensureImportedJob();
  const id = `task-${crypto.randomUUID()}`;
  const text = transcriptText();
  const now = new Date().toISOString();
  const task = {
    schemaVersion: 3, id, title: elements.topic.value.trim() || `实时课堂 ${new Date().toLocaleString()}`,
    status: "draft", sourceText: text, background: elements.topic.value.trim(), glossary: elements.keywords.value.trim(),
    textProvider: settings?.textProvider || "deepseek", mode: "standard", transcriptionDraft: text,
    transcriptionEngine: elements.provider.value,
    transcriptionMeta: {
      jobId: job.id, engine: job.engine, engineName: job.engineName, sourceName: recordingName,
      completedAt: now, srt: job.result?.srt || srtText(), approximateTimestamps: Boolean(job.result?.approximateTimestamps),
      audioUrl: `/api/transcription/jobs/${job.id}/audio`, realtime: true
    }
  };
  const response = await fetch(`/api/tasks/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(task) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "保存历史任务失败。");
  savedTaskId = id;
  elements.saveState.textContent = "已保存为历史任务；录音会随任务一同保留。";
  return id;
}

async function saveTask() {
  elements.saveTask.disabled = true;
  elements.sendToReview.disabled = true;
  try {
    await createHistoryTask();
    toast("实时转写和录音已保存到历史记录。 ");
  } catch (error) {
    toast(error.message || "保存失败。", "error");
  } finally {
    elements.saveTask.disabled = false;
    elements.sendToReview.disabled = false;
  }
}

async function sendToReview() {
  elements.saveTask.disabled = true;
  elements.sendToReview.disabled = true;
  try {
    const id = await createHistoryTask();
    location.href = `/?task=${encodeURIComponent(id)}&source=live`;
  } catch (error) {
    toast(error.message || "无法送入人工修订。", "error");
    elements.saveTask.disabled = false;
    elements.sendToReview.disabled = false;
  }
}

elements.start.onclick = startSession;
elements.pause.onclick = togglePause;
elements.stop.onclick = () => stopSession();
elements.provider.onchange = () => { elements.modelField.hidden = elements.provider.value !== "alibaba"; };
elements.transcript.oninput = () => { transcriptEdited = true; elements.wordCount.textContent = `${transcriptText().replace(/\s/g, "").length.toLocaleString()} 字 · 已人工编辑`; savedTaskId = ""; importedJob = null; };
elements.exportTxt.onclick = () => download(`${transcriptText()}\n`, "txt");
elements.exportMd.onclick = () => download(`# ${safeBaseName()}\n\n${transcriptText().replace(/\n/g, "\n\n")}\n`, "md", "text/markdown;charset=utf-8");
elements.exportSrt.onclick = () => download(srtText(), "srt");
elements.downloadAudio.onclick = () => recordingBlob && download(recordingBlob, recordingExtension, recordingBlob.type);
elements.saveTask.onclick = saveTask;
elements.sendToReview.onclick = sendToReview;
elements.provider.onchange = () => setConnection(configuredForLive(elements.provider.value) ? "等待开始" : "需要配置", configuredForLive(elements.provider.value) ? "idle" : "error");
window.addEventListener("beforeunload", (event) => {
  if (recordingBlob?.size && !savedTaskId && phase === "done") { event.preventDefault(); event.returnValue = ""; }
});

loadInitialData().then(() => setConnection("等待开始")).catch((error) => { setConnection("初始化失败", "error"); toast(error.message, "error"); });
