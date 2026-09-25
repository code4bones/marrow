import { createHmac, timingSafeEqual } from "node:crypto";
import { loadAesGcmKey } from "./crypto.js";

// Proof that the password step of a login really happened (SEC-9/11).
// POST /auth/login/2fa used to accept just { userId, code }: the userId is a
// UUID other project members can see, so whoever phished one TOTP/recovery
// code could sign in WITHOUT the password. /auth/login now hands out this
// short-lived token, HMAC-bound to the user, and the second step must present
// it. Stateless (no schema change): `<expiresAtMs>.<hex hmac(userId.expiresAtMs)>`,
// keyed off TOTP_ENC_KEY through a domain-separated derivation so the AES key
// itself is never used as an HMAC key.

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function challengeKey(): Buffer {
  return createHmac("sha256", loadAesGcmKey("TOTP_ENC_KEY")).update("marrow:totp-login-challenge:v1").digest();
}

function mac(userId: string, expiresAtMs: number): string {
  return createHmac("sha256", challengeKey()).update(`${userId}.${expiresAtMs}`).digest("hex");
}

export function issueTotpChallenge(userId: string, nowMs = Date.now()): string {
  const expiresAtMs = nowMs + CHALLENGE_TTL_MS;
  return `${expiresAtMs}.${mac(userId, expiresAtMs)}`;
}

export function verifyTotpChallenge(userId: string, challenge: string, nowMs = Date.now()): boolean {
  const match = /^(\d{10,16})\.([0-9a-f]{64})$/.exec(challenge);
  if (!match) {
    return false;
  }
  const expiresAtMs = Number(match[1]);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs < nowMs) {
    return false;
  }
  const expected = Buffer.from(mac(userId, expiresAtMs), "utf8");
  const presented = Buffer.from(match[2], "utf8");
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}

// 2FA is mandatory-challenge once every client sends it. Until the front-end
// release that carries the challenge is live everywhere, a missing challenge
// is still accepted (a PRESENT but wrong one never is).
export function totpChallengeRequired(): boolean {
  return process.env.TOTP_CHALLENGE_REQUIRED === "1";
}
