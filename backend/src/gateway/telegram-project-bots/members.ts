import type { Knex } from "knex";
import { nowIso } from "../../shared/dates.js";
import type { TelegramMentionMessage } from "./protocol.js";

export interface MentionedMember { userId: string; telegramId: string; username: string | null; resolution?: "manual" | "linked" | "owner" }

export function messageMentions(message: TelegramMentionMessage) {
  return [
    ...message.telegramIds.map((id) => ({ key: id, label: `Telegram ID ${id}`, username: null as string | null })),
    ...message.usernames.map((name) => ({ key: `username:${name}`, label: `@${name}`, username: name }))
  ];
}

export function activeProjectUsers(db: Knex, projectId: string, ownerUserId: string | null) {
  return db("users as u").where("u.status", "active")
    .where((q) => q.where("u.id", ownerUserId).orWhereIn("u.id",
      db("project_members").select("user_id").where({ project_id: projectId, status: "active" })));
}

export async function rememberChatMentions(db: Knex, botId: string, message: TelegramMentionMessage): Promise<void> {
  const mentions = messageMentions(message);
  if (!mentions.length) return;
  await db("telegram_chat_mentions").insert(mentions.map((m) => ({ bot_id: botId, chat_id: message.chatId,
    mention_key: m.key, label: m.label, last_seen_at: nowIso() })))
    .onConflict(["bot_id", "chat_id", "mention_key"]).merge(["label", "last_seen_at"]);
}

export async function mentionedProjectMembers(db: Knex, projectId: string, ownerUserId: string | null,
  message: TelegramMentionMessage, botId: string): Promise<MentionedMember[]> {
  const mentions = messageMentions(message);
  if (!mentions.length || !ownerUserId) return [];
  const users = await activeProjectUsers(db, projectId, ownerUserId).select("u.id");
  const allowed = new Set(users.map((u) => String(u.id)));
  if (!allowed.has(ownerUserId)) return [];
  const manual = await db("telegram_chat_mentions").where({ bot_id: botId, chat_id: message.chatId }).whereIn("mention_key", mentions.map((m) => m.key));
  const identities = await db("telegram_identities").whereIn("user_id", [...allowed]);
  return mentions.map((mention) => {
    const mapped = manual.find((m) => m.mention_key === mention.key);
    if (mapped?.user_id && allowed.has(String(mapped.user_id))) return { userId: String(mapped.user_id), telegramId: mention.key, username: mention.username, resolution: "manual" };
    if (mapped?.user_id) return { userId: ownerUserId, telegramId: mention.key, username: mention.username, resolution: "owner" };
    const linked = identities.filter((i) => mention.username ? String(i.username ?? "").toLowerCase() === mention.username : String(i.telegram_id) === mention.key);
    if (linked.length === 1) return { userId: String(linked[0].user_id), telegramId: String(linked[0].telegram_id), username: mention.username, resolution: "linked" };
    return { userId: ownerUserId, telegramId: mention.key, username: mention.username, resolution: "owner" };
  });
}

// Multiple distinct mentions are deliberately conservative, even if the AI
// picks just one of them. The model never decides who belongs to the project.
export function telegramAssignee(message: TelegramMentionMessage, members: MentionedMember[], ownerUserId: string): string {
  return messageMentions(message).length === 1 && members.length === 1 ? members[0].userId : ownerUserId;
}
