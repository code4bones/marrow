import type { Knex } from "knex";
import type { RichText } from "grammy/types";
import * as z from "zod/v4";
import { chatRecipients } from "./recipients.js";

export const telegramPersonSchema = z.object({
  telegramId: z.string().regex(/^[0-9]+$/).nullable(),
  username: z.string().regex(/^[a-zA-Z0-9_]+$/).nullable(), label: z.string()
});
export type TelegramPerson = z.infer<typeof telegramPersonSchema>;
export type TelegramParticipants = Record<string, TelegramPerson[]>;

// Scope manual identities to the source chat. Keep the last known reference
// on the task source so later handoffs still identify earlier performers.
export async function telegramParticipants(db: Knex, botId: string, chatId: string, userIds: string[], saved: unknown = {}): Promise<TelegramParticipants> {
  let data: unknown = saved;
  try { if (typeof data === "string") data = JSON.parse(data); } catch { data = {}; }
  const parsed = z.record(z.string(), z.array(telegramPersonSchema)).safeParse(data);
  const result = parsed.success ? parsed.data : {};
  const people = chatRecipients(await db("telegram_chat_mentions").where({ bot_id: botId, chat_id: chatId }));
  const linked = userIds.length ? await db("telegram_identities").whereIn("user_id", userIds) : [];
  for (const id of [...new Set(userIds)]) {
    const mapped = people.filter((p) => p.user_id === id && !p.mapping_conflict).map((p): TelegramPerson => ({
      telegramId: /^[0-9]+$/.test(String(p.mention_key)) ? String(p.mention_key) : null,
      username: /^[a-zA-Z0-9_]+$/.test(String(p.username ?? "")) ? String(p.username) :
        /^username:[a-zA-Z0-9_]+$/.test(String(p.mention_key)) ? String(p.mention_key).slice(9) : null,
      label: String(p.label ?? "Участник Telegram")
    })).filter((p) => p.telegramId || p.username);
    const identity = linked.find((p) => p.user_id === id);
    if (mapped.length) result[id] = mapped;
    else if (identity) result[id] = [{ telegramId: String(identity.telegram_id),
      username: identity.telegram_username ? String(identity.telegram_username) : null,
      label: String(identity.telegram_first_name ?? "Участник Telegram") }];
  }
  return result;
}

export function telegramPeopleText(people: TelegramPerson[]): RichText {
  if (!people.length) return "участник без Telegram-привязки";
  const unique = [...new Map(people.map((p) => [p.telegramId ?? p.username, p])).values()];
  return unique.flatMap((p, i): RichText[] => [ ...(i ? [", "] : []), p.username
    ? { type: "mention", username: p.username, text: `@${p.username}` }
    : p.telegramId ? { type: "url", url: `tg://user?id=${p.telegramId}`, text: p.label }
    : "участник без Telegram-привязки" ]);
}

export function participantList(participants: TelegramParticipants, ids: string[]): TelegramPerson[] {
  return ids.flatMap((id) => participants[id] ?? [{ telegramId: null, username: null, label: "участник без Telegram-привязки" }]);
}
