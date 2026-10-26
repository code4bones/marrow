import type { Knex } from "knex";
import * as z from "zod/v4";
import { nowIso } from "../../shared/dates.js";
import type { Row } from "../pg-tool-service/types.js";

const person = z.object({ id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), is_bot: z.boolean().optional(),
  username: z.string().regex(/^[a-zA-Z0-9_]{1,32}$/).optional(), first_name: z.string().max(256).optional(), last_name: z.string().max(256).optional() });
function object(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }

// Observe available user identities, never hidden-forward display names or
// anonymous sender_chat IDs. This does not make an author the task's assignee.
export async function rememberChatPeople(db: Knex, botId: string, update: Row): Promise<void> {
  const message = object(update.message ?? update.channel_post ?? update.edited_message ?? update.edited_channel_post);
  const membership = object(update.chat_member ?? update.my_chat_member ?? update.chat_join_request);
  const chat = object(message.chat ?? membership.chat);
  if (!Number.isSafeInteger(chat.id) || !["group", "supergroup", "channel"].includes(String(chat.type)) ||
      !await db("project_telegram_chats").where({ bot_id: botId, chat_id: String(chat.id) }).first()) return;
  const people = new Map<string, Row>();
  const add = (value: unknown, source: string) => {
    const parsed = person.safeParse(value);
    if (!parsed.success || parsed.data.is_bot) return;
    const p = parsed.data, username = p.username?.toLowerCase() ?? null;
    const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
    const label = name ? `${name}${username ? ` (@${username})` : ""}` : username ? `@${username}` : `Telegram ID ${p.id}`;
    if (people.get(String(p.id))?.source_type === "sender") return;
    people.set(String(p.id), { bot_id: botId, chat_id: String(chat.id), mention_key: String(p.id),
      username, label, source_type: source, last_seen_at: nowIso() });
  };
  const names = new Set<string>();
  const inspect = (msg: Row, source: string) => {
    add(msg.from, source);
    const text = typeof msg.text === "string" ? msg.text : typeof msg.caption === "string" ? msg.caption : "";
    const entities = msg.text !== undefined ? msg.entities : msg.caption_entities;
    if (Array.isArray(entities)) for (const e of entities.slice(0, 1000)) {
      const part = object(e);
      if (part.type === "text_mention") add(part.user, "mention");
      if (part.type === "mention" && Number.isInteger(part.offset) && Number.isInteger(part.length)) {
        const name = text.slice(Number(part.offset), Number(part.offset) + Number(part.length));
        if (/^@[a-zA-Z0-9_]{1,32}$/.test(name)) names.add(name.slice(1).toLowerCase());
      }
    }
    add(object(msg.forward_origin).sender_user ?? msg.forward_from, "forward");
    if (Array.isArray(msg.new_chat_members)) for (const p of msg.new_chat_members.slice(0, 1000)) add(p, "member");
    add(msg.left_chat_member, "member");
  };
  inspect(message, "sender");
  inspect(object(message.reply_to_message), "reply");
  inspect(object(message.pinned_message), "reply");
  add(object(object(message.external_reply).origin).sender_user, "forward");
  add(membership.from, "member"); add(object(membership.new_chat_member).user, "member");
  // Rich messages have structured user/name mentions. Bound traversal avoids
  // letting arbitrary depth/size in an update monopolize the receiver.
  let visited = 0;
  const rich = (value: unknown, depth: number) => {
    if (++visited > 3000 || depth > 20) return;
    if (Array.isArray(value)) { for (const v of value.slice(0, 1000)) rich(v, depth + 1); return; }
    const part = object(value);
    if (part.type === "text_mention") add(part.user, "mention");
    if (part.type === "mention" && typeof part.username === "string" && /^[a-zA-Z0-9_]{1,32}$/.test(part.username)) names.add(part.username.toLowerCase());
    for (const v of Object.values(part)) if (typeof v === "object" && v !== null) rich(v, depth + 1);
  };
  rich(message.rich_message, 0);
  if (people.size) await db("telegram_chat_mentions").insert([...people.values()])
    .onConflict(["bot_id", "chat_id", "mention_key"]).merge(["username", "label", "source_type", "last_seen_at"]);
  if (names.size) await db("telegram_chat_mentions").insert([...names].map((name) => ({ bot_id: botId, chat_id: String(chat.id),
    mention_key: `username:${name}`, label: `@${name}`, source_type: "mention", last_seen_at: nowIso() })))
    .onConflict(["bot_id", "chat_id", "mention_key"]).merge(["last_seen_at"]);
}
