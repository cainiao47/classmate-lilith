import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { ALIBABA_LIVE_MODELS, LIVE_AUDIO_BUFFER_MAX_BYTES, appendBoundedAudio, buildTencentRealtimeUrl } from "../lib/live-transcription.mjs";

test("Tencent realtime URL signs every non-signature query parameter", () => {
  const secretKey = "secret-key";
  const url = new URL(buildTencentRealtimeUrl({
    tencentAppId: "1250000000", tencentSecretId: "secret-id", tencentSecretKey: secretKey
  }, { language: "zh", voiceId: "voice-test" }));
  assert.equal(url.protocol, "wss:");
  assert.equal(url.pathname, "/asr/v2/1250000000");
  assert.equal(url.searchParams.get("engine_model_type"), "16k_zh_edu");
  assert.equal(url.searchParams.get("voice_format"), "1");
  assert.equal(url.searchParams.get("voice_id"), "voice-test");
  const params = [...url.searchParams.entries()].filter(([key]) => key !== "signature").sort(([a], [b]) => a.localeCompare(b));
  const signingQuery = params.map(([key, value]) => `${key}=${value}`).join("&");
  const expected = crypto.createHmac("sha1", secretKey).update(`asr.cloud.tencent.com${url.pathname}?${signingQuery}`).digest("base64");
  assert.equal(url.searchParams.get("signature"), expected);
});

test("Tencent realtime requires AppID in addition to the saved API credentials", () => {
  assert.throws(() => buildTencentRealtimeUrl({ tencentSecretId: "id", tencentSecretKey: "key" }), /AppID/);
});

test("Alibaba realtime exposes general and broad-dialect streaming models", () => {
  assert.deepEqual([...ALIBABA_LIVE_MODELS], [
    "qwen3-asr-flash-realtime",
    "qwen-audio-3.1-asr-flash-streaming",
    "qwen-audio-3.0-asr-flash-streaming",
    "fun-asr-realtime"
  ]);
});

test("an hour-long realtime stream keeps only the bounded reconnect window", () => {
  const queue = [];
  let bytes = 0;
  const hundredMillisecondsOfPcm16 = Buffer.alloc(16_000 * 2 / 10);
  for (let index = 0; index < 60 * 60 * 10; index += 1) {
    bytes = appendBoundedAudio(queue, bytes, hundredMillisecondsOfPcm16);
  }
  assert.equal(bytes, LIVE_AUDIO_BUFFER_MAX_BYTES);
  assert.equal(queue.length, 200);
});
