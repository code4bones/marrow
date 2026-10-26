import { rememberTelegramFiles } from "./media.js";
import { isOutgoingTelegramUpdate } from "./outgoing.js";
import { hashReply, type TelegramHashReply } from "./hash-command.js";
import { rememberChatPeople } from "./people.js";
import { createHash, randomUUID } from "node:crypto";
import type { Knex } from "knex";
import { nowIso } from "../../shared/dates.js";
import { AppError } from "../../shared/errors.js";
import type { Row } from "../pg-tool-service/types.js";
import { parseMentionMessage, type TelegramMentionMessage } from "./protocol.js";
import { mentionedProjectMembers, rememberChatMentions } from "./members.js";
import { matchesTelegramTags, telegramBotTags } from "./tags.js";
import type { TelegramBindingConfirmation } from "./confirmation.js";
import { receivedMessageSnapshot, TELEGRAM_MESSAGE_HISTORY_LIMIT } from "./messages.js";

export function linkCodeHash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export interface PollingIdentity { owner: string; revision: string }
interface IngestResult {
  accepted: boolean; ignored?: boolean; duplicate?: boolean; bound?: boolean;
  reason: string; status: string; inboxId?: string;
  matchedTags?: string[]; mentions?: string[]; confirmation?: TelegramBindingConfirmation; hashReply?: TelegramHashReply;
}

// Internal polling ingress, not exposed over HTTP/MCP. Cursor advancement
// commits with binding/queue writes before getUpdates acknowledges the ID.
export async function acceptTelegramUpdate(db: Knex, botId: string, raw: Buffer, identity?: PollingIdentity) {
  let updateId: unknown;
  let update: Row = {};
  try { update = JSON.parse(raw.toString("utf8")) as Row; updateId = update?.update_id; } catch { /* validated below */ }
  if (typeof updateId !== "number" || !Number.isSafeInteger(updateId) || updateId < 0 || updateId >= Number.MAX_SAFE_INTEGER) {
    throw new AppError("VALIDATION_ERROR", "Invalid Telegram update ID.");
  }
  const nextOffset = updateId + 1;
  let message: TelegramMentionMessage | null;
  try { message = parseMentionMessage(raw); }
  catch (error) {
    // Unsupported message shapes with a valid ID must not wedge polling.
    // They are ignored without forwarding or storing their content.
    if (!(error instanceof AppError) || error.code !== "VALIDATION_ERROR") throw error;
    message = null;
  }
  return db.transaction(async (trx) => {
    const bot = await trx("project_telegram_bots").where({ id: botId, enabled: true }).forUpdate().first();
    if (!bot || (identity && (bot.poll_owner !== identity.owner || bot.poll_revision !== identity.revision ||
        !bot.poll_lease_until || new Date(bot.poll_lease_until).getTime() <= Date.now()))) {
      return { accepted: false, stopped: true };
    }
    if (nextOffset <= Number(bot.poll_offset)) return { accepted: true, duplicate: true };
    const { fromBot, ...received } = receivedMessageSnapshot(update);
    const outgoing = await isOutgoingTelegramUpdate(trx, update);
    if (!outgoing) await rememberTelegramFiles(trx, bot, update);
    const result: IngestResult = outgoing ? { accepted: false, ignored: true, status: "ignored", reason: "bot_sender" } : message ? await ingestMessage(trx, bot, message) : {
      accepted: false, ignored: true, status: "ignored",
      reason: received.chat_type === "private" ? "private_chat" : fromBot ? "bot_sender" : received.text === null ? "no_text" : "unsupported"
    };
    if (!outgoing) await rememberChatPeople(trx, botId, update);
    const now = nowIso();
    await trx("telegram_bot_messages").insert({ id: randomUUID(), bot_id: botId, telegram_update_id: updateId,
      ...received, received_at: now, status: result.status, reason: result.reason, inbox_id: result.inboxId ?? null,
      matched_tags: JSON.stringify(result.matchedTags ?? []), mentions: JSON.stringify(result.mentions ?? []) });
    await trx("project_telegram_bots").where({ id: botId }).update({ poll_offset: nextOffset,
      received_count: trx.raw("received_count + 1"), last_received_at: now, last_chat_title: received.chat_title,
      ...(result.status === "queued" ? { matched_count: trx.raw("matched_count + 1"), last_matched_at: now } : {}) });
    await trx("telegram_bot_messages").whereIn("id", trx("telegram_bot_messages").select("id").where({ bot_id: botId })
      .orderBy("received_at", "desc").orderBy("telegram_update_id", "desc").offset(TELEGRAM_MESSAGE_HISTORY_LIMIT)).del();
    return result;
  });
}

