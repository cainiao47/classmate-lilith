import crypto from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";

const QWEN_REALTIME_URL = "wss://maas.qianwenaiapi.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime";
const QWEN_STREAMING_URL = "wss://maas.qianwenaiapi.com/api-ws/v1/inference";
const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime/transcription_sessions?model=gpt-live-transcribe";
const PROVIDER_NAMES = { alibaba: "千问实时识别", tencent: "腾讯云实时识别", openai: "OpenAI 实时识别" };
export const ALIBABA_LIVE_MODELS = new Set([
  "qwen3-asr-flash-realtime",
  "qwen-audio-3.1-asr-flash-streaming",
  "qwen-audio-3.0-asr-flash-streaming",
  "fun-asr-realtime"
]);
export const LIVE_AUDIO_BUFFER_MAX_BYTES = 16_000 * 2 * 20;
const RECONNECT_DELAYS = [750, 1500, 3000, 6000, 10_000, 15_000];

export function appendBoundedAudio(queue, currentBytes, buffer, maxBytes = LIVE_AUDIO_BUFFER_MAX_BYTES) {
  const copy = Buffer.from(buffer);
  queue.push(copy);
  let bytes = currentBytes + copy.length;
  while (bytes > maxBytes && queue.length > 1) bytes -= queue.shift().length;
  return bytes;
}

function safeText(value, limit = 20_000) {
  return String(value || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, limit);
}

function eventText(event) {
  return safeText(event?.transcript ?? event?.text ?? event?.delta ?? event?.result?.voice_text_str ?? "");
}

function languageCode(language) {
  return language === "en" ? "en" : (language === "zh" ? "zh" : "");
}

