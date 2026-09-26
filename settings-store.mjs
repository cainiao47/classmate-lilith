import crypto from "node:crypto";
import { readJsonFile, writeJsonAtomic } from "./lib/json-file.mjs";

const SECRET_FIELDS = ["deepseekApiKey", "tencentSecretId", "tencentSecretKey", "alibabaApiKey", "openaiApiKey"];
const ALLOW_EMPTY_FIELDS = ["shortcutTogglePlayback", "shortcutApplyCurrent", "shortcutNextReview", "shortcutPreviousReview", "shortcutRewindAudio", "shortcutForwardAudio"];
const LEGACY_ALIBABA_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const QIANWEN_ENDPOINT = "https://maas.qianwenaiapi.com/compatible-mode/v1/chat/completions";
const DEFAULTS = {
  asrProvider: "alibaba",
  textProvider: "deepseek",
  deepseekApiKey: "",
  deepseekTextModel: "deepseek-flash",
  deepseekTextEndpoint: "https://api.deepseek.com/chat/completions",
  tencentAppId: "",
  tencentSecretId: "",
  tencentSecretKey: "",
  alibabaApiKey: "",
  alibabaEndpoint: QIANWEN_ENDPOINT,
  alibabaModel: "qwen3-asr-flash",
  openaiApiKey: "",
  openaiEndpoint: "https://api.openai.com/v1/audio/transcriptions",
  openaiModel: "gpt-transcribe",
  openaiTextEndpoint: "https://api.openai.com/v1/responses",
  openaiTextModel: "gpt-5-mini",
  shortcutsEnabled: "true",
  shortcutTogglePlayback: "F8",
  shortcutApplyCurrent: "Control+Enter",
  shortcutNextReview: "Alt+ArrowDown",
  shortcutPreviousReview: "Alt+ArrowUp",
  shortcutRewindAudio: "Alt+ArrowLeft",
  shortcutForwardAudio: "Alt+ArrowRight"
};

const DISK_KEYS = {
  asrProvider: "asr_provider",
  textProvider: "text_provider",
  deepseekApiKey: "deepseek_api_key",
  deepseekTextModel: "deepseek_text_model",
  deepseekTextEndpoint: "deepseek_text_endpoint",
  tencentAppId: "tencent_app_id",
  tencentSecretId: "tencent_secret_id",
  tencentSecretKey: "tencent_secret_key",
  alibabaApiKey: "alibaba_api_key",
  alibabaEndpoint: "alibaba_endpoint",
  alibabaModel: "alibaba_model",
  openaiApiKey: "openai_api_key",
  openaiEndpoint: "openai_endpoint",
  openaiModel: "openai_model",
  openaiTextEndpoint: "openai_text_endpoint",
  openaiTextModel: "openai_text_model",
  shortcutsEnabled: "shortcuts_enabled",
  shortcutTogglePlayback: "shortcut_toggle_playback",
  shortcutApplyCurrent: "shortcut_apply_current",
  shortcutNextReview: "shortcut_next_review",
  shortcutPreviousReview: "shortcut_previous_review",
  shortcutRewindAudio: "shortcut_rewind_audio",
  shortcutForwardAudio: "shortcut_forward_audio"
};

const ENCRYPTION_KEY = crypto.createHash("sha256").update("ClassTranscriberPortable.ApiSettings.v1", "utf8").digest();

function protect(value) {
  if (!value) return "";
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  return `enc:${Buffer.concat([iv, cipher.update(String(value), "utf8"), cipher.final()]).toString("base64")}`;
}

function unprotect(value) {
  if (!value) return "";
  if (!String(value).startsWith("enc:")) return String(value);
  const packed = Buffer.from(String(value).slice(4), "base64");
  const iv = packed.subarray(0, 16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  return Buffer.concat([decipher.update(packed.subarray(16)), decipher.final()]).toString("utf8");
}

export class SettingsStore {
  constructor({ file, legacyFile }) {
    this.file = file;
    this.legacyFile = legacyFile;
  }

  async initialize() {
    const current = await readJsonFile(this.file);
    const normalized = this.decode(current);
    let changed = Object.keys(current).length > 0 && current.format !== "portable-light-encryption-v3";
    if (this.legacyFile && current.legacy_migrated_v1 !== true) {
      const legacy = this.decode(await readJsonFile(this.legacyFile));
      for (const key of Object.keys(DEFAULTS)) {
        if (!normalized[key] && legacy[key]) { normalized[key] = legacy[key]; changed = true; }
      }
      changed = true;
    }
    if (normalized.alibabaEndpoint === LEGACY_ALIBABA_ENDPOINT) {
      normalized.alibabaEndpoint = QIANWEN_ENDPOINT;
      changed = true;
    }
    if (changed) await this.write(normalized);
  }

  decode(raw) {
    const settings = { ...DEFAULTS };
    for (const [key, diskKey] of Object.entries(DISK_KEYS)) {
      const value = raw?.[diskKey] ?? raw?.[key];
      if (value == null) continue;
      try { settings[key] = SECRET_FIELDS.includes(key) ? unprotect(value) : String(value); }
      catch { settings[key] = ""; }
    }
    return settings;
  }

  async load() {
    return this.decode(await readJsonFile(this.file));
  }

  async save(update) {
    const settings = await this.load();
    for (const key of Object.keys(DEFAULTS)) {
      if (!Object.hasOwn(update || {}, key)) continue;
      const value = String(update[key] ?? "").trim();
      // Blank secret fields mean "keep the saved value". Clearing a secret is
      // deliberately handled by clearProvider so opening the dialog cannot erase it.
      if (SECRET_FIELDS.includes(key) && !value) continue;
      settings[key] = value;
    }
    await this.write(settings);
    return settings;
  }

  async clearProvider(provider) {
    const keys = {
      deepseek: ["deepseekApiKey"],
      tencent: ["tencentAppId", "tencentSecretId", "tencentSecretKey"],
      alibaba: ["alibabaApiKey"],
      openai: ["openaiApiKey"]
    }[provider];
    if (!keys) throw new Error("未知的服务商。");
    const settings = await this.load();
    for (const key of keys) settings[key] = "";
    await this.write(settings);
    return settings;
  }

  async write(settings) {
    const raw = { format: "portable-light-encryption-v3", legacy_migrated_v1: true };
    for (const [key, diskKey] of Object.entries(DISK_KEYS)) {
      raw[diskKey] = SECRET_FIELDS.includes(key)
        ? protect(settings[key])
        : ALLOW_EMPTY_FIELDS.includes(key) ? String(settings[key] ?? "") : String(settings[key] || DEFAULTS[key] || "");
    }
    await writeJsonAtomic(this.file, raw);
  }

  publicView(settings) {
    const result = { ...settings, saved: {} };
    for (const key of SECRET_FIELDS) {
      result.saved[key] = Boolean(settings[key]);
      result[key] = "";
    }
    return result;
  }
}
