import assert from "node:assert/strict";
import test from "node:test";
import { createLoopbackSecurity } from "../lib/loopback-security.mjs";

function request(headers = {}) {
  return { headers };
}

test("loopback API requires its private same-site session cookie", () => {
  const security = createLoopbackSecurity({ port: 4178, token: "test-token" });
  assert.equal(security.authorizeApi(request()), false);
  assert.equal(security.authorizeApi(request({ cookie: "classmate_session=test-token" })), true);
  assert.equal(security.authorizeApi(request({ cookie: "classmate_session=test-token", origin: "https://example.com" })), false);
  assert.equal(security.authorizeApi(request({ cookie: "classmate_session=test-token", origin: "http://127.0.0.1:4178" })), true);
});

test("realtime WebSocket requires both the session cookie and exact local origin", () => {
  const security = createLoopbackSecurity({ port: 4178, token: "test-token" });
  assert.equal(security.authorizeWebSocket(request({ cookie: "classmate_session=test-token" })), false);
  assert.equal(security.authorizeWebSocket(request({ cookie: "classmate_session=test-token", origin: "https://example.com" })), false);
  assert.equal(security.authorizeWebSocket(request({ cookie: "classmate_session=test-token", origin: "http://127.0.0.1:4178" })), true);
});