export function buildTencentRealtimeUrl(settings, { language = "zh", voiceId = crypto.randomUUID() } = {}) {
  if (!settings.tencentAppId || !settings.tencentSecretId || !settings.tencentSecretKey) {
    throw new Error("腾讯云实时转写需要 AppID、SecretId 和 SecretKey，请先在设置中补全。 ");
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const params = {
    engine_model_type: language === "en" ? "16k_en" : "16k_zh_edu",
    expired: timestamp + 3600,
    filter_dirty: 1,
    filter_modal: 1,
    filter_punc: 1,
    needvad: 1,
    nonce: crypto.randomInt(1, 2_147_483_647),
    secretid: settings.tencentSecretId,
    timestamp,
    voice_format: 1,
    voice_id: voiceId
  };
  const query = Object.keys(params).sort().map((key) => `${key}=${encodeURIComponent(params[key])}`).join("&");
  const signingQuery = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join("&");
  const path = `asr.cloud.tencent.com/asr/v2/${settings.tencentAppId}`;
  const signature = crypto.createHmac("sha1", settings.tencentSecretKey).update(`${path}?${signingQuery}`).digest("base64");
  return `wss://${path}?${query}&signature=${encodeURIComponent(signature)}`;
}

class ProviderConnection {
  constructor(options, hooks) {
    this.options = options;
    this.hooks = hooks;
    this.socket = null;
    this.ready = false;
    this.finished = false;
    this.bufferedAudio = false;
    this.turnStartMs = 0;
    this.settings = null;
    this.hasEverReady = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.pendingAudio = [];
    this.pendingBytes = 0;
    this.connectionNumber = 0;
  }

  sendJson(payload) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload));
  }

  sendAudio(buffer) {
    if (this.finished) return;
    if (!this.ready) return this.bufferAudio(buffer);
    if (!this.bufferedAudio) this.turnStartMs = this.hooks.elapsed();
    this.bufferedAudio = true;
    this.writeAudio(buffer);
  }

  bufferAudio(buffer) {
    this.pendingBytes = appendBoundedAudio(this.pendingAudio, this.pendingBytes, buffer);
  }

  bufferedDurationMs(sampleRate = 16_000) {
    return Math.round(this.pendingBytes / (sampleRate * 2) * 1000);
  }

  markReady(sampleRate) {
    const reconnected = this.hasEverReady;
    const bufferedMs = this.bufferedDurationMs(sampleRate);
    this.ready = true;
    this.hasEverReady = true;
    this.reconnectAttempt = 0;
    this.bufferedAudio = this.pendingAudio.length > 0;
    if (this.bufferedAudio) this.turnStartMs = Math.max(0, this.hooks.elapsed() - bufferedMs);
    this.hooks.ready(sampleRate, { reconnected, bufferedMs });
    const pending = this.pendingAudio;
    this.pendingAudio = [];
    this.pendingBytes = 0;
    for (const chunk of pending) this.writeAudio(chunk);
  }

  commit() {}

  finish() {
    this.finished = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.heartbeatTimer);
    this.socket?.close(1000, "finished");
    this.hooks.finished();
  }

  close() {
    this.finished = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.heartbeatTimer);
    try { this.socket?.close(1000, "client closed"); } catch { /* already closed */ }
  }

  bindSocket(socket) {
    this.socket = socket;
    this.connectionNumber += 1;
    const number = this.connectionNumber;
    const openedAt = Date.now();
    socket.on("open", () => {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.ping();
      }, 20_000);
      this.heartbeatTimer.unref?.();
    });
    socket.on("error", (error) => this.hooks.diagnostic?.(`上游连接错误：${safeText(error.message, 500)}`));
    socket.on("close", (code, reasonBuffer) => {
      if (number !== this.connectionNumber) return;
      clearInterval(this.heartbeatTimer);
      this.ready = false;
      const reason = safeText(reasonBuffer?.toString(), 500) || "未提供原因";
      const detail = `上游连接关闭：code=${code}，reason=${reason}，持续=${Math.round((Date.now() - openedAt) / 1000)}秒`;
      this.hooks.diagnostic?.(detail);
      if (!this.finished) this.scheduleReconnect(detail);
    });
  }

  scheduleReconnect(detail) {
    if (!this.hasEverReady) {
      this.finished = true;
      this.hooks.error(`实时识别连接失败。${detail}`);
      return;
    }
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    this.reconnectAttempt += 1;
    this.hooks.reconnecting?.({ attempt: this.reconnectAttempt, delay, bufferedMs: this.bufferedDurationMs() });
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.finished) return;
      try { this.openSocket(); }
      catch (error) { this.scheduleReconnect(error.message || "重新连接失败"); }
    }, delay);
    this.reconnectTimer.unref?.();
  }

  providerError(message, code = "") {
    const detail = `${safeText(message, 800) || "实时识别服务返回错误"}${code ? `（${safeText(code, 120)}）` : ""}`;
    this.hooks.diagnostic?.(detail);
    if (!this.hasEverReady) {
      this.finished = true;
      this.hooks.error(detail);
      try { this.socket?.close(1011, "provider error"); } catch { /* ignore */ }
      return;
    }
    this.ready = false;
    try { this.socket?.close(1011, "provider error"); } catch { this.scheduleReconnect(detail); }
  }
}

class QwenConnection extends ProviderConnection {
  connect(settings) {
    this.settings = settings;
    this.openSocket();
  }

  openSocket() {
    const settings = this.settings;
    if (!settings.alibabaApiKey) throw new Error("请先在设置中填写千问 API Key。");
    const socket = new WebSocket(QWEN_REALTIME_URL, {
      headers: { Authorization: `Bearer ${settings.alibabaApiKey}`, "OpenAI-Beta": "realtime=v1" }
    });
    this.bindSocket(socket);
    socket.on("open", () => {
      const language = languageCode(this.options.language);
      this.sendJson({
        event_id: `event_${crypto.randomUUID()}`,
        type: "session.update",
        session: {
          modalities: ["text"], input_audio_format: "pcm", sample_rate: 16000,
          input_audio_transcription: language ? { language } : {},
          turn_detection: { type: "server_vad", threshold: 0.2, silence_duration_ms: 800, prefix_padding_ms: 300 }
        }
      });
    });
    socket.on("message", (data) => this.handle(JSON.parse(data.toString())));
  }

