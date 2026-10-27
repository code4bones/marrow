import { randomUUID } from "node:crypto";
import type { Knex } from "knex";
import { nowIso } from "../../shared/dates.js";
import { AppError } from "../../shared/errors.js";
import type { Row } from "../pg-tool-service/types.js";
import type { TelegramMentionMessage } from "./protocol.js";
import { matchesTelegramTags, normalizeTelegramTag, telegramBotTags } from "./tags.js";

// Older attachment_added entries have no normalized inbox payload. Recover
// only that known human-message path, preserving IDs and retained file metadata.
function recoveredMessage(journal: Row, files: Row[]): TelegramMentionMessage | null {
  if (journal.reason !== "attachment_added" || !["group", "supergroup", "channel"].includes(String(journal.chat_type)) ||
      !journal.chat_id || !journal.message_id || typeof journal.text !== "string" || !journal.text.trim()) return null;
  const file = files[0];
  return { chatId: String(journal.chat_id), messageId: String(journal.message_id), chatTitle: String(journal.chat_title ?? journal.chat_id),
    text: journal.text, url: typeof journal.message_url === "string" ? journal.message_url : null,
    telegramIds: [], usernames: [...new Set([...journal.text.matchAll(/@([a-zA-Z0-9_]{1,32})\b/g)].map((m) => m[1].toLowerCase()))],
    tags: [...new Set([...journal.text.matchAll(/#[\p{L}\p{N}_]{1,64}/gu)].map((m) => normalizeTelegramTag(m[0])))],
    ...(file?.media_group_id ? { mediaGroupId: String(file.media_group_id) } : {}),
    ...(file?.message_thread_id ? { messageThreadId: Number(file.message_thread_id) } : {}) };
}

export async function telegramMessageRetryState(db: Knex, project: Row, bot: Row, journal: Row, inbox: Row | null | undefined) {
  const key = { project_id: project.id, chat_id: journal.chat_id };
  const files = await db("telegram_message_files").where({ ...key, message_id: journal.message_id });
  const group = files[0]?.media_group_id ? await db("telegram_media_groups").where({ ...key, media_group_id: files[0].media_group_id }).first() : null;
  const source = await db("telegram_task_sources").where({ ...key, message_id: inbox?.message_id ?? group?.message_id ?? journal.message_id }).first();
  const message: TelegramMentionMessage | null = inbox
    ? typeof inbox.payload === "string" ? JSON.parse(inbox.payload) : inbox.payload
    : recoveredMessage(journal, files);
  const bound = await db("project_telegram_chats").where({ bot_id: bot.id, chat_id: journal.chat_id }).first();
  const eligible = Boolean(message && !inbox?.manual_override && journal.reason !== "bot_sender" &&
    bot.enabled && project.status === "active" && bound && matchesTelegramTags(bot.filter_tags, message.tags));
  return { source, message, files, eligible, canRetry: Boolean(eligible && !source && (!inbox || ["ignored", "failed"].includes(String(inbox.status)))) };
}

export async function queueTelegramMessageRetry(db: Knex, project: Row, botId: string, journalId: string) {
  return db.transaction(async (trx) => {
    const currentProject = await trx("projects").where({ id: project.id, status: "active" }).forUpdate().first();
    const bot = await trx("project_telegram_bots").where({ id: botId, project_id: project.id, enabled: true }).forUpdate().first();
    const journal = await trx("telegram_bot_messages").where({ id: journalId, bot_id: botId }).forUpdate().first();
    if (!currentProject || !bot || !journal || currentProject.owner_user_id !== project.ownerUserId)
      throw new AppError("VALIDATION_ERROR", "Activate the bot and confirm the project settings first.");
    let inbox = journal.inbox_id ? await trx("telegram_message_inbox").where({ id: journal.inbox_id, bot_id: botId, project_id: project.id }).forUpdate().first() : null;
    const state = await telegramMessageRetryState(trx, currentProject, bot, journal, inbox);
    if (!state.eligible || !state.message) throw new AppError("VALIDATION_ERROR", "This message cannot be retried: it must be a tagged human message in a bound chat.");
    if (state.source) {
      if (!state.source.task_id) throw new AppError("VALIDATION_ERROR", "This source was already imported; its task was deleted.");
      return { queued: false, taskId: String(state.source.task_id), changed: false };
    }
    const now = nowIso();
    if (!inbox) {
      const message = state.message;
      const [inserted] = await trx("telegram_message_inbox").insert({ id: randomUUID(), bot_id: botId, project_id: project.id,
        chat_id: message.chatId, message_id: message.messageId, payload: JSON.stringify(message), status: "pending", attempts: 0, available_at: now, received_at: journal.received_at })
        .onConflict(["project_id", "chat_id", "message_id"]).ignore().returning("*");
      inbox = inserted ?? await trx("telegram_message_inbox").where({ project_id: project.id, chat_id: message.chatId, message_id: message.messageId }).forUpdate().first();
      // Correct only this swallowed reply's files. Keep bytes/artifact IDs;
      // invalidate any old download lease before the new task can own them.
      const files = await trx("telegram_message_files").where({ project_id: project.id, chat_id: message.chatId })
        .andWhere((q) => { q.where("message_id", message.messageId); if (message.mediaGroupId) q.orWhere("media_group_id", message.mediaGroupId); }).forUpdate();
      for (const file of files) {
        if (file.artifact_id && file.task_id) await trx("links").where({ project_id: project.id, from_id: file.artifact_id, to_id: file.task_id, relation: "attached_to" }).del();
        await trx("telegram_message_files").where({ id: file.id }).update({ task_id: null, status: "waiting", attempts: Number(file.attempts) + 1, locked_until: null, last_error: null });
      }
    } else if (["pending", "processing"].includes(String(inbox.status))) {
      return { queued: true, taskId: null, changed: false };
    } else {
      await trx("telegram_message_inbox").where({ id: inbox.id }).update({ status: "pending", attempts: Number(inbox.attempts) + 1,
        available_at: now, locked_until: null, last_error: null, classification: null, classified_at: null, classified_owner_id: null, processed_at: null, result_reason: null });
    }
    await trx("telegram_bot_messages").where({ id: journal.id }).update({ status: "queued", reason: "queued", inbox_id: inbox.id,
      matched_tags: JSON.stringify(state.message.tags.filter((tag) => telegramBotTags(bot.filter_tags).includes(tag))) });
    return { queued: true, taskId: null, changed: true };
  });
}
