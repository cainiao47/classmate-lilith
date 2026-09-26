export const ONLINE_TRANSCRIPTION_PROVIDERS = Object.freeze([
  { id: "alibaba", name: "千问 API 平台 Qwen3-ASR Flash" },
  { id: "tencent", name: "腾讯云 ASR" },
  { id: "openai", name: "OpenAI GPT Transcribe" }
]);

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
