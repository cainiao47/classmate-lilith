import crypto from "node:crypto";

export function createLoopbackSecurity({ port, token = crypto.randomBytes(32).toString("base64url") }) {
  const cookieName = "classmate_session";
  const expectedOrigin = `http://127.0.0.1:${port}`;
  const expectedCookie = `${cookieName}=${token}`;

  function hasSessionCookie(req) {
    return String(req.headers.cookie || "").split(/;\s*/).includes(expectedCookie);
  }

  function hasTrustedOrigin(req) {
    const origin = String(req.headers.origin || "");
    return !origin || origin === expectedOrigin;
  }

  return {
    cookieHeader: `${expectedCookie}; Path=/; HttpOnly; SameSite=Strict`,
    authorizeApi(req) {
      return hasSessionCookie(req) && hasTrustedOrigin(req);
    },
    authorizeWebSocket(req) {
      return hasSessionCookie(req) && String(req.headers.origin || "") === expectedOrigin;
    }
  };
}
