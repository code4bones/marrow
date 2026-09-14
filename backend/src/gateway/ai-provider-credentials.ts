// "Ask Marrow" AI provider credentials (2026-09-14) -- per-user stored API
// keys for LLM providers (deepseek today; claude/codex are valid rows but
// have no working src/gateway/llm-providers/ implementation yet). Mirrors
// git-credentials.ts's top section exactly: AES-256-GCM via crypto.ts,
// under its own key (AI_PROVIDER_ENC_KEY, independent of
// GIT_CREDENTIAL_ENC_KEY/ENV_VAR_ENC_KEY/TOTP_ENC_KEY).
import { AppError } from "../shared/errors.js";
import { aesGcmDecrypt, aesGcmEncrypt, loadAesGcmKey } from "./crypto.js";

function aiProviderEncryptionKey(): Buffer {
  try {
    return loadAesGcmKey("AI_PROVIDER_ENC_KEY");
  } catch {
    throw new AppError(
      "VALIDATION_ERROR",
      "AI_PROVIDER_ENC_KEY must be set to a 32-byte base64 value to store AI provider credentials."
    );
  }
}

export function encryptProviderKey(apiKey: string): string {
  return aesGcmEncrypt(aiProviderEncryptionKey(), apiKey);
}

export function decryptProviderKey(enc: string): string {
  return aesGcmDecrypt(aiProviderEncryptionKey(), enc, "Stored AI provider key is malformed.");
}

/** Last 4 characters only, for UI/list-view recognition -- same shape as git-credentials.ts's tokenHint. */
export function providerKeyHint(apiKey: string): string {
  return apiKey.length <= 4 ? apiKey : apiKey.slice(-4);
}
