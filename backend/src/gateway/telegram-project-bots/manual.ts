import type { Knex } from "knex";
import * as z from "zod/v4";
import { nowIso } from "../../shared/dates.js";
import { AppError } from "../../shared/errors.js";
import type { Row } from "../pg-tool-service/types.js";
import type { MentionedMember } from "./members.js";
import { activeProjectUsers } from "./members.js";
import { resolveTaskAssignees } from "../task-assignees.js";
import type { TelegramMentionMessage } from "./protocol.js";
import type { Classification } from "./classifier.js";

export const manualTelegramTaskSchema = z.object({
  assigneeUserIds: z.array(z.string().min(1)).min(1).max(50), title: z.string().trim().min(1).max(300),
  requestedBy: z.string().min(1), ownerUserId: z.string().min(1), requestedAt: z.string().min(1)
}).strict();
export function manualTelegramTask(value: unknown) {
  if (!value) return null;
  return manualTelegramTaskSchema.parse(typeof value === "string" ? JSON.parse(value) : value);
}

export async function manualTelegramClassification(db: Knex, project: Row, value: unknown, message: TelegramMentionMessage): Promise<{ members: MentionedMember[]; classification: Classification }> {
  const manual = manualTelegramTask(value)!;
  if (manual.ownerUserId !== project.owner_user_id) throw new AppError("VALIDATION_ERROR", "Project owner changed; confirm this manual task again.");
  const users = await activeProjectUsers(db, String(project.id), String(project.owner_user_id)).select("u.id");
  if (manual.assigneeUserIds.some((id) => !users.some((u) => u.id === id))) throw new AppError("VALIDATION_ERROR", "Choose active project members again.");
  const members: MentionedMember[] = manual.assigneeUserIds.map((userId) => ({ userId, telegramId: `tag:${userId}`, username: null, resolution: "manual", viaTag: true }));
  return { members, classification: { tasks: [{ telegramUserId: members[0].telegramId, title: manual.title,
    description: message.text.slice(0, 4000), evidence: message.text.slice(0, 2000), confidence: 1 }] } };
}

// Authorized owner/admin confirmation. Reuse the original inbox/source identity
// and fence any in-flight old classifier with a monotonically newer attempt.
export async function queueManualTelegramTask(db: Knex, project: Row, botId: string, journalId: string, assignees: string[], title: string | undefined, actorId: string) {
  return db.transaction(async (trx) => {
    const currentProject = await trx("projects").where({ id: project.id, status: "active" }).forUpdate().first();
    const bot = await trx("project_telegram_bots").where({ id: botId, project_id: project.id, enabled: true }).forUpdate().first();
    if (!currentProject || !bot || currentProject.owner_user_id !== project.ownerUserId) throw new AppError("VALIDATION_ERROR", "Activate the bot and confirm the project settings first.");
    const journal = await trx("telegram_bot_messages").where({ id: journalId, bot_id: bot.id }).first();
    const inbox = journal?.inbox_id ? await trx("telegram_message_inbox").where({ id: journal.inbox_id, bot_id: bot.id, project_id: project.id }).forUpdate().first() : null;
    if (!inbox || journal.reason === "bot_sender") throw new AppError("VALIDATION_ERROR", "Only an original message admitted to this bot's task pipeline can be confirmed manually.");
    if (!await trx("project_telegram_chats").where({ bot_id: bot.id, chat_id: inbox.chat_id }).first()) throw new AppError("VALIDATION_ERROR", "Chat is no longer bound.");
    const source = await trx("telegram_task_sources").where({ project_id: project.id, chat_id: inbox.chat_id, message_id: inbox.message_id }).first();
    if (source) {
      if (!source.task_id) throw new AppError("VALIDATION_ERROR", "This source was already imported; its task was deleted.");
      return { queued: false, taskId: String(source.task_id) };
    }
    const ids = await resolveTaskAssignees(trx, String(project.id), { assignees });
    const message = (typeof inbox.payload === "string" ? JSON.parse(inbox.payload) : inbox.payload) as TelegramMentionMessage;
    const cleanTitle = title?.trim() || message.text.replace(/#[\p{L}\p{N}_]+/gu, "").trim().split("\n").find((s) => s.trim())?.trim().slice(0, 300);
    const manual = manualTelegramTaskSchema.parse({ assigneeUserIds: ids, title: cleanTitle, requestedBy: actorId, ownerUserId: currentProject.owner_user_id, requestedAt: nowIso() });
    const previous = manualTelegramTask(inbox.manual_override);
    if (["pending", "processing"].includes(String(inbox.status)) && previous?.title === manual.title && JSON.stringify(previous.assigneeUserIds) === JSON.stringify(ids)) return { queued: true, taskId: null };
    await trx("telegram_message_inbox").where({ id: inbox.id }).update({ manual_override: JSON.stringify(manual), status: "pending",
      attempts: Number(inbox.attempts) + 1, available_at: nowIso(), locked_until: null, last_error: null,
      classification: null, classified_owner_id: null, classified_at: null, processed_at: null, result_reason: null });
    return { queued: true, taskId: null };
  });
}
