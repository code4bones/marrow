import { Api } from "grammy";
import { aesGcmDecrypt, aesGcmEncrypt, loadAesGcmKey } from "../crypto.js";
import { telegramClientOptions } from "../telegram.js";

export function encryptBotSecret(value: string): string {
  return aesGcmEncrypt(loadAesGcmKey("TELEGRAM_BOT_ENC_KEY"), value);
}

export function decryptBotSecret(value: string): string {
  return aesGcmDecrypt(loadAesGcmKey("TELEGRAM_BOT_ENC_KEY"), value, "Stored Telegram bot credential is malformed.");
}

export function projectTelegramApi(token: string): Api {
  // Longer than getUpdates' 25-second long poll. Reuses the existing
  // notification bot's classic HTTP proxy agent configuration.
  return new Api(token, { ...telegramClientOptions(), timeoutSeconds: 45 });
}
