import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { buildTencentRealtimeUrl } from "../lib/live-transcription.mjs";

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
