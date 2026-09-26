import crypto from "node:crypto";

const TENCENT_HOST = "billing.tencentcloudapi.com";
const TENCENT_SERVICE = "billing";
const TENCENT_ACTION = "DescribeAccountBalance";
const TENCENT_VERSION = "2018-07-09";

export const ACCOUNT_DASHBOARDS = Object.freeze({
  alibaba: "https://platform.qianwenai.com/home/api-keys",
  openai: "https://platform.openai.com/usage"
});

function jsonError(payload, fallback) {
  return payload?.error?.message || payload?.Response?.Error?.Message || payload?.Message || fallback;
}

async function jsonResponse(response) {
  return response.json().catch(() => ({}));
}

function hmac(key, value) {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function createTencentBillingRequest(secretId, secretKey, now = new Date()) {
  const timestamp = Math.floor(now.getTime() / 1000);
  const date = now.toISOString().slice(0, 10);
  const payload = "{}";
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${TENCENT_HOST}\nx-tc-action:${TENCENT_ACTION.toLowerCase()}\n`;
  const signedHeaders = "content-type;host;x-tc-action";
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, sha256(payload)].join("\n");
  const credentialScope = `${date}/${TENCENT_SERVICE}/tc3_request`;
  const stringToSign = ["TC3-HMAC-SHA256", timestamp, credentialScope, sha256(canonicalRequest)].join("\n");
  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, TENCENT_SERVICE);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = crypto.createHmac("sha256", secretSigning).update(stringToSign).digest("hex");
  return {
    url: `https://${TENCENT_HOST}`,
    body: payload,
    headers: {
      "Authorization": `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "Content-Type": "application/json; charset=utf-8",
      "Host": TENCENT_HOST,
      "X-TC-Action": TENCENT_ACTION,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Version": TENCENT_VERSION
    }
  };
}

function validationUrl(endpoint, provider) {
  const url = new URL(endpoint);
  if (provider === "alibaba") return `${url.origin}/api/v1/models?page_no=1&page_size=1`;
  return `${url.origin}/v1/models`;
}

export async function queryAccountStatus(provider, settings, {
  fetchImpl = fetch,
  now = new Date(),
  deepseekBalanceUrl = "https://api.deepseek.com/user/balance"
} = {}) {
  const requestOptions = { signal: AbortSignal.timeout(15_000) };

  if (provider === "deepseek") {
    if (!settings.deepseekApiKey) throw new Error("请先保存 DeepSeek API Key。");
    const response = await fetchImpl(deepseekBalanceUrl, {
      ...requestOptions,
      headers: { "Authorization": `Bearer ${settings.deepseekApiKey}` }
    });
    const payload = await jsonResponse(response);
    if (!response.ok) throw new Error(jsonError(payload, `DeepSeek 账户查询失败（HTTP ${response.status}）`));
    const balances = Array.isArray(payload.balance_infos) ? payload.balance_infos.map((item) => ({
      currency: item.currency || "",
      total: String(item.total_balance ?? ""),
      toppedUp: String(item.topped_up_balance ?? ""),
      granted: String(item.granted_balance ?? "")
    })) : [];
    return { provider, type: "balance", available: Boolean(payload.is_available), balances, checkedAt: now.toISOString() };
  }

  if (provider === "tencent") {
    if (!settings.tencentSecretId || !settings.tencentSecretKey) throw new Error("请先保存完整的腾讯云 SecretId 和 SecretKey。");
    const request = createTencentBillingRequest(settings.tencentSecretId, settings.tencentSecretKey, now);
    const response = await fetchImpl(request.url, { ...requestOptions, method: "POST", headers: request.headers, body: request.body });
    const payload = await jsonResponse(response);
    const result = payload?.Response || {};
    if (!response.ok || result.Error) throw new Error(jsonError(payload, `腾讯云账户查询失败（HTTP ${response.status}）`));
    const cents = Number(result.RealBalance ?? result.Balance);
    if (!Number.isFinite(cents)) throw new Error("腾讯云返回了无法识别的余额信息。");
    return {
      provider,
      type: "balance",
      available: cents > 0 || Boolean(result.IsAllowArrears),
      balances: [{ currency: "CNY", total: (cents / 100).toFixed(2), toppedUp: "", granted: "" }],
      checkedAt: now.toISOString()
    };
  }

  if (provider === "alibaba") {
    if (!settings.alibabaApiKey) throw new Error("请先保存千问 API Key。");
    const endpoint = settings.alibabaEndpoint || "https://maas.qianwenaiapi.com/compatible-mode/v1/chat/completions";
    const response = await fetchImpl(validationUrl(endpoint, provider), {
      ...requestOptions,
      headers: { "Authorization": `Bearer ${settings.alibabaApiKey}` }
    });
    const payload = await jsonResponse(response);
    if (!response.ok) throw new Error(jsonError(payload, `千问 API Key 验证失败（HTTP ${response.status}）`));
    return { provider, type: "verified", available: true, dashboardUrl: ACCOUNT_DASHBOARDS.alibaba, checkedAt: now.toISOString() };
  }

  if (provider === "openai") {
    if (!settings.openaiApiKey) throw new Error("请先保存 OpenAI API Key。");
    const endpoint = settings.openaiEndpoint || "https://api.openai.com/v1/audio/transcriptions";
    const response = await fetchImpl(validationUrl(endpoint, provider), {
      ...requestOptions,
      headers: { "Authorization": `Bearer ${settings.openaiApiKey}` }
    });
    const payload = await jsonResponse(response);
    if (!response.ok) throw new Error(jsonError(payload, `OpenAI Key 验证失败（HTTP ${response.status}）`));
    return { provider, type: "verified", available: true, dashboardUrl: ACCOUNT_DASHBOARDS.openai, checkedAt: now.toISOString() };
  }

  throw new Error("不支持的账户服务商。");
}
