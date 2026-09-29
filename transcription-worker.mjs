import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomic } from "./lib/json-file.mjs";
import { mediaPaths, terminateProcessTree } from "./lib/platform.mjs";
import { approximateSegments, buildSrt, cleanText } from "./lib/transcription-text.mjs";
import { ONLINE_TRANSCRIPTION_PROVIDERS, isAlibabaFileModel } from "./public/modules/online-providers.js";

const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".mp4", ".mkv", ".mov", ".avi", ".webm"]);
const ONLINE_ENGINES = Object.fromEntries(ONLINE_TRANSCRIPTION_PROVIDERS.map((provider) => [provider.id, provider.name]));

function safeName(value) {
  const cleaned = String(value || "recording").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  return cleaned.slice(0, 120) || "recording";
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key, value) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest();
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

export class TranscriptionManager {
  constructor({ appRoot, dataDir, runtimeLogger = null }) {
    this.appRoot = appRoot;
    this.dataDir = dataDir;
    this.root = path.resolve(appRoot);
    this.jobs = new Map();
    this.runtimeLogger = runtimeLogger;
  }

  async initialize() {
    await fs.mkdir(path.join(this.dataDir, "transcriptions", "uploads"), { recursive: true });
    await fs.mkdir(path.join(this.dataDir, "transcriptions", "jobs"), { recursive: true });
  }

  paths() {
    return mediaPaths(this.root);
  }

  async saveUpload(req, originalName) {
    const extension = path.extname(originalName || "").toLowerCase();
    if (!AUDIO_EXTENSIONS.has(extension)) throw new Error("请选择受支持的音频或视频文件。");
    const id = `upload-${crypto.randomUUID()}`;
    const uploadDir = path.join(this.dataDir, "transcriptions", "uploads");
    const filePath = path.join(uploadDir, `${id}${extension}`);
    const handle = await fs.open(filePath, "wx");
    let total = 0;
    const maxBytes = 16 * 1024 * 1024 * 1024;
    try {
      for await (const chunk of req) {
        total += chunk.length;
        if (total > maxBytes) throw new Error("文件超过 16 GB，无法导入。");
        await handle.write(chunk);
      }
    } catch (error) {
      await handle.close();
      await fs.unlink(filePath).catch(() => {});
      throw error;
    }
    await handle.close();
    if (!total) { await fs.unlink(filePath).catch(() => {}); throw new Error("导入的文件为空。"); }
    return { id, filePath, originalName: safeName(originalName), size: total };
  }

  async start(input) {
    const onlineName = ONLINE_ENGINES[input.engine];
    if (!onlineName) throw new Error("请选择受支持的在线转写服务。");
    const engine = { id: input.engine, name: onlineName };
    const apiSettings = input.apiSettings || {};
    if (engine.id === "openai" && !apiSettings.openaiApiKey) throw new Error("请先在在线 API 设置中填写 OpenAI API Key。");
    if (engine.id === "alibaba" && !apiSettings.alibabaApiKey) throw new Error("请先在在线 API 设置中填写千问 API Key。");
    if (engine.id === "tencent" && (!apiSettings.tencentSecretId || !apiSettings.tencentSecretKey)) throw new Error("请先在在线 API 设置中填写腾讯云 SecretId 和 SecretKey。");
    const sourcePath = String(input.sourcePath || "");
    const uploadRoot = path.resolve(this.dataDir, "transcriptions", "uploads");
    const resolvedSource = path.resolve(sourcePath);
    if (!resolvedSource.startsWith(`${uploadRoot}${path.sep}`) || !(await exists(resolvedSource))) throw new Error("没有找到已导入的音视频文件。");

    const id = `transcription-${crypto.randomUUID()}`;
    const jobDir = path.join(this.dataDir, "transcriptions", "jobs", id);
    await fs.mkdir(jobDir, { recursive: true });
    const job = {
      id, engine: engine.id, engineName: engine.name, sourcePath: resolvedSource,
      originalName: safeName(input.originalName || path.basename(resolvedSource)),
      model: engine.id === "alibaba" && isAlibabaFileModel(input.model)
        ? input.model
        : (engine.id === "alibaba" && isAlibabaFileModel(apiSettings.alibabaModel) ? apiSettings.alibabaModel : (engine.id === "alibaba" ? "qwen3-asr-flash" : null)),
      language: ["zh", "en", "auto"].includes(input.language) ? input.language : "zh",
      prompt: String(input.prompt || "").slice(0, 4000), apiSettings,
      status: "queued", stage: "等待开始", progress: 0, logs: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      result: null, error: null, process: null, abortController: new AbortController(), cancelled: false, jobDir
    };
    this.jobs.set(id, job);
    await writeJsonAtomic(path.join(jobDir, "job-meta.json"), { id, sourcePath: resolvedSource, originalName: job.originalName });
    this.run(job).catch((error) => this.fail(job, error));
    return this.publicJob(job);
  }