async function ingestMessage(trx: Knex.Transaction, bot: Row, message: TelegramMentionMessage): Promise<IngestResult> {
  const botId = String(bot.id);
  const project = await trx("projects").where({ id: bot.project_id, status: "active" }).first();
  if (!project) return { accepted: false, ignored: true, status: "ignored", reason: "project_inactive" };
  const now = nowIso();
  const command = /^\/marrow_link(?:@([a-zA-Z0-9_]+))?\s+([a-zA-Z0-9_-]{32})$/.exec(message.text.trim());
  if (command) {
    if ((command[1] && command[1].toLowerCase() !== String(bot.username).toLowerCase()) ||
        !bot.link_code_hash || linkCodeHash(command[2]) !== bot.link_code_hash ||
        !bot.link_code_expires_at || new Date(String(bot.link_code_expires_at)).getTime() <= Date.now()) {
      return { accepted: false, ignored: true, status: "ignored", reason: "invalid_link_key" };
    }
    await trx("project_telegram_chats").insert({ bot_id: botId, chat_id: message.chatId, title: message.chatTitle, created_at: now })
      .onConflict(["bot_id", "chat_id"]).merge(["title"]);
    await trx("project_telegram_bots").where({ id: botId }).update({ link_code_hash: null, link_code_expires_at: null, last_received_at: now, last_chat_title: message.chatTitle });
    const confirmation: TelegramBindingConfirmation = {
      chatId: message.chatId, messageId: Number(message.messageId), projectTitle: String(project.title),
      ...(message.messageThreadId !== undefined ? { messageThreadId: message.messageThreadId } : {})
    };
    return { accepted: true, bound: true, status: "bound", reason: "chat_bound", confirmation };
  }
  if (!await trx("project_telegram_chats").where({ bot_id: botId, chat_id: message.chatId }).first()) return { accepted: false, ignored: true, status: "ignored", reason: "unbound_chat" };
  if (await trx("telegram_message_files").where({ project_id: project.id, chat_id: message.chatId, message_id: message.messageId }).whereNotNull("task_id").first())
    return { accepted: true, ignored: true, status: "ignored", reason: "attachment_added" };
  const hash = /^\/hash(?:@([a-zA-Z0-9_]+))?$/i.exec(message.text.trim());
  if (hash) {
    if (hash[1] && hash[1].toLowerCase() !== String(bot.username).toLowerCase())
      return { accepted: false, ignored: true, status: "ignored", reason: "command_other_bot" };
    // A new Telegram update ID can contain the same message (delivery replay).
    // Persist the handled message marker in the same transaction as the cursor.
    const handled = await trx("telegram_bot_messages").where({ bot_id: botId, chat_id: message.chatId, message_id: message.messageId, reason: "hash_command" }).first();
    if (handled) return { accepted: true, duplicate: true, status: "duplicate", reason: "duplicate" };
    return { accepted: true, status: "command", reason: "hash_command", hashReply: await hashReply(trx, bot, project, message) };
  }
  await rememberChatMentions(trx, botId, message);
  if (!matchesTelegramTags(bot.filter_tags, message.tags)) return { accepted: false, ignored: true, status: "ignored", reason: "no_matching_tag" };
  const matchedTags = message.tags.filter((tag) => telegramBotTags(bot.filter_tags).includes(tag));
  const members = await mentionedProjectMembers(trx, String(project.id), project.owner_user_id, message, botId, bot.filter_tags);
  if (!members.length) return { accepted: false, ignored: true, status: "ignored", reason: "no_project_member", matchedTags };
  if (message.mediaGroupId) {
    await trx("telegram_media_groups").insert({ project_id: project.id, chat_id: message.chatId, media_group_id: message.mediaGroupId, message_id: message.messageId })
      .onConflict(["project_id", "chat_id", "media_group_id"]).ignore();
    const group = await trx("telegram_media_groups").where({ project_id: project.id, chat_id: message.chatId, media_group_id: message.mediaGroupId }).first();
    message.messageId = String(group.message_id);
  }
  const rows = await trx("telegram_message_inbox").insert({
    id: randomUUID(), bot_id: botId, project_id: project.id, chat_id: message.chatId, message_id: message.messageId,
    payload: JSON.stringify(message), status: "pending", attempts: 0, available_at: now, received_at: now
  }).onConflict(["project_id", "chat_id", "message_id"]).ignore().returning("id");
  const inbox = rows[0] ?? await trx("telegram_message_inbox").where({ project_id: project.id, chat_id: message.chatId, message_id: message.messageId }).select("id").first();
  return { accepted: true, duplicate: rows.length === 0, status: rows.length ? "queued" : "duplicate", reason: rows.length ? "queued" : "duplicate",
    inboxId: String(inbox.id), matchedTags,
    mentions: members.map((member) => member.username ? `@${member.username}` : member.telegramId) };
}
