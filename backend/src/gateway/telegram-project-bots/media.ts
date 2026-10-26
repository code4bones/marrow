import { randomUUID } from "node:crypto";
import type { Knex } from "knex";
import type { Row } from "../pg-tool-service/types.js";
import { nowIso } from "../../shared/dates.js";

const object = (value: unknown): Row => value && typeof value === "object" ? value as Row : {};
export function telegramFileReferences(msg: Row) {
  const photo = Array.isArray(msg.photo) ? [...msg.photo].map(object).sort((a, b) => Number(b.width) * Number(b.height) - Number(a.width) * Number(a.height))[0] : null;
  return [ ...(photo ? [["photo", photo] as const] : []), ...["document", "video", "audio", "voice", "animation", "video_note", "sticker"].filter((kind) => msg[kind]).map((kind) => [kind, object(msg[kind])] as const) ]
    .filter(([, file]) => typeof file.file_id === "string" && typeof file.file_unique_id === "string")
    .map(([kind, file]) => ({ kind, fileId: String(file.file_id), uniqueId: String(file.file_unique_id),
      name: typeof file.file_name === "string" ? file.file_name.slice(0, 500) : `${kind}-${file.file_unique_id}.${kind === "photo" ? "jpg" : kind === "voice" ? "ogg" : kind === "sticker" ? file.is_video ? "webm" : file.is_animated ? "tgs" : "webp" : ["video", "video_note", "animation"].includes(kind) ? "mp4" : "bin"}`,
      contentType: typeof file.mime_type === "string" ? file.mime_type.slice(0, 200) : kind === "photo" ? "image/jpeg" : kind === "voice" ? "audio/ogg" : ["video", "video_note", "animation"].includes(kind) ? "video/mp4" : "application/octet-stream",
      size: typeof file.file_size === "number" && Number.isSafeInteger(file.file_size) ? file.file_size : null }));
}

export async function rememberTelegramFiles(db: Knex, bot: Row, update: Row): Promise<void> {
  const msg = object(update.message ?? update.channel_post);
  const chat = object(msg.chat);
  if (object(msg.from).is_bot || !["group", "supergroup", "channel"].includes(String(chat.type)) || !Number.isSafeInteger(msg.message_id)) return;
  const chatId = String(chat.id);
  if (!await db("project_telegram_chats").where({ bot_id: bot.id, chat_id: chatId }).first()) return;
  const files = telegramFileReferences(msg);
  if (!files.length) return;
  const now = nowIso();
  const groupId = typeof msg.media_group_id === "string" ? msg.media_group_id : null;
  const reply = object(msg.reply_to_message).message_id;
  await db("telegram_message_files").insert(files.map((file) => ({ id: randomUUID(), project_id: bot.project_id, bot_id: bot.id,
    chat_id: chatId, message_id: String(msg.message_id), file_id: file.fileId, file_unique_id: file.uniqueId, kind: file.kind,
    file_name: file.name, content_type: file.contentType, size_bytes: file.size, media_group_id: groupId,
    reply_to_message_id: Number.isSafeInteger(reply) ? String(reply) : null,
    message_thread_id: Number.isSafeInteger(msg.message_thread_id) ? msg.message_thread_id : null,
    status: "waiting", available_at: now, received_at: now }))).onConflict(["project_id", "chat_id", "message_id", "file_unique_id"]).ignore();
  let source = await db("telegram_task_sources").where({ project_id: bot.project_id, chat_id: chatId }).whereIn("message_id", [String(msg.message_id), ...(Number.isSafeInteger(reply) ? [String(reply)] : [])]).whereNotNull("task_id").first();
  if (!source && Number.isSafeInteger(reply)) {
    const sent = await db("telegram_outgoing_messages as o").join("tasks as t", "t.id", "o.task_id")
      .where({ "o.chat_id": chatId, "o.message_id": String(reply), "t.project_id": bot.project_id }).select("t.id").first();
    if (sent) source = { task_id: sent.id };
  }
  if (!source && groupId) {
    const group = await db("telegram_media_groups").where({ project_id: bot.project_id, chat_id: chatId, media_group_id: groupId }).first();
    if (group) source = await db("telegram_task_sources").where({ project_id: bot.project_id, chat_id: chatId, message_id: group.message_id }).whereNotNull("task_id").first();
  }
  if (source) await db("telegram_message_files").where({ project_id: bot.project_id, chat_id: chatId, message_id: String(msg.message_id), status: "waiting" }).update({ task_id: source.task_id, status: "pending", available_at: now });
}

export async function attachTelegramFiles(db: Knex, projectId: string, chatId: string, messageId: string, taskId: string, groupId?: string) {
  await db("telegram_message_files").where({ project_id: projectId, chat_id: chatId, status: "waiting" })
    .andWhere((q) => { q.where("message_id", messageId).orWhere("reply_to_message_id", messageId); if (groupId) q.orWhere("media_group_id", groupId); })
    .update({ task_id: taskId, status: "pending", available_at: nowIso() });
}