  async importLiveResult(input) {
    const onlineName = ONLINE_ENGINES[input.engine];
    if (!onlineName) throw new Error("请选择受支持的在线转写服务。");
    const sourcePath = String(input.sourcePath || "");
    const uploadRoot = path.resolve(this.dataDir, "transcriptions", "uploads");
    const resolvedSource = path.resolve(sourcePath);
    if (!resolvedSource.startsWith(`${uploadRoot}${path.sep}`) || !(await exists(resolvedSource))) throw new Error("没有找到实时录音文件。");
    const text = cleanText(input.text);
    if (!text) throw new Error("实时转写稿为空，无法保存任务。");
    const segments = (Array.isArray(input.segments) ? input.segments : []).map((segment) => ({
      startMs: Math.max(0, Number(segment.startMs) || 0),
      endMs: Math.max(Number(segment.startMs) + 200, Number(segment.endMs) || 0),
      text: cleanText(segment.text)
    })).filter((segment) => segment.text);
    const id = `transcription-${crypto.randomUUID()}`;
    const jobDir = path.join(this.dataDir, "transcriptions", "jobs", id);
    await fs.mkdir(jobDir, { recursive: true });
    const originalName = safeName(input.originalName || path.basename(resolvedSource));
    const result = {
      text,
      srt: buildSrt(segments.length ? segments : approximateSegments(text, 0, Math.max(1000, Number(input.durationMs) || 1000))),
      segments,
      approximateTimestamps: !segments.length,
      sourceName: originalName
    };
    const now = new Date().toISOString();
    const job = {
      id, engine: input.engine, engineName: onlineName, sourcePath: resolvedSource, originalName,
      language: ["zh", "en", "auto"].includes(input.language) ? input.language : "zh",
      status: "completed", stage: "实时转写已保存", progress: 100, logs: ["实时转写结果与本机录音已保存。"],
      createdAt: now, updatedAt: now, result, error: null, process: null, abortController: null,
      cancelled: false, jobDir
    };
    this.jobs.set(id, job);
    await writeJsonAtomic(path.join(jobDir, "job-meta.json"), { id, sourcePath: resolvedSource, originalName });
    await writeJsonAtomic(path.join(jobDir, "result.json"), this.publicJob(job));
    this.runtimeLogger?.info("live", `实时转写已保存为任务录音：${id}`);
    return this.publicJob(job);
  }

  publicJob(job) {
    return {
      id: job.id, engine: job.engine, engineName: job.engineName, model: job.model || null, originalName: job.originalName,
      status: job.status, stage: job.stage, progress: job.progress,
      logs: job.logs.slice(-80), createdAt: job.createdAt, updatedAt: job.updatedAt,
      result: job.result, error: job.error
    };
  }

  get(id) {
    const job = this.jobs.get(id);
    if (!job) throw new Error("没有找到这个转写任务；服务重启后请重新导入录音。");
    return this.publicJob(job);
  }

  async audioPath(id) {
    const live = this.jobs.get(id);
    if (live?.normalizedPath && await exists(live.normalizedPath)) return live.normalizedPath;
    const jobDir = path.join(this.dataDir, "transcriptions", "jobs", id);
    const normalized = path.join(jobDir, "audio-normalized.mp3");
    if (await exists(normalized)) return normalized;
    if (live?.sourcePath && await exists(live.sourcePath)) return live.sourcePath;
    const metaFile = path.join(jobDir, "job-meta.json");
    const meta = JSON.parse(await fs.readFile(metaFile, "utf8"));
    const uploadRoot = path.resolve(this.dataDir, "transcriptions", "uploads");
    const resolved = path.resolve(String(meta.sourcePath || ""));
    if (!resolved.startsWith(`${uploadRoot}${path.sep}`) || !(await exists(resolved))) throw new Error("原始录音已被移动或清理。");
    return resolved;
  }

