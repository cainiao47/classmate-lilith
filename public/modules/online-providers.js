export const ONLINE_TRANSCRIPTION_PROVIDERS = Object.freeze([
  { id: "alibaba", name: "千问 API 平台语音识别" },
  { id: "tencent", name: "腾讯云 ASR" },
  { id: "openai", name: "OpenAI GPT Transcribe" }
]);

export const ALIBABA_FILE_MODELS = Object.freeze([
  { id: "qwen3-asr-flash", name: "Qwen3-ASR · 通用、多语种与常见方言" },
  { id: "qwen-audio-3.0-asr-flash", name: "Qwen-Audio 3.0 · 中文方言覆盖最广" },
  { id: "qwen-audio-3.1-asr-flash", name: "Qwen-Audio 3.1 · 新版、保留方言表达" },
  { id: "fun-asr-flash-2026-06-15", name: "Fun-ASR Flash · 广覆盖与规范标点" }
]);

export function isAlibabaFileModel(id) {
  return ALIBABA_FILE_MODELS.some((model) => model.id === id);
}

const PROVIDER_IDS = new Set(ONLINE_TRANSCRIPTION_PROVIDERS.map((provider) => provider.id));

export function isOnlineTranscriptionProvider(id) {
  return PROVIDER_IDS.has(id);
}

export function providerConfigured(settings, id) {
  const saved = settings?.saved || {};
  if (id === "tencent") return Boolean(saved.tencentSecretId && saved.tencentSecretKey);
  if (id === "alibaba") return Boolean(saved.alibabaApiKey);
  if (id === "openai") return Boolean(saved.openaiApiKey);
  return false;
}

export function configuredProviderCount(settings) {
  return ONLINE_TRANSCRIPTION_PROVIDERS.filter((provider) => providerConfigured(settings, provider.id)).length;
}

export function preferredOnlineProvider(preferred, fallback = "alibaba") {
  if (isOnlineTranscriptionProvider(preferred)) return preferred;
  return isOnlineTranscriptionProvider(fallback) ? fallback : "alibaba";
}
