import { createHash, randomUUID } from "node:crypto";
import type { InputRichMessage } from "grammy/types";
import type { Knex } from "knex";
import { nowIso } from "../../shared/dates.js";
import type { Row } from "../pg-tool-service/types.js";

function richText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(richText).join("");
  if (value && typeof value === "object") return richText((value as Row).text);
  return "";
}
function fingerprint(text: string): string {
  return createHash("sha256").update(text.normalize("NFC").replace(/\s/gu, "")).digest("hex");
}
function richBody(value: unknown): string {
  const blocks = (value as Row | undefined)?.blocks;
  return Array.isArray(blocks) ? blocks.map((b) => richText((b as Row).text)).join("\n") : "";
}

// Persist intent BEFORE remote I/O: a channel update can race the API response.
// No visible marker or copy of message content is needed. A successful send's
// Telegram identity remains known even after bot removal or another handoff.
export async function sendRememberedTelegramReply<T extends { message_id: number }>(db: Knex, botId: string,
  chatId: string, rich: InputRichMessage, send: () => Promise<T>, taskId?: string): Promise<T> {
  const id = randomUUID();
  await db("telegram_outgoing_messages").insert({ id, bot_id: botId, chat_id: chatId,
    fingerprint: fingerprint(richBody(rich)), ...(taskId ? { task_id: taskId } : {}), created_at: nowIso() });
  const result = await send();
  if (Number.isSafeInteger(result.message_id) && result.message_id > 0)
    await db("telegram_outgoing_messages").where({ id }).update({ message_id: String(result.message_id) });
  return result;
}

export async function isOutgoingTelegramUpdate(db: Knex, update: Row): Promise<boolean> {
  const msg = (update.message ?? update.channel_post ?? update.edited_message ?? update.edited_channel_post) as Row | undefined;
  if (!msg || !msg.chat || typeof msg.chat !== "object") return false;
  const chatId = String((msg.chat as Row).id);
  if (await db("telegram_outgoing_messages").where({ chat_id: chatId, message_id: String(msg.message_id) }).first("id")) return true;
  const origin = msg.forward_origin as Row | undefined;
  const originChat = origin?.type === "channel" ? origin.chat as Row : msg.forward_from_chat as Row | undefined;
  const originId = origin?.type === "channel" ? origin.message_id : msg.forward_from_message_id;
  if (originChat && originId && await db("telegram_outgoing_messages").where({ chat_id: String(originChat.id), message_id: String(originId) }).first("id")) return true;
  const from = msg.from as Row | undefined;
  // Do not reject genuine user replies or copied requests by text. The short
  // fingerprint guard only fences anonymous/channel sends and auto-forwards.
  if (from && !from.is_bot && !msg.sender_chat && !msg.is_automatic_forward) return false;
  const text = typeof msg.text === "string" ? msg.text : typeof msg.caption === "string" ? msg.caption : richBody(msg.rich_message);
  if (!text) return false;
  const chats = [...new Set([chatId, ...(originChat ? [String(originChat.id)] : [])])];
  return Boolean(await db("telegram_outgoing_messages").whereIn("chat_id", chats)
    .where({ fingerprint: fingerprint(text) }).andWhere((q) => q.whereNull("message_id")
      .orWhere("created_at", ">", new Date(Date.now() - 10 * 60_000).toISOString())).first("id"));
}
