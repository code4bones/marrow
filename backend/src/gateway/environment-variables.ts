// Marrow-native "Environment Variables" domain (2026-09-14, owner's
// request): a .env-style key/value store an agent can read via
// env.variables_list/env.variable_get, scoped either to the caller's own
// profile ("common", like a personal .env carried into every project) or
// to one project ("project", visible to every project member, like a
// team's shared .env). This is NOT git.variable_* -- those proxy a real
// GitLab project's own CI/CD variables over the GitLab REST API
// (git-credentials.ts); this is Marrow's own storage for arbitrary config
// (API keys, base URLs, feature flags, ...) an agent needs without a human
// pasting it into chat every session.
//
// Every value is encrypted at rest via AES-256-GCM (crypto.ts, same cipher
// as git_credentials.token_enc/users.totp_secret) regardless of the
// `secret` flag -- one code path, no plaintext column, costs nothing at
// read time. `secret` only controls whether env.variable_get/list masks
// the value by default (same default-true/opt-out `redact` shape as
// git.variable_get).
//
// Own encryption key, ENV_VAR_ENC_KEY, independent of
// GIT_CREDENTIAL_ENC_KEY/TOTP_ENC_KEY -- a different secret class again;
// see git-credentials.ts's own comment for why these are never shared.
import { AppError } from "../shared/errors.js";
import { aesGcmDecrypt, aesGcmEncrypt, loadAesGcmKey } from "./crypto.js";

function envVariableEncryptionKey(): Buffer {
  try {
    return loadAesGcmKey("ENV_VAR_ENC_KEY");
  } catch {
    throw new AppError(
      "VALIDATION_ERROR",
      "ENV_VAR_ENC_KEY must be set to a 32-byte base64 value to store environment variables."
    );
  }
}

export function encryptEnvValue(value: string): string {
  return aesGcmEncrypt(envVariableEncryptionKey(), value);
}

export function decryptEnvValue(enc: string): string {
  return aesGcmDecrypt(envVariableEncryptionKey(), enc, "Stored environment variable value is malformed.");
}

const ENV_KEY_PATTERN = /^[A-Za-z0-9_]+$/;

export function validateEnvKey(key: unknown): string {
  const value = String(key ?? "");
  if (!ENV_KEY_PATTERN.test(value)) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Environment variable keys may only contain letters, digits, and underscores (got "${value}").`
    );
  }
  return value;
}