  handle(event) {
    const type = event.type || "";
    if (type === "session.updated") {
      if (!this.ready) this.markReady(16000);
      return;
    }
    if (type === "input_audio_buffer.speech_started") this.turnStartMs = this.hooks.elapsed();
    if (type === "conversation.item.input_audio_transcription.text") {
      this.hooks.partial(`${this.connectionNumber}:${event.item_id || event.event_id}`, eventText(event), false);
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      this.hooks.final(`${this.connectionNumber}:${event.item_id || event.event_id}`, eventText(event), this.turnStartMs, this.hooks.elapsed());
      this.bufferedAudio = false;
    }
    if (type === "session.finished") {
      this.finished = true; this.hooks.finished(); this.socket?.close(1000, "finished");
    }
    if (type === "error") this.providerError(event.error?.message || event.message || "千问实时识别返回错误。", event.error?.code);
  }

  writeAudio(buffer) {
    this.sendJson({ type: "input_audio_buffer.append", audio: Buffer.from(buffer).toString("base64") });
  }

  finish() {
    if (this.finished) return;
    if (!this.ready) return super.finish();
    this.sendJson({ type: "session.finish" });
    setTimeout(() => { if (!this.finished) super.finish(); }, 8000).unref?.();
  }
}

class AlibabaStreamingConnection extends ProviderConnection {
  connect(settings) {
    this.settings = settings;
    this.openSocket();
  }

  openSocket() {
    if (!this.settings.alibabaApiKey) throw new Error("请先在设置中填写千问 API Key。");
    this.taskId = crypto.randomUUID();
    this.taskOffsetMs = this.hooks.elapsed();
    const socket = new WebSocket(QWEN_STREAMING_URL, { headers: { Authorization: `Bearer ${this.settings.alibabaApiKey}` } });
    this.bindSocket(socket);
    socket.on("open", () => {
      const parameters = {
        format: "pcm", sample_rate: 16000, heartbeat: true,
        semantic_punctuation_enabled: false, max_sentence_silence: 800
      };
      const language = languageCode(this.options.language);
      if (language) parameters.language_hints = [language];
      if (this.options.model === "qwen-audio-3.1-asr-flash-streaming") parameters.keep_dialect = true;
      const words = this.options.keywords.slice(0, 2000);
      if (words.length && this.options.model.startsWith("qwen-audio-")) {
        parameters.vocabulary = Object.fromEntries(words.map((word) => [word, 5]));
      }
      const contextText = safeText([this.options.prompt, ...words].filter(Boolean).join("；"), 400);
      this.sendJson({
        header: { action: "run-task", task_id: this.taskId, streaming: "duplex" },
        payload: {
          task_group: "audio", task: "asr", function: "recognition", model: this.options.model,
          parameters,
          input: contextText ? { context: [{ role: "user", content: [{ type: "input_text", text: contextText }] }] } : {}
        }
      });
    });
    socket.on("message", (data) => this.handle(JSON.parse(data.toString())));
  }

  handle(event) {
    const type = event?.header?.event || "";
    if (type === "task-started") {
      this.taskOffsetMs = Math.max(0, this.hooks.elapsed() - this.bufferedDurationMs());
      return this.markReady(16000);
    }
    if (type === "result-generated") {
      const sentence = event?.payload?.output?.sentence || {};
      if (sentence.heartbeat) return;
      const id = `${this.taskId}:${sentence.sentence_id ?? "current"}`;
      const text = safeText(sentence.text);
      const start = this.taskOffsetMs + Math.max(0, Number(sentence.begin_time) || 0);
      const end = this.taskOffsetMs + Math.max(Number(sentence.end_time) || 0, Number(sentence.begin_time) || 0);
      if (sentence.sentence_end) this.hooks.final(id, text, start, end);
      else this.hooks.partial(id, text, false);
      return;
    }
    if (type === "task-finished") {
      this.finished = true;
      this.hooks.finished();
      this.socket?.close(1000, "finished");
      return;
    }
    if (type === "task-failed") this.providerError(event.header?.error_message || "千问流式识别任务失败。", event.header?.error_code);
  }