  async cancel(id) {
    const job = this.jobs.get(id);
    if (!job) throw new Error("没有找到这个转写任务。");
    job.cancelled = true;
    terminateProcessTree(job.process);
    job.abortController?.abort();
    job.status = "cancelled"; job.stage = "已取消"; job.updatedAt = new Date().toISOString();
    return this.publicJob(job);
  }

  async remove(id) {
    if (!/^transcription-[a-f0-9-]+$/.test(String(id || ""))) throw new Error("转写任务编号无效。");
    const jobsRoot = path.resolve(this.dataDir, "transcriptions", "jobs");
    const uploadsRoot = path.resolve(this.dataDir, "transcriptions", "uploads");
    const jobDir = path.resolve(jobsRoot, id);
    if (!jobDir.startsWith(`${jobsRoot}${path.sep}`)) throw new Error("转写任务路径无效。");

    const live = this.jobs.get(id);
    if (live && ["queued", "running"].includes(live.status)) {
      await this.cancel(id);
      if (live.process && live.process.exitCode === null) {
        await Promise.race([
          new Promise((resolve) => live.process.once("exit", resolve)),
          new Promise((resolve) => setTimeout(resolve, 2000))
        ]);
      }
    }

    let sourcePath = live?.sourcePath || "";
    if (!sourcePath) {
      try {
        const meta = JSON.parse(await fs.readFile(path.join(jobDir, "job-meta.json"), "utf8"));
        sourcePath = String(meta.sourcePath || "");
      } catch { /* The job may already be partially removed. */ }
    }

    let audioDeleted = await exists(path.join(jobDir, "audio-normalized.mp3"));
    if (sourcePath) {
      const resolvedSource = path.resolve(sourcePath);
      if (resolvedSource.startsWith(`${uploadsRoot}${path.sep}`)) {
        audioDeleted = await fs.unlink(resolvedSource).then(() => true).catch((error) => {
          if (error.code === "ENOENT") return false;
          throw error;
        }) || audioDeleted;
      }
    }

    await fs.rm(jobDir, { recursive: true, force: true });
    this.jobs.delete(id);
    return { deleted: true, audioDeleted };
  }

  async run(job) {
    const p = this.paths();
    job.normalizedPath = path.join(job.jobDir, "audio-normalized.mp3");
    job.status = "running";
    await this.runProcess(job, p.ffmpeg, ["-hide_banner", "-loglevel", "warning", "-y", "-i", job.sourcePath, "-vn", "-ar", "16000", "-ac", "1", "-af", "highpass=f=80,loudnorm=I=-18:LRA=11:TP=-2", "-c:a", "libmp3lame", "-b:a", "64k", job.normalizedPath], path.dirname(p.ffmpeg), "正在增强并标准化项目录音", 2, 10);
    await writeJsonAtomic(path.join(job.jobDir, "job-meta.json"), { id: job.id, sourcePath: job.sourcePath, normalizedPath: job.normalizedPath, originalName: job.originalName });
    if (job.cancelled) return;
    await this.runOnline(job, p);
    if (job.cancelled) return;
    job.status = "completed"; job.stage = "在线转写完成，等待人工检查"; job.progress = 100; job.updatedAt = new Date().toISOString();
    await writeJsonAtomic(path.join(job.jobDir, "result.json"), this.publicJob(job));
    await fs.rm(path.join(job.jobDir, "api-chunks"), { recursive: true, force: true });
    await fs.unlink(path.join(job.jobDir, "checkpoint.json")).catch(() => {});
    await fs.unlink(job.sourcePath).catch(() => {});
  }

