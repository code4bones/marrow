import type { RichText } from "grammy/types";
import { telegramParticipants, participantList, telegramPeopleText } from "./participant-references.js";
import type { Api } from "grammy";
import type { Knex } from "knex";
import type { AppLogger } from "../../shared/logging/logger.js";
import type { Row } from "../pg-tool-service/types.js";
import type { TelegramMentionMessage } from "./protocol.js";
import { activeProjectUsers } from "./members.js";
import { chatRecipients } from "./recipients.js";
import { telegramBotTags } from "./tags.js";
import { telegramRequest } from "./request.js";

export interface TelegramHashReply {
  chatId: string; messageId: number; messageThreadId?: number;
  projectTitle: string; lines: RichText[];
}

export async function hashReply(db: Knex, bot: Row, project: Row, message: TelegramMentionMessage): Promise<TelegramHashReply> {
  const people = chatRecipients(await db("telegram_chat_mentions").where({ bot_id: bot.id, chat_id: message.chatId }));
  const members = await activeProjectUsers(db, String(project.id), project.owner_user_id ? String(project.owner_user_id) : null).select("u.id", "u.email");
  const users = new Map(members.map((m) => [String(m.id), String(m.email)]));
  const participants = await telegramParticipants(db, String(bot.id), message.chatId, members.map((m) => String(m.id)));
  const lines = telegramBotTags(bot.filter_tags).map((tag) => {
    const routes = people.filter((p) => (p.user_id || p.mapping_conflict) && telegramBotTags(p.assignment_tags).includes(tag));
    if (!routes.length) return `#${tag} → по упоминаниям; иначе владелец проекта`;
    if (routes.some((p) => p.mapping_conflict || !users.has(String(p.user_id)))) return `#${tag} → владелец проекта (сопоставление требует уточнения)`;
    const ids = [...new Set(routes.map((p) => String(p.user_id)))];
    return [`#${tag} → `, telegramPeopleText(participantList(participants, ids))];
  });
  return { chatId: message.chatId, messageId: Number(message.messageId), projectTitle: String(project.title), lines,
    ...(message.messageThreadId !== undefined ? { messageThreadId: message.messageThreadId } : {}) };
}

export async function sendHashReply(api: Pick<Api, "sendRichMessage">, reply: TelegramHashReply, botId: string, signal?: AbortSignal, logger?: AppLogger): Promise<void> {
  if (signal?.aborted) return;
  try {
    await telegramRequest(signal, (s) => api.sendRichMessage(reply.chatId, { blocks: [
      { type: "heading", size: 3, text: "Теги и исполнители" },
      { type: "paragraph", text: `Проект: ${reply.projectTitle}` },
      ...reply.lines.map((line) => ({ type: "paragraph" as const, text: line }))
    ] }, { reply_parameters: { message_id: reply.messageId, allow_sending_without_reply: true },
      ...(reply.messageThreadId !== undefined ? { message_thread_id: reply.messageThreadId } : {}) }, s));
  } catch { if (!signal?.aborted) logger?.warn({ botId, code: "TELEGRAM_HASH_REPLY_FAILED" }, "Telegram tag command reply failed"); }
}

export async function registerProjectBotCommands(api: Pick<Api, "setMyCommands">, botId: string, signal: AbortSignal, logger?: AppLogger): Promise<boolean> {
  try {
    await telegramRequest(signal, (s) => api.setMyCommands([{ command: "hash", description: "Теги и назначенные участники этой группы" }], { scope: { type: "all_group_chats" } }, s));
    return true;
  } catch {
    if (!signal.aborted) logger?.warn({ botId, code: "TELEGRAM_COMMAND_MENU_FAILED" }, "Telegram command menu registration deferred");
    return false;
  }
}
