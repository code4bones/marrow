import { randomUUID } from "node:crypto";
import type { Knex } from "knex";
import * as z from "zod/v4";
import { participantList, telegramParticipants, telegramPersonSchema } from "./participant-references.js";
import { getTaskPerformerIds } from "../task-workflow.js";
import { nowIso } from "../../shared/dates.js";
import type { Row } from "../pg-tool-service/types.js";

export const telegramFeedbackIntegration = "telegram_project_bot";
export const telegramFeedbackSchema = z.object({
  botId: z.string().uuid(), chatId: z.string().regex(/^-?[0-9]+$/), messageId: z.number().int().positive(),
  messageThreadId: z.number().int().positive().nullable(), status: z.enum(["done", "clar", "handoff", "reassigned"]),
  taskVersion: z.number().int().positive(), taskId: z.string().min(1), title: z.string(), projectSlug: z.string(), note: z.string().nullable(),
  from: z.array(telegramPersonSchema), to: z.array(telegramPersonSchema)
});
export type TelegramTaskFeedback = z.infer<typeof telegramFeedbackSchema>;

// Called inside the task status transaction. Remote I/O is exclusively in
// the dispatcher; a failed send cannot roll a task out of DONE/clarification.
export async function enqueueTelegramTaskFeedback(db: Knex, task: Row, eventId: string,
  status: TelegramTaskFeedback["status"], note: string | null = null, previousIds: string[] = [], actorId: string | null = null): Promise<void> {
  const sources = await db("telegram_task_sources").where({ task_id: task.id, project_id: task.project_id }).whereNotNull("bot_id");
  if (!sources.length) return;
  const project = await db("projects").where({ id: task.project_id }).first();
  if (!project) return;
  const seen = new Set<string>();
  for (const source of sources) {
    const key = `${eventId}:${source.chat_id}:${source.message_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const assignees = await getTaskPerformerIds(db, task);
    const ids = [...new Set([...previousIds, ...assignees, ...(actorId ? [actorId] : [])])];
    const participants = await telegramParticipants(db, String(source.bot_id), String(source.chat_id), ids, source.participants);
    await db("telegram_task_sources").where({ project_id: source.project_id, chat_id: source.chat_id, message_id: source.message_id }).update({ participants: JSON.stringify(participants) });
    const payload: TelegramTaskFeedback = {
      botId: String(source.bot_id), chatId: String(source.chat_id), messageId: Number(source.message_id),
      messageThreadId: source.message_thread_id ? Number(source.message_thread_id) : null,
      status, taskVersion: Number(task.version), taskId: String(task.id), title: String(task.title), projectSlug: String(project.slug), note,
      from: participantList(participants, previousIds.length ? previousIds : actorId ? [actorId] : assignees), to: participantList(participants, assignees)
    };
    const now = nowIso();
    await db("integration_outbox").insert({ id: randomUUID(), integration: telegramFeedbackIntegration, kind: `task.${status}`,
      idempotency_key: key, source_event_id: eventId, project_id: task.project_id, task_id: task.id,
      payload: JSON.stringify(payload), delivery_status: "pending", attempt_count: 0, available_at: now, created_at: now, updated_at: now })
      .onConflict(["integration", "idempotency_key"]).ignore();
  }
}