  writeAudio(buffer) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(buffer, { binary: true });
  }

  finish() {
    if (this.finished) return;
    if (!this.ready) return super.finish();
    this.sendJson({ header: { action: "finish-task", task_id: this.taskId, streaming: "duplex" }, payload: { input: {} } });
    setTimeout(() => { if (!this.finished) super.finish(); }, 8000).unref?.();
  }
}

class OpenAIConnection extends ProviderConnection {
  connect(settings) {
    this.settings = settings;
    this.openSocket();
  }

  openSocket() {
    const settings = this.settings;
    if (!settings.openaiApiKey) throw new Error("请先在设置中填写 OpenAI API Key。");
    const socket = new WebSocket(OPENAI_REALTIME_URL, { headers: { Authorization: `Bearer ${settings.openaiApiKey}` } });
    this.bindSocket(socket);
    socket.on("open", () => {
      const language = languageCode(this.options.language);
      const keywords = this.options.keywords.slice(0, 100);
      this.sendJson({
        type: "session.update",
        session: {
          type: "transcription",
          audio: { input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: {
              model: "gpt-live-transcribe", delay: "medium",
              ...(this.options.prompt ? { prompt: this.options.prompt } : {}),
              ...(keywords.length ? { keywords } : {}),
              ...(language ? { languages: [language] } : {})
            },
            turn_detection: null
          } }
        }
      });
    });
    socket.on("message", (data) => this.handle(JSON.parse(data.toString())));
  }

  handle(event) {
    const type = event.type || "";
    if (type === "session.updated") {
      if (!this.ready) this.markReady(24000);
      return;
    }
    if (type === "conversation.item.input_audio_transcription.delta") {
      this.hooks.partial(event.item_id || "openai-current", eventText(event), true);
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      this.hooks.final(event.item_id || event.event_id, eventText(event), this.turnStartMs, this.hooks.elapsed());
      this.bufferedAudio = false;
    }
    if (type === "error") this.providerError(event.error?.message || event.message || "OpenAI 实时识别返回错误。", event.error?.code);
  }

  writeAudio(buffer) {
    this.sendJson({ type: "input_audio_buffer.append", audio: Buffer.from(buffer).toString("base64") });
  }

  commit() {
    if (!this.ready || !this.bufferedAudio) return;
    this.sendJson({ type: "input_audio_buffer.commit" });
    this.bufferedAudio = false;
  }

  finish() {
    if (this.finished) return;
    if (!this.ready) return super.finish();
    this.commit();
    setTimeout(() => super.finish(), 3500).unref?.();
  }
}

class TencentConnection extends ProviderConnection {
  connect(settings) {
    this.settings = settings;
    this.openSocket();
  }

  openSocket() {
    const socket = new WebSocket(buildTencentRealtimeUrl(this.settings, this.options));
    this.bindSocket(socket);
    socket.on("open", () => this.markReady(16000));
    socket.on("message", (data) => this.handle(JSON.parse(data.toString())));
  }

  handle(event) {
    if (Number(event.code || 0) !== 0) return this.providerError(event.message || `腾讯云实时识别错误（${event.code}）`, event.code);
    const result = event.result;
    if (result) {
      const id = `tencent-${result.index ?? event.message_id}`;
      const text = eventText(event);
      if (Number(result.slice_type) === 2) this.hooks.final(id, text, Number(result.start_time || 0), Number(result.end_time || this.hooks.elapsed()));
      else this.hooks.partial(id, text, false);
    }
    if (Number(event.final) === 1) {
      this.finished = true; this.hooks.finished(); this.socket?.close(1000, "finished");
    }
  }

  writeAudio(buffer) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(buffer, { binary: true });
  }

  finish() {
    if (this.finished) return;
    if (!this.ready) return super.finish();
    this.sendJson({ type: "end" });
    setTimeout(() => { if (!this.finished) super.finish(); }, 8000).unref?.();
  }
}

