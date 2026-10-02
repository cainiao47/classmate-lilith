import assert from "node:assert/strict";
import test from "node:test";
import { validateEndpointUpdate, validateRemoteEndpoint } from "../lib/endpoint-policy.mjs";

test("custom API endpoints require remote HTTPS addresses", () => {
  assert.equal(validateRemoteEndpoint("https://api.example.com/v1"), "https://api.example.com/v1");
  assert.throws(() => validateRemoteEndpoint("http://api.example.com/v1"), /HTTPS/);
  assert.throws(() => validateRemoteEndpoint("https://127.0.0.1:8443/v1"), /本机或局域网/);
  assert.throws(() => validateRemoteEndpoint("https://192.168.1.20/v1"), /本机或局域网/);
  assert.throws(() => validateRemoteEndpoint("https://user:secret@example.com/v1"), /账号或密码/);
});

test("custom endpoint DNS may not resolve to a private address", async () => {
  await assert.rejects(
    () => validateEndpointUpdate(
      { openaiEndpoint: "https://compatible.example.test/v1/audio/transcriptions" },
      { lookupImpl: async () => [{ address: "10.1.2.3", family: 4 }] }
    ),
    /本机或局域网/
  );
  await validateEndpointUpdate(
    { openaiEndpoint: "https://compatible.example.test/v1/audio/transcriptions" },
    { lookupImpl: async () => [{ address: "203.0.113.8", family: 4 }] }
  );
});
