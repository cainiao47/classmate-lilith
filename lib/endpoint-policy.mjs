import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

export const ENDPOINT_FIELDS = ["deepseekTextEndpoint", "alibabaEndpoint", "openaiEndpoint", "openaiTextEndpoint"];
const TRUSTED_PROVIDER_HOSTS = new Set(["api.deepseek.com", "api.openai.com", "maas.qianwenaiapi.com"]);

function privateIpv4(hostname) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

function privateIpv6(hostname) {
  const value = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd")
    || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb");
}

export function isPrivateAddress(address) {
  const bare = String(address || "").replace(/^\[|\]$/g, "");
  return (isIP(bare) === 4 && privateIpv4(bare)) || (isIP(bare) === 6 && privateIpv6(bare));
}

export function validateRemoteEndpoint(value, fieldName = "API 地址") {
  let url;
  try { url = new URL(String(value)); } catch {
    throw Object.assign(new Error(`${fieldName}不是有效网址。`), { statusCode: 400 });
  }
  if (url.protocol !== "https:") throw Object.assign(new Error(`${fieldName}必须使用 HTTPS。`), { statusCode: 400 });
  if (url.username || url.password) throw Object.assign(new Error(`${fieldName}不能在网址中包含账号或密码。`), { statusCode: 400 });
  const hostname = url.hostname.toLowerCase();
  const bareHostname = hostname.replace(/^\[|\]$/g, "");
  const localName = hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local");
  const localAddress = isPrivateAddress(bareHostname);
  if (localName || localAddress) throw Object.assign(new Error(`${fieldName}不能指向本机或局域网地址。`), { statusCode: 400 });
  return url.toString();
}

export async function validateEndpointUpdate(update, { lookupImpl = lookup } = {}) {
  for (const field of ENDPOINT_FIELDS) {
    if (!Object.hasOwn(update || {}, field) || !String(update[field] || "").trim()) continue;
    const normalized = validateRemoteEndpoint(update[field], field);
    const hostname = new URL(normalized).hostname;
    if (TRUSTED_PROVIDER_HOSTS.has(hostname)) continue;
    let addresses;
    try { addresses = await lookupImpl(hostname, { all: true, verbatim: true }); }
    catch { throw Object.assign(new Error(`${field}的域名无法解析，请检查地址或网络。`), { statusCode: 400 }); }
    if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
      throw Object.assign(new Error(`${field}解析到了本机或局域网地址。`), { statusCode: 400 });
    }
  }
}
