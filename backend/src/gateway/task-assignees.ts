import type { Knex } from "knex";
import { AppError } from "../shared/errors.js";
import { resolveAssigneeFromMembers } from "./assignees.js";
import { userIdFromClientId } from "./credits.js";
import type { Row } from "./pg-tool-service/types.js";

export function taskAssigneeIds(row: Row): string[] {
  const ids = row.assignee_user_ids ?? row.assigneeUserIds;
  if (Array.isArray(ids)) return [...new Set(ids.map(String))];
  const legacy = row.assignee_user_id ?? row.assigneeUserId;
  return legacy ? [String(legacy)] : [];
}

export async function loadTaskAssignees(db: Knex, rows: Row[]): Promise<Row[]> {
  if (!rows.length) return rows;
  const assignments = await db("task_assignees").whereIn("task_id", rows.map((r) => String(r.id))).orderBy("position").orderBy("user_id");
  const byTask = new Map<string, string[]>();
  for (const a of assignments) byTask.set(String(a.task_id), [...(byTask.get(String(a.task_id)) ?? []), String(a.user_id)]);
  return rows.map((r) => ({ ...r, assignee_user_ids: byTask.get(String(r.id)) ?? taskAssigneeIds(r) }));
}

export async function getTaskAssigneeIds(db: Knex, row: Row): Promise<string[]> {
  return taskAssigneeIds((await loadTaskAssignees(db, [row]))[0]);
}

export async function setTaskAssignees(db: Knex, taskId: string, ids: string[]): Promise<void> {
  ids = [...new Set(ids)];
  await db("task_assignees").where({ task_id: taskId }).del();
  if (ids.length) await db("task_assignees").insert(ids.map((user_id, position) => ({ task_id: taskId, user_id, position })));
  // Compatibility mirror for older clients/integrations. The relation is canonical.
  await db("tasks").where({ id: taskId }).update({ assignee_user_id: ids[0] ?? null });
}

export async function resolveTaskAssignees(db: Knex, projectId: string, input: Row, fallbackClientId?: string): Promise<string[]> {
  if (input.assignees !== undefined && input.assignee !== undefined)
    throw new AppError("VALIDATION_ERROR", "Use either assignees or the legacy assignee field, not both.");
  const requested = input.assignees !== undefined ? input.assignees as string[]
    : input.assignee === null ? [] : input.assignee !== undefined ? [String(input.assignee)]
    : userIdFromClientId(fallbackClientId) ? [userIdFromClientId(fallbackClientId)!] : [];
  const project = await db("projects").where({ id: projectId }).first();
  const allowed = await db("users as u").where("u.status", "active")
    .where((q) => q.where("u.id", project?.owner_user_id ?? null).orWhereIn("u.id",
      db("project_members").select("user_id").where({ project_id: projectId, status: "active" }))).select("u.id", "u.email");
  const ids: string[] = [];
  for (const value of requested) {
    const id = resolveAssigneeFromMembers(allowed.map((m) => ({ id: String(m.id), email: String(m.email) })), value.trim());
    if (!id || !allowed.some((m) => m.id === id)) throw new AppError("VALIDATION_ERROR", "Choose active project participants as assignees.");
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}
