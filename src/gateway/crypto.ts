// Generic AES-256-GCM encrypt/decrypt-at-rest helpers, factored out of
// totp.ts (T-MEMORY-044) so a second secret class (git host tokens) can
// reuse the exact same cipher and on-disk format without copy-pasting the
// `createCipheriv`/`createDecipheriv` plumbing, or -- worse -- inventing a
// second, subtly different implementation. totp.ts's own
// encryptSecret/decryptSecret now call straight through to these; nothing
// about their behavior, output format, or error handling changed by this
// extraction (see the git blame on this file's introduction for a diff
// against the pre-extraction totp.ts).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "../shared/errors.js";

/**
 * Reads and validates a base64-encoded 32-byte key from `process.env[envVar]`.
 * Throws a `VALIDATION_ERROR` naming `envVar` (not a generic message) if the
 * variable is missing, isn't valid base64, or doesn't decode to exactly 32
 * bytes -- callers should let this propagate rather than falling back to
 * writing a plaintext secret.
 */
export function loadAesGcmKey(envVar: string): Buffer {
  const raw = process.env[envVar];
  if (!raw) {
    throw new AppError("VALIDATION_ERROR", `${envVar} must be set to a 32-byte base64 value.`);
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new AppError("VALIDATION_ERROR", `${envVar} must be set to a 32-byte base64 value.`);
  }
  if (key.length !== 32) {
    throw new AppError("VALIDATION_ERROR", `${envVar} must be set to a 32-byte base64 value.`);
  }
  return key;
}

/**
 * AES-256-GCM encrypt. Output is self-describing:
 * `base64(iv):base64(authTag):base64(ciphertext)` -- same format
 * totp.ts has always used for `users.totp_secret`.
 */
export function aesGcmEncrypt(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/**
 * Inverse of aesGcmEncrypt. Throws `VALIDATION_ERROR` with `malformedMessage`
 * if `enc` isn't the expected three-part format (a caller-specific message
 * so "stored TOTP secret is malformed" and "stored git token is malformed"
 * don't get conflated in an error log).
 */
export function aesGcmDecrypt(key: Buffer, enc: string, malformedMessage: string): string {
  const parts = enc.split(":");
  if (parts.length !== 3) {
    throw new AppError("VALIDATION_ERROR", malformedMessage);
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
