import { Api, type ApiClientOptions } from "grammy";
import { HttpsProxyAgent } from "https-proxy-agent";
import type { Knex } from "knex";
import type { AppLogger } from "../shared/logging/logger.js";

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
