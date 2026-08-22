import { createHash, createHmac } from "node:crypto";
import { Api, type ApiClientOptions } from "grammy";
import { HttpsProxyAgent } from "https-proxy-agent";
import type { Knex } from "knex";
import { AppError } from "../shared/errors.js";
import type { AppLogger } from "../shared/logging/logger.js";

// T-MEMORY-093: bot token doubles as both the Bot API credential AND the
// Login Widget's HMAC secret -- Telegram's Login Widget has no separate
// client_id/secret concept the way GitHub OAuth does.
function botToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return token || null;
}

// grammY's Node build uses the `node-fetch` package as its default fetch
// implementation (see node_modules/grammy/out/shim.node.js), NOT native
// fetch/undici -- confirmed live: undici's ProxyAgent/dispatcher silently
// has no effect on node-fetch and requests just time out reaching
// api.telegram.org directly. node-fetch's RequestInit takes the classic
// Node `agent` option instead (http.Agent/https.Agent), which
// HttpsProxyAgent implements -- this is grammY's own documented approach
// for a Node proxy setup.
function clientOptions(): ApiClientOptions {
  const proxyUrl = process.env.TELEGRAM_BOT_PROXY?.trim();
  if (!proxyUrl) {
    return {};
  }
  const baseFetchConfig: Record<string, unknown> = { agent: new HttpsProxyAgent(proxyUrl) };
  return { baseFetchConfig: baseFetchConfig as ApiClientOptions["baseFetchConfig"] };
}

let cachedApi: Api | null = null;

// Lightweight, no polling -- just typed API calls (sendMessage, getMe).
// Memoized so notifyTelegram's per-event calls don't rebuild a ProxyAgent
// (and its own connection pool) on every single call.
export function createTelegramApi(): Api | null {
  const token = botToken();
  if (!token) {
    return null;
  }
  if (!cachedApi) {
    cachedApi = new Api(token, clientOptions());
  }
  return cachedApi;
}

export { clientOptions as telegramClientOptions, botToken as telegramBotToken };

// Telegram's documented Login Widget verification algorithm:
// https://core.telegram.org/widgets/login#checking-authorization
// secret = SHA256(bot_token); data-check-string = every field except `hash`,
// sorted by key, joined "key=value" with "\n"; hash must equal
// HMAC-SHA256(data-check-string, secret) in hex. auth_date freshness (24h)
// is Telegram's own recommendation, not enforced by the hash itself.
const AUTH_MAX_AGE_SECONDS = 24 * 60 * 60;

export interface TelegramLoginPayload {
  telegramId: string;
  username: string | null;
  firstName: string | null;
}

// Only these fields are ever part of Telegram's own signed payload -- the
// widget's data-auth-url can (and here does) carry additional query params
// of our own (intent, returnTo) that Telegram appends its fields alongside,
// not into. Including them in the data-check-string would make every real
// request fail verification.
const TELEGRAM_LOGIN_FIELDS = ["id", "first_name", "last_name", "username", "photo_url", "auth_date"] as const;

export function verifyTelegramLoginPayload(query: Record<string, string | undefined>, tokenOverride?: string): TelegramLoginPayload {
  const token = tokenOverride ?? botToken();
  if (!token) {
    throw new AppError("VALIDATION_ERROR", "TELEGRAM_BOT_TOKEN is not configured.");
  }
  const hash = query.hash;
  const rest: Record<string, string> = {};
  for (const key of TELEGRAM_LOGIN_FIELDS) {
    const value = query[key];
    if (value !== undefined) {
      rest[key] = value;
    }
  }
  if (!hash || !rest.id || !rest.auth_date) {
    throw new AppError("VALIDATION_ERROR", "Telegram login payload is missing required fields.");
  }
  const dataCheckString = Object.entries(rest)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHash("sha256").update(token).digest();
  const expectedHash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  if (expectedHash !== hash) {
    throw new AppError("VALIDATION_ERROR", "Telegram login payload failed signature verification.");
  }
  const authDate = Number(rest.auth_date);
  if (!Number.isFinite(authDate) || Date.now() / 1000 - authDate > AUTH_MAX_AGE_SECONDS) {
    throw new AppError("VALIDATION_ERROR", "Telegram login payload has expired. Please try again.");
  }
  return {
    telegramId: String(rest.id),
    username: rest.username ?? null,
    firstName: rest.first_name ?? null
  };
}

export interface TelegramNotifyInput {
  title: string;
  body?: string | null;
  relatedId?: string | null;
}

// T-MEMORY-093: fire-and-forget, same "a live-update side effect must never
// fail the mutation it's attached to" contract recordEventForProject's own
// gatewayEvents.publish call already follows right next to this one --
// never throws, logs on failure and returns.
export async function notifyTelegram(
  db: Knex,
  targetUserId: string,
  input: TelegramNotifyInput,
  logger?: AppLogger
): Promise<void> {
  const api = createTelegramApi();
  if (!api) {
    return;
  }
  try {
    const identity = await db("telegram_identities").where({ user_id: targetUserId }).first();
    if (!identity || !identity.chat_started_at) {
      return;
    }
    const text = [input.title, input.body, input.relatedId ? `(${input.relatedId})` : null]
      .filter((value): value is string => Boolean(value))
      .join("\n");
    await api.sendMessage(String(identity.telegram_id), text);
  } catch (error) {
    logger?.warn({ error: error instanceof Error ? error.message : String(error), targetUserId }, "telegram notify failed");
  }
}
