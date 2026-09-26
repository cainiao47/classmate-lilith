import crypto from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";

const QWEN_REALTIME_URL = "wss://maas.qianwenaiapi.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime";
const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime/transcription_sessions?model=gpt-live-transcribe";
const PROVIDER_NAMES = { alibaba: "千问实时识别", tencent: "腾讯云实时识别", openai: "OpenAI 实时识别" };

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
  }

  sendJson(payload) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload));
  }

  sendAudio(buffer) {
    if (!this.ready || this.finished) return;
    if (!this.bufferedAudio) this.turnStartMs = this.hooks.elapsed();
    this.bufferedAudio = true;
    this.writeAudio(buffer);
  }

  commit() {}

  finish() {
    this.finished = true;
    this.socket?.close(1000, "finished");
    this.hooks.finished();
  }

  close() {
    this.finished = true;
    try { this.socket?.close(1000, "client closed"); } catch { /* already closed */ }
  }

  bindSocket(socket) {
    this.socket = socket;
    socket.on("error", (error) => this.hooks.error(error.message || "实时识别连接失败。"));
    socket.on("close", (code) => {
      if (!this.finished && code !== 1000) this.hooks.error(`实时识别连接已断开（${code}）。本机录音仍会保留。`);
    });
  }
}

class QwenConnection extends ProviderConnection {
  connect(settings) {
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
      if (!this.ready) { this.ready = true; this.hooks.ready(16000); }
      return;
    }
    if (type === "input_audio_buffer.speech_started") this.turnStartMs = this.hooks.elapsed();
    if (type === "conversation.item.input_audio_transcription.text") {
      this.hooks.partial(event.item_id || event.event_id, eventText(event), false);
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      this.hooks.final(event.item_id || event.event_id, eventText(event), this.turnStartMs, this.hooks.elapsed());
      this.bufferedAudio = false;
    }
    if (type === "session.finished") {
      this.finished = true; this.hooks.finished(); this.socket?.close(1000, "finished");
    }
    if (type === "error") this.hooks.error(event.error?.message || event.message || "千问实时识别返回错误。");
  }

  writeAudio(buffer) {
    this.sendJson({ type: "input_audio_buffer.append", audio: Buffer.from(buffer).toString("base64") });
  }

  finish() {
    if (this.finished) return;
    this.sendJson({ type: "session.finish" });
    setTimeout(() => { if (!this.finished) super.finish(); }, 8000).unref?.();
  }
}

class OpenAIConnection extends ProviderConnection {
  connect(settings) {
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
      if (!this.ready) { this.ready = true; this.hooks.ready(24000); }
      return;
    }
    if (type === "conversation.item.input_audio_transcription.delta") {
      this.hooks.partial(event.item_id || "openai-current", eventText(event), true);
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      this.hooks.final(event.item_id || event.event_id, eventText(event), this.turnStartMs, this.hooks.elapsed());
      this.bufferedAudio = false;
    }
    if (type === "error") this.hooks.error(event.error?.message || event.message || "OpenAI 实时识别返回错误。");
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
    this.commit();
    setTimeout(() => super.finish(), 3500).unref?.();
  }
}

class TencentConnection extends ProviderConnection {
  connect(settings) {
    const socket = new WebSocket(buildTencentRealtimeUrl(settings, this.options));
    this.bindSocket(socket);
    socket.on("open", () => { this.ready = true; this.hooks.ready(16000); });
    socket.on("message", (data) => this.handle(JSON.parse(data.toString())));
  }

  handle(event) {
    if (Number(event.code || 0) !== 0) return this.hooks.error(event.message || `腾讯云实时识别错误（${event.code}）`);
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
    this.sendJson({ type: "end" });
    setTimeout(() => { if (!this.finished) super.finish(); }, 8000).unref?.();
  }
}

function providerConnection(provider, options, hooks) {
  if (provider === "alibaba") return new QwenConnection(options, hooks);
  if (provider === "tencent") return new TencentConnection(options, hooks);
  if (provider === "openai") return new OpenAIConnection(options, hooks);
  throw new Error("不支持这个实时转写服务。");
}

export class LiveTranscriptionGateway {
  constructor({ settingsStore, runtimeLogger = null }) {
    this.settingsStore = settingsStore;
    this.runtimeLogger = runtimeLogger;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
    this.wss.on("connection", (client) => this.handleClient(client));
  }

  attach(server) {
    server.on("upgrade", (req, socket, head) => {
      const pathname = new URL(req.url, "http://127.0.0.1").pathname;
      if (pathname !== "/api/live") return socket.destroy();
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
      ready: (sampleRate) => send({ type: "ready", sampleRate }),
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
            keywords: Array.isArray(message.keywords) ? message.keywords.map((item) => safeText(item, 100)).filter(Boolean) : []
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
}
