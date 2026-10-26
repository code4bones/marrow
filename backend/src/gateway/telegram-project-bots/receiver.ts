import { createHash, randomUUID } from "node:crypto";
import type { Knex } from "knex";
import { nowIso } from "../../shared/dates.js";
import { AppError } from "../../shared/errors.js";
import type { Row } from "../pg-tool-service/types.js";
import { parseMentionMessage, type TelegramMentionMessage } from "./protocol.js";
import { mentionedProjectMembers } from "./members.js";
import { matchesTelegramTags } from "./tags.js";

export function linkCodeHash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export interface PollingIdentity { owner: string; revision: string }

// Internal polling ingress, not exposed over HTTP/MCP. Cursor advancement
// commits with binding/queue writes before getUpdates acknowledges the ID.
export async function acceptTelegramUpdate(db: Knex, botId: string, raw: Buffer, identity?: PollingIdentity) {
  let updateId: unknown;
  try { updateId = (JSON.parse(raw.toString("utf8")) as Row)?.update_id; } catch { /* validated below */ }
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
    const result = message ? await ingestMessage(trx, bot, message) : { accepted: false, ignored: true };
    await trx("project_telegram_bots").where({ id: botId }).update({ poll_offset: nextOffset });
    return result;
  });
}

async function ingestMessage(trx: Knex.Transaction, bot: Row, message: TelegramMentionMessage) {
  const botId = String(bot.id);
  const project = await trx("projects").where({ id: bot.project_id, status: "active" }).first();
  if (!project) return { accepted: false, ignored: true };
  const now = nowIso();
  const command = /^\/marrow_link(?:@([a-zA-Z0-9_]+))?\s+([a-zA-Z0-9_-]{32})$/.exec(message.text.trim());
  if (command) {
    if ((command[1] && command[1].toLowerCase() !== String(bot.username).toLowerCase()) ||
        !bot.link_code_hash || linkCodeHash(command[2]) !== bot.link_code_hash ||
        !bot.link_code_expires_at || new Date(String(bot.link_code_expires_at)).getTime() <= Date.now()) {
      return { accepted: false, ignored: true };
    }
    await trx("project_telegram_chats").insert({ bot_id: botId, chat_id: message.chatId, title: message.chatTitle, created_at: now })
      .onConflict(["bot_id", "chat_id"]).merge(["title"]);
    await trx("project_telegram_bots").where({ id: botId }).update({ link_code_hash: null, link_code_expires_at: null, last_received_at: now, last_chat_title: message.chatTitle });
    return { accepted: true, bound: true };
  }
  if (!await trx("project_telegram_chats").where({ bot_id: botId, chat_id: message.chatId }).first()) return { accepted: false, ignored: true };
  await trx("project_telegram_bots").where({ id: botId }).update({ last_received_at: now, last_chat_title: message.chatTitle });
  if (!matchesTelegramTags(bot.filter_tags, message.tags)) return { accepted: false, ignored: true };
  const members = await mentionedProjectMembers(trx, String(project.id), project.owner_user_id, message);
  if (!members.length) return { accepted: false, ignored: true };
  const rows = await trx("telegram_message_inbox").insert({
    id: randomUUID(), bot_id: botId, project_id: project.id, chat_id: message.chatId, message_id: message.messageId,
    payload: JSON.stringify(message), status: "pending", attempts: 0, available_at: now, received_at: now
  }).onConflict(["project_id", "chat_id", "message_id"]).ignore().returning("id");
  return { accepted: true, duplicate: rows.length === 0 };
}
