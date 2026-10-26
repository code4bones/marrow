import { randomUUID } from "node:crypto";
import type { Knex } from "knex";
import * as z from "zod/v4";
import { nowIso } from "../shared/dates.js";
import { dateStringOrNull } from "./pg-tool-service/formatters/common.js";
import type { NormalizedGatewayRequestContext, Row } from "./pg-tool-service/types.js";

const participantSchema = z.object({ userId: z.string(), label: z.string() });
export type WorkflowParticipant = z.infer<typeof participantSchema>;
export const taskWorkflowSchema = z.object({
  id: z.string().min(1), beforeVersion: z.number().int().positive().optional(), limit: z.number().int().min(1).max(100).optional()
});
export const taskWorkflowRules = "assigneeUserIds is the responsible team, independent of currentPerformerUserIds. For 'send/pass/передай/отправь this task to X', use task.handoff on this SAME task, never task.update_assignee or a duplicate task. Read task.get for expectedVersion; supply next performers in assignees, a work/context note and optional status (todo by default). Complete/release active claims first. task.update_assignee only explicitly edits the responsible team; it does not transfer execution. task.workflow paginates immutable actor/from/to/time/status history. CLAR requires a question via task.update_status; DONE means the entire task is finished.";

function participants(value: unknown): WorkflowParticipant[] {
  return z.array(participantSchema).parse(typeof value === "string" ? JSON.parse(value) : value);
}
export async function getTaskPerformerIds(db: Knex, task: Row): Promise<string[]> {
  return (await db("task_performers").where({ task_id: task.id }).orderBy("position")).map((p) => String(p.user_id));
}
export async function loadTaskPerformers(db: Knex, rows: Row[]): Promise<Row[]> {
  if (!rows.length) return rows;
  const people = await db("task_performers").whereIn("task_id", rows.map((r) => String(r.id))).orderBy("position");
  const byTask = new Map<string, string[]>();
  for (const p of people) byTask.set(String(p.task_id), [...(byTask.get(String(p.task_id)) ?? []), String(p.user_id)]);
  return rows.map((r) => ({ ...r, current_performer_user_ids: byTask.get(String(r.id)) ?? [] }));
}
async function snapshot(db: Knex, ids: string[]): Promise<WorkflowParticipant[]> {
  const users = ids.length ? await db("users").whereIn("id", ids).select("id", "email") : [];
  return ids.map((userId) => ({ userId, label: String(users.find((u) => u.id === userId)?.email ?? userId) }));
}
export async function appendTaskWorkflow(db: Knex, task: Row, context: NormalizedGatewayRequestContext, input: {
  kind: "created" | "handoff" | "status"; actorId: string | null; fromIds?: string[]; toIds?: string[]; note?: string | null;
}): Promise<void> {
  const current = await getTaskPerformerIds(db, task);
  const to = input.toIds ?? current;
  const actor = input.actorId ? await db("users").where({ id: input.actorId }).select("email").first() : null;
  await db("task_workflow_steps").insert({
    id: randomUUID(), task_id: task.id, project_id: task.project_id, task_version: Number(task.version ?? 1), kind: input.kind,
    actor_user_id: input.actorId, actor_client_id: context.clientId, actor_label: actor?.email ?? context.clientLabel ?? context.clientId,
    from_participants: JSON.stringify(await snapshot(db, input.fromIds ?? current)), to_participants: JSON.stringify(await snapshot(db, to)),
    status: task.status, note: input.note ?? null, created_at: nowIso()
  });
  if (input.toIds !== undefined) {
    await db("task_performers").where({ task_id: task.id }).del();
    if (to.length) await db("task_performers").insert(to.map((user_id, position) => ({ task_id: task.id, user_id, position })));
  }
}
export function workflowStepOut(row: Row) {
  return { id: String(row.id), taskId: String(row.task_id), projectId: String(row.project_id), taskVersion: Number(row.task_version),
    kind: String(row.kind), actorUserId: row.actor_user_id ?? null, actorClientId: String(row.actor_client_id), actorLabel: String(row.actor_label),
    from: participants(row.from_participants), to: participants(row.to_participants), status: String(row.status), note: row.note ?? null, createdAt: dateStringOrNull(row.created_at) };
}
export async function readTaskWorkflow(db: Knex, taskId: string, beforeVersion?: number, limit = 50) {
  const query = db("task_workflow_steps").where({ task_id: taskId });
  if (beforeVersion !== undefined) query.where("task_version", "<", beforeVersion);
  const rows = await query.orderBy("task_version", "desc").limit(limit + 1);
  const page = rows.slice(0, limit);
  return { items: page.map(workflowStepOut), hasMore: rows.length > limit, nextBeforeVersion: rows.length > limit ? Number(page.at(-1)!.task_version) : null };
}
