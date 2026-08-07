// RFC 4226 (HOTP) / RFC 6238 (TOTP) implemented directly on node:crypto — no
// new npm dependency, matching the "no new dependency" choice already made
// for password hashing (see hashPassword in auth.ts). This module is shared
// core used by both the profile bind/unbind 2FA routes (T-MEMORY-028) and
// the open self-registration flow (T-MEMORY-038, D-MEMORY-016).
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import { AppError } from "../shared/errors.js";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;

/** 20 random bytes — the RFC 4226-recommended HOTP secret length (160 bits). */
export function generateTotpSecret(): Buffer {
  return randomBytes(20);
}

/** RFC 4648 base32 encode, no padding (padding is optional for display/QR use). */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/** RFC 4648 base32 decode. Tolerates lowercase input and `=` padding. */
export function base32Decode(str: string): Buffer {
  const clean = str
    .toUpperCase()
    .replace(/=+$/, "")
    .replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) {
      continue;
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function buildOtpauthUrl(secretBase32: string, email: string, issuer = "PMem"): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`;
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS)
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function hotp(secret: Buffer, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  // Counter fits comfortably in the low 32 bits for any realistic TOTP step
  // count, but write the full 64-bit big-endian counter per RFC 4226.
  counterBuf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = binCode % 10 ** TOTP_DIGITS;
  return otp.toString().padStart(TOTP_DIGITS, "0");
}

/**
 * Checks `code` against the current 30s time step, accepting the current
 * step plus/minus `windowSteps` (default 1 => previous/current/next, 3
 * codes total) to tolerate clock drift between server and authenticator app.
 */
export function verifyTotpCode(secretBase32: string, code: string, windowSteps = 1): boolean {
  const normalized = code.trim();
  if (!/^\d{6}$/.test(normalized)) {
    return false;
  }
  const secret = base32Decode(secretBase32);
  const currentStep = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
  const candidateBuf = Buffer.from(normalized, "utf8");
  for (let delta = -windowSteps; delta <= windowSteps; delta += 1) {
    const expected = hotp(secret, currentStep + delta);
    const expectedBuf = Buffer.from(expected, "utf8");
    if (expectedBuf.length === candidateBuf.length && timingSafeEqual(expectedBuf, candidateBuf)) {
      return true;
    }
  }
  return false;
}

/**
 * High-entropy, human-typeable recovery codes: 10 base32 characters (50
 * bits of entropy) grouped as XXXX-XXXX-XX for readability. Returned as
 * plaintext — callers must hash them (hashRecoveryCode) before storing and
 * show the plaintext to the user exactly once.
 */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const raw = base32Encode(randomBytes(7)).slice(0, 10);
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 10)}`);
  }
  return codes;
}

function normalizeRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * sha256 hex — same pattern as hashToken() in auth.ts. Recovery codes are
 * high-entropy random strings (unlike user-chosen passwords), so a fast
 * hash is appropriate here; scrypt is unnecessary. Normalizes formatting
 * (case, dashes) first so a code hashes identically regardless of how the
 * user types or pastes it back in.
 */
export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

function totpEncryptionKey(): Buffer {
  const raw = process.env.TOTP_ENC_KEY;
  if (!raw) {
    throw new AppError(
      "VALIDATION_ERROR",
      "TOTP_ENC_KEY must be set to a 32-byte base64 value to use TOTP."
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new AppError(
      "VALIDATION_ERROR",
      "TOTP_ENC_KEY must be set to a 32-byte base64 value to use TOTP."
    );
  }
  if (key.length !== 32) {
    throw new AppError(
      "VALIDATION_ERROR",
      "TOTP_ENC_KEY must be set to a 32-byte base64 value to use TOTP."
    );
  }
  return key;
}

/**
 * AES-256-GCM, keyed by TOTP_ENC_KEY (env, 32 raw bytes base64-encoded).
 * Output is self-describing: base64(iv):base64(authTag):base64(ciphertext).
 * Fails loudly (throws) rather than ever writing a plaintext secret to the
 * database — see totpEncryptionKey() above.
 */
export function encryptSecret(plaintextBase32: string): string {
  const key = totpEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintextBase32, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptSecret(enc: string): string {
  const key = totpEncryptionKey();
  const parts = enc.split(":");
  if (parts.length !== 3) {
    throw new AppError("VALIDATION_ERROR", "Stored TOTP secret is malformed.");
  }
  const [ivB64, tagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
