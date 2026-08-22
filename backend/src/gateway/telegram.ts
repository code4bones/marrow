import { Api, type ApiClientOptions } from "grammy";
import { HttpsProxyAgent } from "https-proxy-agent";
import type { Knex } from "knex";
import { createActorLabelsFacade } from "./actor-labels.js";
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
  recordTitle?: string | null;
  actorClientId?: string | null;
  projectId?: string | null;
}

// One glance icon + short Russian label per event kind -- matches
// eventTypeForStatus's actual output strings (formatters/events.ts) plus
// the assignment/record types the mixins emit directly. Falls back to the
// raw event type for anything not in this list rather than needing it kept
// in lockstep with every new event type.
const EVENT_LABELS: Record<string, [icon: string, label: string]> = {
  "task.created": ["🆕", "Новая задача"],
  "task.assigned": ["📌", "Назначена задача"],
  "task.started": ["▶️", "Задача взята в работу"],
  "task.completed": ["✅", "Задача завершена"],
  "task.blocked": ["🚫", "Задача заблокирована"],
  "task.cancelled": ["❌", "Задача отменена"],
  "task.status_changed": ["🔄", "Статус задачи изменён"],
  "decision.recorded": ["🆕", "Новое решение"],
  "decision.assigned": ["📌", "Назначено решение"],
  "decision.status_changed": ["🔄", "Статус решения изменён"],
  "decision.archived": ["🗄️", "Решение архивировано"]
};

function eventHeading(type: string): string {
  const [icon, label] = EVENT_LABELS[type] ?? ["🔔", type];
  return `${icon} ${label}`;
}

function marrowWebUrl(): string | null {
  const explicit = process.env.MARROW_WEB_URL?.trim().replace(/\/+$/, "");
  if (explicit) {
    return explicit;
  }
  // PROJECT_MEMORY_PUBLIC_URL, when set, is the API origin (includes /api
  // -- see githubRedirectUri()/telegramRedirectUri() in http-server.ts) not
  // the web app's own origin, but stripping that suffix recovers it for
  // deployments that never bothered with a separate MARROW_WEB_URL.
  const apiUrl = process.env.PROJECT_MEMORY_PUBLIC_URL?.trim().replace(/\/+$/, "");
  return apiUrl ? apiUrl.replace(/\/api$/, "") : null;
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
    const cell = (text: string, isHeader = false) => ({ text, is_header: isHeader ? (true as const) : undefined, align: "left" as const, valign: "middle" as const });
    const rows: ReturnType<typeof cell>[][] = [];

    let projectSlug: string | null = null;
    if (input.projectId) {
      const project = await db("projects").where({ id: input.projectId }).select("slug", "title").first();
      projectSlug = project ? String(project.slug) : null;
      // T-MEMORY-106: the message centered event type + record title but
      // dropped which project it was even in -- the slug (visible in the
      // "Открыть в Marrow" link below) is not the same thing as the
      // project's own display title, and a user in several projects can't
      // tell them apart from the slug alone.
      if (project?.title) {
        rows.push([cell("Проект", true), cell(String(project.title))]);
      }
    }
    if (input.recordTitle) {
      rows.push([cell("Задача", true), cell(input.recordTitle)]);
    }
    if (input.relatedId) {
      rows.push([cell("ID", true), cell(input.relatedId)]);
    }
    if (input.actorClientId) {
      const [actor] = await createActorLabelsFacade(db).resolveLabels([input.actorClientId]);
      if (actor?.label) {
        rows.push([cell("Кем", true), cell(actor.label)]);
      }
    }
    const webUrl = marrowWebUrl();
    const linkUrl = webUrl && projectSlug ? `${webUrl}/projects/${projectSlug}` : webUrl;

    const blocks = [
      { type: "heading" as const, size: 3 as const, text: eventHeading(input.type) },
      ...(input.body ? [{ type: "paragraph" as const, text: input.body }] : []),
      ...(rows.length > 0 ? [{ type: "table" as const, cells: rows, is_bordered: true as const }] : []),
      ...(linkUrl ? [{ type: "paragraph" as const, text: { type: "url" as const, text: "Открыть в Marrow →", url: linkUrl } }] : [])
    ];
    await api.sendRichMessage(String(identity.telegram_id), { blocks });
  } catch (error) {
    logger?.warn({ error: error instanceof Error ? error.message : String(error), targetUserId }, "telegram notify failed");
  }
}
