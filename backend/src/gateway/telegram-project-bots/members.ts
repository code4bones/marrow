import type { Knex } from "knex";
import type { TelegramMentionMessage } from "./protocol.js";

export interface MentionedMember { userId: string; telegramId: string; username: string | null }

export async function mentionedProjectMembers(db: Knex, projectId: string, ownerUserId: string | null, message: TelegramMentionMessage): Promise<MentionedMember[]> {
  if (!message.telegramIds.length && !message.usernames.length) return [];
  const identities = await db("telegram_identities as ti").join("users as u", "u.id", "ti.user_id")
    .where("u.status", "active")
    .where((q) => q.where("ti.user_id", ownerUserId).orWhereIn("ti.user_id",
      db("project_members").select("user_id").where({ project_id: projectId, status: "active" })))
    .where((q) => {
      q.whereIn("ti.telegram_id", message.telegramIds);
      if (message.usernames.length) q.orWhereRaw(`lower(ti.username) in (${message.usernames.map(() => "?").join(",")})`, message.usernames);
    })
    .select("ti.user_id", "ti.telegram_id", "ti.username");
  // A stale/ambiguous username is never enough to select several accounts.
  const names = new Map<string, number>();
  for (const row of identities) if (row.username) {
    const name = String(row.username).toLowerCase(); names.set(name, (names.get(name) ?? 0) + 1);
  }
  return identities.filter((row) => message.telegramIds.includes(String(row.telegram_id)) || (row.username && names.get(String(row.username).toLowerCase()) === 1))
    .map((row) => ({ userId: String(row.user_id), telegramId: String(row.telegram_id), username: row.username ? String(row.username) : null }));
}
