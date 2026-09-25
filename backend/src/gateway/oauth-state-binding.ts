import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { loadAesGcmKey } from "./crypto.js";

// Login-CSRF protection for the GitHub / Telegram sign-in (SEC-11).
//
// The OAuth `state` was a server-side random row, but nothing tied it to the
// BROWSER that started the flow: an attacker could start a sign-in with their
// own GitHub/Telegram account, stop before the callback, and hand the callback
// URL (code + state) to a victim -- whose browser would then be silently
// signed in as the attacker (or have the attacker's identity linked).
//
// Fix, without a schema change: /start puts a short-lived HttpOnly cookie in the
// browser and signs the state with it -- what goes to the provider is
// `<raw>.<hmac(key, raw:nonce)>`. The callback needs BOTH the state and a
// cookie whose nonce reproduces the signature, so a URL alone is useless.
//   - one cookie PER STATE (name derived from the state) so parallel tabs do not
//     clobber each other;
//   - SameSite=Lax: sent on the provider's top-level redirect back to us;
//   - a state without a signature (issued before this shipped, <= 10 min ago) is
//     accepted as before: such rows cannot be minted any more and expire on
//     their own;
//   - if TOTP_ENC_KEY is not configured no key can be derived: the binding is
//     skipped rather than breaking sign-in (the key is required for the
//     registration/2FA features these deployments use anyway).

const COOKIE_TTL_SECONDS = 10 * 60;

function bindingKey(): Buffer | null {
  try {
    return createHmac("sha256", loadAesGcmKey("TOTP_ENC_KEY")).update("marrow:oauth-state-binding:v1").digest();
  } catch {
    return null;
  }
}

function signature(key: Buffer, raw: string, nonce: string): string {
  return createHmac("sha256", key).update(`${raw}:${nonce}`).digest("hex").slice(0, 32);
}

export function bindingCookieName(raw: string): string {
  return `marrow_oauth_${createHash("sha256").update(raw).digest("hex").slice(0, 12)}`;
}

function cookieHeader(name: string, nonce: string, secure: boolean): string {
  const attrs = [`${name}=${nonce}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${COOKIE_TTL_SECONDS}`];
  if (secure) {
    attrs.push("Secure");
  }
  return attrs.join("; ");
}

// What /start sends to the provider and sets in the browser.
export function startOAuthBinding(raw: string, secure: boolean): { state: string; setCookie: string | null } {
  const key = bindingKey();
  if (!key) {
    return { state: raw, setCookie: null };
  }
  const nonce = randomBytes(24).toString("base64url");
  return { state: `${raw}.${signature(key, raw, nonce)}`, setCookie: cookieHeader(bindingCookieName(raw), nonce, secure) };
}

export type OAuthBindingResult =
  | { ok: true; raw: string; legacy: boolean }
  | { ok: false; raw: string; reason: "missing_cookie" | "bad_signature" | "malformed" };

// What /callback checks before it consumes the state row.
export function verifyOAuthBinding(state: string, cookies: Record<string, string>): OAuthBindingResult {
  const dot = state.indexOf(".");
  if (dot < 0) {
    return { ok: true, raw: state, legacy: true };
  }
  const raw = state.slice(0, dot);
  const presented = state.slice(dot + 1);
  if (!raw || !/^[0-9a-f]{32}$/.test(presented)) {
    return { ok: false, raw, reason: "malformed" };
  }
  const key = bindingKey();
  if (!key) {
    // Cannot verify (key vanished after /start): treat like the skipped-binding case.
    return { ok: true, raw, legacy: true };
  }
  const nonce = cookies[bindingCookieName(raw)];
  if (!nonce) {
    return { ok: false, raw, reason: "missing_cookie" };
  }
  const expected = Buffer.from(signature(key, raw, nonce), "utf8");
  const given = Buffer.from(presented, "utf8");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, raw, reason: "bad_signature" };
  }
  return { ok: true, raw, legacy: false };
}