  async runOnline(job, p) {
    const segmentSeconds = job.engine === "alibaba" ? 60 : (job.engine === "tencent" ? 480 : 900);
    const chunkDir = path.join(job.jobDir, "api-chunks");
    await fs.mkdir(chunkDir, { recursive: true });
    const pattern = path.join(chunkDir, "chunk_%03d.mp3");
    // Re-encode the chunks so every upload is a self-contained MP3. Stream-copying
    // can leave a segment beginning on an unsuitable MP3 frame boundary.
    await this.runProcess(job, p.ffmpeg, ["-hide_banner", "-loglevel", "warning", "-y", "-i", job.normalizedPath, "-ar", "16000", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k", "-f", "segment", "-segment_time", String(segmentSeconds), "-reset_timestamps", "1", pattern], path.dirname(p.ffmpeg), "正在切分在线转写音频", 10, 14);
    const chunks = (await fs.readdir(chunkDir)).filter((name) => /^chunk_\d+\.mp3$/.test(name)).sort().map((name) => path.join(chunkDir, name));
    if (!chunks.length) throw new Error("没有生成可上传的音频分片。");
    if (job.engine === "alibaba" && job.prompt && job.model?.startsWith("qwen-audio-")) {
      this.log(job, "已将术语提示转换为千问录音模型的热词表。");
    } else if (job.engine === "alibaba" && job.prompt) {
      this.log(job, "当前千问录音模型不接收任务内术语热词；术语仍保留供后续校订使用。");
    }
    const texts = [];
    const segments = [];
    for (let index = 0; index < chunks.length; index += 1) {
      if (job.cancelled) return;
      job.stage = `在线识别：第 ${index + 1} / ${chunks.length} 段`;
      job.progress = 12 + Math.round(index / chunks.length * 84);
      this.log(job, `正在调用${job.engineName}处理第 ${index + 1} / ${chunks.length} 段。`);
      const result = await this.withTransientRetry(job, async () => {
        if (job.engine === "openai") return this.transcribeOpenAI(job, chunks[index], index * segmentSeconds * 1000, segmentSeconds);
        if (job.engine === "alibaba") return this.transcribeAlibaba(job, chunks[index], index * segmentSeconds * 1000, segmentSeconds);
        return this.transcribeTencent(job, chunks[index], index * segmentSeconds * 1000);
      });
      const cleaned = cleanText(result.text);
      if (cleaned) texts.push(cleaned);
      segments.push(...result.segments);
      job.result = { text: `${texts.join("\n\n")}\n`, srt: buildSrt(segments), engine: job.engine, model: job.model || null, sourceName: job.originalName, approximateTimestamps: job.engine === "alibaba", partial: index < chunks.length - 1 };
      await writeJsonAtomic(path.join(job.jobDir, "partial-result.json"), job.result);
      await writeJsonAtomic(path.join(job.jobDir, "checkpoint.json"), { completedChunks: index + 1, totalChunks: chunks.length, updatedAt: new Date().toISOString() });
    }
    job.result.partial = false;
    job.progress = 98;
  }

  async transcribeOpenAI(job, audioPath, offsetMs, segmentSeconds) {
    const settings = job.apiSettings;
    const buffer = await fs.readFile(audioPath);
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: "audio/mpeg" }), path.basename(audioPath));
    form.append("model", settings.openaiModel || "gpt-transcribe");
    if (job.language !== "auto") form.append("language", job.language);
    if (job.prompt) form.append("prompt", `课堂录音转写。请准确识别这些专业词和人名：${job.prompt}`);
    const response = await fetch(settings.openaiEndpoint || "https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${settings.openaiApiKey}` }, body: form, signal: job.abortController.signal
    });
    const body = await response.text();
    if (!response.ok) throw this.apiError("OpenAI", response.status, body);
    let payload;
    try { payload = JSON.parse(body); } catch { payload = { text: body }; }
    const text = String(payload.text || "");
    const segments = Array.isArray(payload.segments) ? payload.segments.map((item) => ({ startMs: offsetMs + Number(item.start || 0) * 1000, endMs: offsetMs + Number(item.end || 0) * 1000, text: String(item.text || "") })) : [{ startMs: offsetMs, endMs: offsetMs + segmentSeconds * 1000, text }];
    return { text, segments };
  }

  async transcribeAlibaba(job, audioPath, offsetMs, segmentSeconds) {
    const settings = job.apiSettings;
    const dataUri = `data:audio/mpeg;base64,${(await fs.readFile(audioPath)).toString("base64")}`;
    const model = isAlibabaFileModel(job.model) ? job.model : "qwen3-asr-flash";
    const messages = [{ role: "user", content: [{ type: "input_audio", input_audio: { data: dataUri } }] }];
    let response;

    if (model !== "qwen3-asr-flash") {
      const parameters = { format: "mp3", sample_rate: 16000 };
      if (job.language !== "auto") parameters.language_hints = [job.language];
      if (model.startsWith("qwen-audio-")) {
        const vocabulary = job.prompt.split(/[,，;；\r\n]+/).map((item) => item.trim()).filter(Boolean).slice(0, 1000);
        if (vocabulary.length) parameters.vocabulary = Object.fromEntries(vocabulary.map((text) => [text, 5]));
      }
      if (model === "qwen-audio-3.1-asr-flash") parameters.keep_dialect = true;
      response = await fetch("https://maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation", {
        method: "POST",
        headers: { Authorization: `Bearer ${settings.alibabaApiKey}`, "Content-Type": "application/json", "X-DashScope-SSE": "disable" },
        body: JSON.stringify({ model, input: { messages }, parameters }),
        signal: job.abortController.signal
      });
      const body = await response.text();
      if (!response.ok) throw this.apiError("千问 API 平台", response.status, body);
      const payload = JSON.parse(body);
      const text = String(payload?.output?.output?.sentence?.text || payload?.output?.text || "");
      if (!text) throw this.apiError("千问 API 平台", response.status, body, "返回中没有识别结果");
      return { text, segments: approximateSegments(text, offsetMs, segmentSeconds * 1000) };
    }

    // Qwen3-ASR's OpenAI-compatible endpoint is a dedicated ASR task. It only
    // accepts the audio user message; a conventional system prompt is rejected
    // with InternalError.Algo.InvalidParameter. The glossary remains available
    // to OpenAI and Tencent, whose APIs support contextual hints.
    const asrOptions = job.language === "auto" ? { enable_itn: true } : { language: job.language, enable_itn: true };
    response = await fetch(settings.alibabaEndpoint || "https://maas.qianwenaiapi.com/compatible-mode/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${settings.alibabaApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false, asr_options: asrOptions }),
      signal: job.abortController.signal
    });
    const body = await response.text();
    if (!response.ok) throw this.apiError("千问 API 平台", response.status, body);
    const payload = JSON.parse(body);
    const text = String(payload?.choices?.[0]?.message?.content || "");
    if (!text) throw this.apiError("千问 API 平台", response.status, body, "返回中没有识别结果");
    return { text, segments: approximateSegments(text, offsetMs, segmentSeconds * 1000) };
  }

  async transcribeTencent(job, audioPath, offsetMs) {
    const audio = await fs.readFile(audioPath);
    if (audio.length > 5 * 1024 * 1024) throw new Error("腾讯云音频分片超过 5 MB，请缩短分片后重试。");
    const words = job.prompt.split(/[,，;；\r\n]+/).map((item) => item.trim()).filter(Boolean).slice(0, 128);
    const request = { EngineModelType: "16k_zh_en_2.0", ChannelNum: 1, ResTextFormat: 3, SourceType: 1, Data: audio.toString("base64"), DataLen: audio.length, ConvertNumMode: 1, SpeakerDiarization: 0 };
    if (words.length) request.HotwordList = words.map((word) => `${word}|8`).join(",");
    const created = await this.tencentRequest(job, "CreateRecTask", request);
    const createResponse = created.Response || {};
    if (createResponse.Error) throw new Error(`腾讯云 API 错误：${createResponse.Error.Message || "未知错误"}`);
    const taskId = createResponse?.Data?.TaskId;
    if (!taskId) throw new Error("腾讯云没有返回任务编号。");
    this.log(job, `腾讯云任务已提交，任务号：${taskId}`);
    while (!job.cancelled) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const checked = await this.tencentRequest(job, "DescribeTaskStatus", { TaskId: taskId });
      const response = checked.Response || {};
      if (response.Error) throw new Error(`腾讯云 API 错误：${response.Error.Message || "未知错误"}`);
      const data = response.Data || {};
      if (data.Status === 0 || data.Status === 1) continue;
      if (data.Status === 3) throw new Error(`腾讯云识别失败：${data.ErrorMsg || "未知错误"}`);
      const segments = Array.isArray(data.ResultDetail) ? data.ResultDetail.map((item) => ({ startMs: offsetMs + Number(item.StartMs || 0), endMs: offsetMs + Number(item.EndMs || 0), text: String(item.FinalSentence || "") })).filter((item) => item.text) : [];
      return { text: String(data.Result || ""), segments };
    }
    return { text: "", segments: [] };
  }

  async tencentRequest(job, action, input) {
    const host = "asr.tencentcloudapi.com";
    const service = "asr";
    const payload = JSON.stringify(input);
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
    const signedHeaders = "content-type;host";
    const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256Hex(payload)}`;
    const credentialScope = `${date}/${service}/tc3_request`;
    const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;
    const secretDate = hmac(Buffer.from(`TC3${job.apiSettings.tencentSecretKey}`, "utf8"), date);
    const secretService = hmac(secretDate, service);
    const secretSigning = hmac(secretService, "tc3_request");
    const signature = crypto.createHmac("sha256", secretSigning).update(stringToSign, "utf8").digest("hex");
    const authorization = `TC3-HMAC-SHA256 Credential=${job.apiSettings.tencentSecretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const response = await fetch(`https://${host}/`, {
      method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json; charset=utf-8", "X-TC-Action": action, "X-TC-Timestamp": String(timestamp), "X-TC-Version": "2019-06-14" }, body: payload, signal: job.abortController.signal
    });
    const body = await response.text();
    if (!response.ok) throw this.apiError("腾讯云", response.status, body);
    return JSON.parse(body);
  }

  apiError(provider, status, body, prefix = "API 请求失败") {
    const compact = String(body || "").replace(/\s+/g, " ").trim().slice(0, 4000);
    const error = new Error(`${provider} ${prefix}（HTTP ${status}）：${compact.slice(0, 800)}`);
    error.provider = provider; error.status = status; error.responseBody = compact;
    return error;
  }

  async withTransientRetry(job, operation, maxAttempts = 4) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (job.cancelled) throw job.abortController.signal.reason || new DOMException("Aborted", "AbortError");
      try {
        return await operation();
      } catch (error) {
        if (job.cancelled || error?.name === "AbortError") throw error;
        const status = Number(error?.status || 0);
        const transient = status === 408 || status === 409 || status === 425 || status === 429 || status >= 500 || error instanceof TypeError || ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(error?.code);
        if (!transient || attempt >= maxAttempts) throw error;
        const delay = Math.min(8000, 750 * 2 ** (attempt - 1)) + crypto.randomInt(0, 300);
        this.log(job, `第 ${attempt} 次调用遇到临时故障，${Math.round(delay / 100) / 10} 秒后自动重试。`);
        await new Promise((resolve, reject) => {
          const onAbort = () => { clearTimeout(timer); reject(job.abortController.signal.reason || new DOMException("Aborted", "AbortError")); };
          const timer = setTimeout(() => { job.abortController.signal.removeEventListener("abort", onAbort); resolve(); }, delay);
          job.abortController.signal.addEventListener("abort", onAbort, { once: true });
        });
      }
    }
    throw new Error("在线转写重试次数已用尽。");
  }

  runProcess(job, executable, args, cwd, stage, progressStart, progressEnd) {
    job.stage = stage; job.progress = progressStart; job.updatedAt = new Date().toISOString();
    this.log(job, `> ${path.basename(executable)} ${args.map((value) => String(value).includes(" ") ? `"${value}"` : value).join(" ")}`.replaceAll(this.root, "."));
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, { cwd, windowsHide: true });
      job.process = child;
      const onData = (chunk) => {
        const text = chunk.toString("utf8");
        for (const line of text.split(/\r?\n/).filter(Boolean)) {
          this.log(job, line);
          const match = line.match(/(?:^|\s)(\d{1,3}(?:\.\d+)?)%/);
          if (match) job.progress = Math.min(progressEnd, Math.round(progressStart + Number(match[1]) / 100 * (progressEnd - progressStart)));
        }
      };
      child.stdout.on("data", onData); child.stderr.on("data", onData);
      child.on("error", reject);
      child.on("close", (code) => {
        job.process = null;
        if (job.cancelled) return resolve();
        if (code !== 0) return reject(new Error(`${path.basename(executable)} 执行失败，退出代码 ${code}。`));
        job.progress = progressEnd; job.updatedAt = new Date().toISOString(); resolve();
      });
    });
  }

  log(job, line) {
    const cleaned = String(line || "").trim();
    if (!cleaned) return;
    job.logs.push(cleaned.length > 600 ? `${cleaned.slice(0, 600)}…` : cleaned);
    if (job.logs.length > 300) job.logs.splice(0, job.logs.length - 300);
    job.updatedAt = new Date().toISOString();
    this.runtimeLogger?.info(`transcription:${job.id}`, cleaned.length > 1200 ? `${cleaned.slice(0, 1200)}…` : cleaned);
  }

  async fail(job, error) {
    if (job.cancelled) return;
    job.process = null; job.status = "failed"; job.stage = "转写失败";
    job.error = error?.message || "转写失败。"; job.updatedAt = new Date().toISOString();
    this.log(job, `错误：${job.error}`);
    const recovery = { id: job.id, provider: job.engine, sourceName: job.originalName, failedAt: job.updatedAt, error: job.error, status: error?.status || null, responseBody: error?.responseBody || null, partialResult: job.result };
    await writeJsonAtomic(path.join(job.jobDir, "recovery.json"), recovery).catch(() => {});
  }
}
