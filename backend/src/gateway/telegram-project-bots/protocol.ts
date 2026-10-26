import * as z from "zod/v4";
import { AppError } from "../../shared/errors.js";
import { normalizeTelegramTag } from "./tags.js";

const user = z.object({ id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), is_bot: z.boolean().optional() });
const entity = z.object({ type: z.string(), offset: z.number().int().nonnegative(), length: z.number().int().positive(), user: user.optional() });
const message = z.object({
  message_id: z.number().int().positive(),
  media_group_id: z.string().max(100).optional(),
  message_thread_id: z.number().int().positive().optional(),
  chat: z.object({ id: z.number().int().max(Number.MAX_SAFE_INTEGER).min(-Number.MAX_SAFE_INTEGER), type: z.string(), title: z.string().optional(), username: z.string().regex(/^[a-zA-Z0-9_]+$/).optional() }),
  from: user.optional(), text: z.string().max(16384).optional(), caption: z.string().max(16384).optional(),
  entities: z.array(entity).max(1000).optional(), caption_entities: z.array(entity).max(1000).optional()
});
const update = z.object({ update_id: z.number().int().nonnegative(), message: message.optional(), channel_post: message.optional() });

export interface TelegramMentionMessage {
  chatId: string;
  messageId: string;
  messageThreadId?: number;
  mediaGroupId?: string;
  chatTitle: string;
  text: string;
  url: string | null;
  telegramIds: string[];
  usernames: string[];
  tags: string[];
}

export function parseMentionMessage(raw: Buffer): TelegramMentionMessage | null {
  let json: unknown;
  try { json = JSON.parse(raw.toString("utf8")); }
  catch { throw new AppError("VALIDATION_ERROR", "Invalid Telegram update JSON."); }
  const parsed = update.safeParse(json);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid Telegram update.");
  const msg = parsed.data.message ?? parsed.data.channel_post;
  if (!msg || !["group", "supergroup", "channel"].includes(msg.chat.type) || msg.from?.is_bot) return null;
  const text = msg.text ?? msg.caption;
  if (!text?.trim()) return null;
  const entities = msg.text !== undefined ? msg.entities : msg.caption_entities;
  const telegramIds = new Set<string>();
  const usernames = new Set<string>();
  const tags = new Set<string>();
  for (const part of entities ?? []) {
    if (part.offset + part.length > text.length) continue;
    if (part.type === "text_mention" && part.user && !part.user.is_bot) telegramIds.add(String(part.user.id));
    if (part.type === "mention") {
      // Telegram offsets and JS slice both use UTF-16 code units.
      const name = text.slice(part.offset, part.offset + part.length);
      if (/^@[a-zA-Z0-9_]{1,32}$/.test(name)) usernames.add(name.slice(1).toLowerCase());
    }
    if (part.type === "hashtag") {
      const tag = text.slice(part.offset, part.offset + part.length);
      if (/^#[\p{L}\p{N}_]{1,64}$/u.test(tag)) tags.add(normalizeTelegramTag(tag));
    }
  }
  const chatId = String(msg.chat.id);
  const messageId = String(msg.message_id);
  const url = msg.chat.username ? `https://t.me/${msg.chat.username}/${messageId}`
    : chatId.startsWith("-100") ? `https://t.me/c/${chatId.slice(4)}/${messageId}` : null;
  return { chatId, messageId, ...(msg.message_thread_id !== undefined ? { messageThreadId: msg.message_thread_id } : {}),
    ...(msg.media_group_id ? { mediaGroupId: msg.media_group_id } : {}), chatTitle: msg.chat.title ?? chatId, text, url, telegramIds: [...telegramIds], usernames: [...usernames], tags: [...tags] };
}
