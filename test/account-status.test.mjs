import assert from "node:assert/strict";
import test from "node:test";
import { createTencentBillingRequest, queryAccountStatus } from "../lib/account-status.mjs";

function response(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

test("DeepSeek account status returns normalized balances", async () => {
  const result = await queryAccountStatus("deepseek", { deepseekApiKey: "secret" }, {
    fetchImpl: async () => response({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "12.34", topped_up_balance: "10", granted_balance: "2.34" }] })
  });
  assert.equal(result.type, "balance");
  assert.deepEqual(result.balances[0], { currency: "CNY", total: "12.34", toppedUp: "10", granted: "2.34" });
});

test("Tencent billing request is signed without exposing the secret key", () => {
  const request = createTencentBillingRequest("AKIDexample", "private-secret", new Date("2026-09-26T00:00:00.000Z"));
  assert.match(request.headers.Authorization, /^TC3-HMAC-SHA256 Credential=AKIDexample\/2026-09-26\/billing\/tc3_request/);
  assert.doesNotMatch(request.headers.Authorization, /private-secret/);
  assert.equal(request.headers["X-TC-Action"], "DescribeAccountBalance");
});

test("Tencent account status converts cents to yuan", async () => {
  const result = await queryAccountStatus("tencent", { tencentSecretId: "id", tencentSecretKey: "key" }, {
    fetchImpl: async () => response({ Response: { RealBalance: 12345, IsAllowArrears: false } })
  });
  assert.equal(result.balances[0].total, "123.45");
});

test("Alibaba and OpenAI validate model keys without claiming to know balances", async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return response({ data: [] }); };
  const alibaba = await queryAccountStatus("alibaba", { alibabaApiKey: "ali", alibabaEndpoint: "https://maas.qianwenaiapi.com/compatible-mode/v1/chat/completions" }, { fetchImpl });
  const openai = await queryAccountStatus("openai", { openaiApiKey: "openai", openaiEndpoint: "https://api.openai.com/v1/audio/transcriptions" }, { fetchImpl });
  assert.equal(alibaba.type, "verified");
  assert.equal(openai.type, "verified");
  assert.match(calls[0], /maas\.qianwenaiapi\.com\/api\/v1\/models/);
  assert.equal(calls[1], "https://api.openai.com/v1/models");
});
