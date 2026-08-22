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
  type: string;
  title: string;
  body?: string | null;
  relatedId?: string | null;
}

// One glance icon per event kind -- matches eventTypeForStatus's actual
// output strings (formatters/events.ts) plus the assignment/record types
// the mixins emit directly, suffix-matched so new statuses degrade to the
// generic bell instead of needing this list kept in lockstep.
function iconForEventType(type: string): string {
  if (type.endsWith(".assigned")) return "📌";
  if (type.endsWith(".completed")) return "✅";
  if (type.endsWith(".started")) return "▶️";
  if (type.endsWith(".blocked")) return "🚫";
  if (type.endsWith(".cancelled")) return "❌";
  if (type.endsWith(".archived")) return "🗄️";
  if (type.endsWith(".created") || type.endsWith(".recorded")) return "🆕";
  return "🔔";
}

// T-MEMORY-093: fire-and-forget, same "a live-update side effect must never
// fail the mutation it's attached to" contract recordEventForProject's own
// gatewayEvents.publish call already follows right next to this one --
// never throws, logs on failure and returns.
//
// Built from explicit `blocks` rather than the `markdown` field -- a plain
// string in a block is literal text with no parsing step at all, so
// title/body (arbitrary user content) need no escaping and can't produce
// stray formatting characters the way a hand-built markdown string can
// (confirmed live: the markdown version showed leftover ** artifacts).
// The little ID/event-type table is exactly what Rich Messages' table
// block is for -- the owner specifically asked for it once they saw it
// was available.
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
    const icon = iconForEventType(input.type);
    const cell = (text: string, isHeader = false) => ({ text, is_header: isHeader ? (true as const) : undefined, align: "left" as const, valign: "middle" as const });
    const rows: ReturnType<typeof cell>[][] = [];
    if (input.relatedId) {
      rows.push([cell("ID", true), cell(input.relatedId)]);
    }
    rows.push([cell("Событие", true), cell(input.type)]);

    const blocks = [
      { type: "heading" as const, size: 3 as const, text: `${icon} ${input.title}` },
      ...(input.body ? [{ type: "paragraph" as const, text: input.body }] : []),
      { type: "table" as const, cells: rows, is_bordered: true as const }
    ];
    await api.sendRichMessage(String(identity.telegram_id), { blocks });
  } catch (error) {
    logger?.warn({ error: error instanceof Error ? error.message : String(error), targetUserId }, "telegram notify failed");
  }
}
