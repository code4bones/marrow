import { chatRecipients, recipientKeys } from "./recipients.js";
import { telegramBotTags } from "./tags.js";
import type { Row } from "../pg-tool-service/types.js";
import type { Knex } from "knex";
import { nowIso } from "../../shared/dates.js";
import type { TelegramMentionMessage } from "./protocol.js";

export interface MentionedMember { userId: string; telegramId: string; username: string | null; resolution?: "manual" | "linked" | "owner"; viaTag?: boolean }

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
    .onConflict(["bot_id", "chat_id", "mention_key"]).merge(["last_seen_at"]);
}

export async function mentionedProjectMembers(db: Knex, projectId: string, ownerUserId: string | null,
  message: TelegramMentionMessage, botId: string, configuredTags: unknown): Promise<MentionedMember[]> {
  const mentions = messageMentions(message);
  if (!ownerUserId) return [];
  const users = await activeProjectUsers(db, projectId, ownerUserId).select("u.id");
  const allowed = new Set(users.map((u) => String(u.id)));
  if (!allowed.has(ownerUserId)) return [];
  const manual = chatRecipients(await db("telegram_chat_mentions").where({ bot_id: botId, chat_id: message.chatId }));
  const filterTags = telegramBotTags(configuredTags);
  const routed = manual.filter((row) => (row.user_id || row.mapping_conflict) && telegramBotTags(row.assignment_tags)
    .some((tag) => filterTags.includes(tag) && message.tags.includes(tag)));
  if (routed.length) {
    if (routed.some((row) => row.mapping_conflict || !allowed.has(String(row.user_id)))) return [{ userId: ownerUserId, telegramId: "owner", username: null, resolution: "owner" }];
    return [...new Set(routed.map((row) => String(row.user_id)))].map((userId) => ({ userId, telegramId: `tag:${userId}`, username: null, resolution: "manual", viaTag: true }));
  }
  if (!mentions.length) return [{ userId: ownerUserId, telegramId: "owner", username: null, resolution: "owner" }];
  const identities = await db("telegram_identities").whereIn("user_id", [...allowed]);
  return mentions.map((mention) => resolveTelegramRecipient(mention.key, mention.username, manual, identities, allowed, ownerUserId));
}

export function resolveTelegramRecipient(key: string, username: string | null, observed: Row[], identities: Row[], allowed: Set<string>, ownerId: string): MentionedMember {
  const owner = (): MentionedMember => ({ userId: ownerId, telegramId: key, username, resolution: "owner" });
  const direct = observed.find((m) => recipientKeys(m).includes(key));
  if (direct?.mapping_conflict) return owner();
  const aliases = username ? observed.filter((m) => m.username === username) : [];
  // An explicit mapping on this literal @mention wins. Otherwise require
  // one observed Telegram identity for a username, never guess between them.
  const mapped = direct?.user_id ? direct : aliases.length === 1 ? aliases[0] : direct;
  if (mapped?.mapping_conflict) return owner();
  if (mapped?.user_id) return allowed.has(String(mapped.user_id))
    ? { userId: String(mapped.user_id), telegramId: key, username, resolution: "manual" } : owner();
  if (aliases.length > 1) return owner();
  const telegramId = aliases.length === 1 ? String(aliases[0].mention_key) : username ? null : key;
  const linked = identities.filter((i) => telegramId ? String(i.telegram_id) === telegramId : String(i.telegram_username ?? "").toLowerCase() === username);
  if (linked.length === 1) return { userId: String(linked[0].user_id), telegramId: String(linked[0].telegram_id), username, resolution: "linked" };
  return owner();
}

// Unresolved addresses remain conservative. The classifier selects the actual
// performers from known mentions; observers do not become assignees by presence.
export function telegramAssignees(members: MentionedMember[], ownerUserId: string, candidateIds: string[]): string[] {
  const routed = members.filter((member) => member.viaTag);
  if (routed.length) return [...new Set(routed.map((member) => member.userId))];
  if (members.some((member) => member.resolution === "owner")) return [ownerUserId];
  const selected = members.filter((member) => candidateIds.includes(member.telegramId));
  return selected.length ? [...new Set(selected.map((member) => member.userId))] : [ownerUserId];
}