function providerConnection(provider, options, hooks) {
  if (provider === "alibaba") return options.model === "qwen3-asr-flash-realtime"
    ? new QwenConnection(options, hooks)
    : new AlibabaStreamingConnection(options, hooks);
  if (provider === "tencent") return new TencentConnection(options, hooks);
  if (provider === "openai") return new OpenAIConnection(options, hooks);
  throw new Error("不支持这个实时转写服务。");
}

export class LiveTranscriptionGateway {
  constructor({ settingsStore, runtimeLogger = null, authorizeRequest = () => true }) {
    this.settingsStore = settingsStore;
    this.runtimeLogger = runtimeLogger;
    this.authorizeRequest = authorizeRequest;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
    this.wss.on("connection", (client) => this.handleClient(client));
  }

  attach(server) {
    server.on("upgrade", (req, socket, head) => {
      const pathname = new URL(req.url, "http://127.0.0.1").pathname;
      if (pathname !== "/api/live") return socket.destroy();
      if (!this.authorizeRequest(req)) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return socket.destroy();
      }
      this.wss.handleUpgrade(req, socket, head, (client) => this.wss.emit("connection", client, req));
    });
  }

  handleClient(client) {
    const startedAt = Date.now();
    let provider = null;
    let finalIds = new Set();
    let ended = false;
    const send = (payload) => {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(payload));
    };
    const finish = () => {
      if (ended) return;
      ended = true; send({ type: "finished" });
    };
    const hooks = {
      elapsed: () => Date.now() - startedAt,
      ready: (sampleRate, state = {}) => send({ type: "ready", sampleRate, ...state }),
      reconnecting: ({ attempt, delay, bufferedMs }) => send({ type: "reconnecting", attempt, delay, bufferedMs }),
      diagnostic: (message) => this.runtimeLogger?.warn("live", safeText(message, 1000)),
      partial: (id, text, append) => { if (text) send({ type: "partial", id: String(id || "current"), text, append: Boolean(append) }); },
      final: (id, text, startMs, endMs) => {
        const stableId = String(id || crypto.randomUUID());
        if (!text || finalIds.has(stableId)) return;
        finalIds.add(stableId);
        send({ type: "final", id: stableId, text, startMs: Math.max(0, Number(startMs) || 0), endMs: Math.max(Number(startMs) + 200, Number(endMs) || Date.now() - startedAt) });
      },
      error: (message) => {
        this.runtimeLogger?.warn("live", safeText(message, 1000));
        send({ type: "error", error: safeText(message, 1000) || "实时转写失败。" });
      },
      finished: finish
    };

    client.on("message", async (data, isBinary) => {
      try {
        if (isBinary) return provider?.sendAudio(data);
        const message = JSON.parse(data.toString());
        if (message.type === "start") {
          if (provider) throw new Error("实时转写已经开始。");
          const options = {
            language: ["zh", "en", "auto"].includes(message.language) ? message.language : "zh",
            prompt: safeText(message.prompt, 4000),
            keywords: Array.isArray(message.keywords) ? message.keywords.map((item) => safeText(item, 100)).filter(Boolean) : [],
            model: ALIBABA_LIVE_MODELS.has(message.model) ? message.model : "qwen3-asr-flash-realtime"
          };
          const settings = await this.settingsStore.load();
          provider = providerConnection(message.provider, options, hooks);
          this.runtimeLogger?.info("live", `正在连接${PROVIDER_NAMES[message.provider] || message.provider}`);
          provider.connect(settings);
          return;
        }
        if (!provider) throw new Error("请先开始实时转写。");
        if (message.type === "commit") return provider.commit();
        if (message.type === "stop") return provider.finish();
      } catch (error) {
        hooks.error(error.message || "实时转写请求无效。");
      }
    });
    client.on("close", () => provider?.close());
    client.on("error", (error) => this.runtimeLogger?.warn("live", error.message || "本机实时连接异常"));
    send({ type: "connected" });
  }

  close() {
    for (const client of this.wss.clients) client.close(1001, "application shutdown");
    this.wss.close();
  }
}
