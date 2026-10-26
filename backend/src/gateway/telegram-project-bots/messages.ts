import type { Knex } from "knex";
import { dateStringOrNull } from "../pg-tool-service/formatters/common.js";
import type { Row } from "../pg-tool-service/types.js";

export const TELEGRAM_MESSAGE_HISTORY_LIMIT = 500;

function object(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function id(value: unknown): string | null { return typeof value === "number" && Number.isSafeInteger(value) ? String(value) : null; }
function json(value: unknown): unknown { return typeof value === "string" ? JSON.parse(value) : value; }

export function receivedMessageSnapshot(update: Row) {
  const msg = object(update.message ?? update.channel_post ?? update.edited_message ?? update.edited_channel_post);
  const chat = object(msg.chat);
  const chatId = id(chat.id), messageId = id(msg.message_id);
  const text = typeof msg.text === "string" ? msg.text : typeof msg.caption === "string" ? msg.caption : null;
  const kind = ["photo", "video", "document", "voice", "audio", "sticker", "animation", "rich_message"]
    .find((key) => msg[key] !== undefined) ?? (text !== null ? "text" : Object.keys(msg).length ? "service" : "unsupported");
  const username = typeof chat.username === "string" && /^[a-zA-Z0-9_]+$/.test(chat.username) ? chat.username : null;
  return {
    chat_id: chatId, chat_title: typeof chat.title === "string" ? chat.title : username ? `@${username}` : chatId,
    chat_type: typeof chat.type === "string" ? chat.type : "unknown", message_id: messageId, message_kind: kind,
    // Link commands are credentials, even when expired, malformed or sent
    // in a private/unbound chat. Never expose their key in diagnostics.
    text: text?.slice(0, 16384).replace(/(\/marrow_link(?:@[a-zA-Z0-9_]+)?\s+)[a-zA-Z0-9_-]+/gi, "$1[ключ скрыт]") ?? null,
    message_url: messageId && chatId ? username ? `https://t.me/${username}/${messageId}`
      : chatId.startsWith("-100") ? `https://t.me/c/${chatId.slice(4)}/${messageId}` : null : null,
    fromBot: object(msg.from).is_bot === true
  };
}

export function botMessageSelect(db: Knex, botId: string) {
  return db("telegram_bot_messages as m").leftJoin("telegram_message_inbox as i", "i.id", "m.inbox_id")
    .where("m.bot_id", botId).select("m.*", "i.status as pipeline_status", "i.result_reason", "i.classification", "i.classified_at", "i.processed_at", "i.last_error as pipeline_error");
}

export function botMessageOut(row: Row, detail = false) {
  const isPipeline = row.status === "queued" && row.pipeline_status;
  const status = isPipeline && row.pipeline_status !== "pending" ? String(row.pipeline_status) : String(row.status);
  const reason = isPipeline ? row.result_reason ?? row.reason : row.reason;
  const text = typeof row.text === "string" ? row.text : null;
  return {
    id: row.id, chatTitle: row.chat_title ?? row.chat_id ?? null, chatId: row.chat_id ?? null, chatType: row.chat_type,
    telegramMessageId: row.message_id ?? null, messageKind: row.message_kind, messageUrl: row.message_url ?? null,
    receivedAt: dateStringOrNull(row.received_at), classifiedAt: dateStringOrNull(row.classified_at), processedAt: dateStringOrNull(row.processed_at),
    status, reason: reason ?? null, lastError: row.pipeline_error ?? null, excerpt: text?.slice(0, 180) ?? null,
    ...(detail ? { text, matchedTags: json(row.matched_tags) ?? [], mentions: json(row.mentions) ?? [], classification: json(row.classification) ?? null } : {})
  };
}
