import { getTaskAssigneeIds } from "../task-assignees.js";
import { stringArray } from "../pg-tool-service/formatters/common.js";
import { randomUUID } from "node:crypto";
import type { Knex } from "knex";
import { nowIso } from "../../shared/dates.js";
import { AppError } from "../../shared/errors.js";
import type { Row } from "../pg-tool-service/types.js";

export function exportRecipients(row: Row): string[] {
  const ids = stringArray(row.recipient_user_ids);
  return ids.length ? ids : row.recipient_user_id ? [String(row.recipient_user_id)] : [];
}
export function exportGitlabUsers(row: Row): string[] {
  const ids = stringArray(row.gitlab_user_ids);
  return ids.length ? ids : row.gitlab_user_id ? [String(row.gitlab_user_id)] : [];
}
export const sameUsers = (left: string[], right: string[]) => [...left].sort().join(",") === [...right].sort().join(",");

export const exportMarker = (id: string) => `<!-- marrow-export:${id} -->`;
export function exportMarkerId(description: string | null): string | null {
  return description?.match(/<!-- marrow-export:([0-9a-f-]{36}) -->/)?.[1] ?? null;
}

export async function exportStatus(db: Knex, taskId: string) {
  const row = await db("gitlab_issue_exports").where({ task_id: taskId }).first();
  const link = await db("gitlab_issue_links").where({ task_id: taskId }).first();
  if (!row && !link) return null;
  const repo = link ? await db("project_repositories").where({ project_id: link.project_id, host: link.host, gitlab_project_id: link.gitlab_project_id }).first() : null;
  return { status: row?.status ?? "imported", repositoryId: row?.repository_id ?? repo?.id ?? null,
    issueUrl: row?.issue_iid ? `${row.repository_url}/-/issues/${row.issue_iid}` : repo && link ? `${repo.web_url}/-/issues/${link.issue_iid}` : null,
    lastError: row?.last_error ?? null };
}

// Called inside the task mutation's transaction. No remote I/O here.
export async function enqueueIssueExport(db: Knex, task: Row, actorId: string, repositoryId?: string) {
  await db("projects").where({ id: task.project_id }).forUpdate().first();
  task = await db("tasks").where({ id: task.id }).forUpdate().first();
  if (!task) throw new AppError("TASK_NOT_FOUND", "Task no longer exists.");
  const existing = await db("gitlab_issue_exports").where({ task_id: task.id }).first();
  if (existing?.post_attempted_at || existing?.status === "done") {
    if (repositoryId && existing.repository_id !== repositoryId) throw new AppError("VALIDATION_ERROR", "An attempted GitLab export cannot be moved to another repository.");
    return exportStatus(db, String(task.id));
  }
  // The provenance is authoritative, including imported issues reassigned later.
  if (String(task.created_by).startsWith("integration:gitlab:") || await db("gitlab_issue_links").where({ task_id: task.id }).first()) {
    return exportStatus(db, String(task.id));
  }
  const assigneeIds = await getTaskAssigneeIds(db, task);
  if (!assigneeIds.length) return exportStatus(db, String(task.id));
  const repositories = await db("project_repositories").where({ project_id: task.project_id });
  if (!repositories.length && !repositoryId) return null;
  const selected = repositoryId ?? (existing?.repository_explicit ? existing.repository_id : null);
  const candidates = selected ? repositories.filter((row) => row.id === selected)
    : existing?.repository_explicit ? []
    : repositories.filter((row) => assigneeIds.includes(String(row.lead_user_id)));
  if (repositoryId && !candidates.length) throw new AppError("VALIDATION_ERROR", "Choose a repository attached to this task's project.");
  const repo = candidates.length === 1 ? candidates[0] : null;
  const mappings = repo ? await db("project_gitlab_members").where({ project_id: task.project_id, host: repo.host }).whereIn("user_id", assigneeIds) : [];
  const gitlabIds = [...new Set(mappings.map((m) => String(m.gitlab_user_id)))];
  const error = !repo ? "REPOSITORY_REQUIRED" : mappings.length !== assigneeIds.length ? "GITLAB_MAPPING_REQUIRED" : null;
  const now = nowIso();
  const row = { repository_id: repo?.id ?? null, repository_explicit: Boolean(repositoryId || existing?.repository_explicit), host: repo?.host ?? null, gitlab_project_id: repo?.gitlab_project_id ?? null,
    repository_url: repo?.web_url ?? null, actor_user_id: actorId, recipient_user_id: assigneeIds[0], recipient_user_ids: JSON.stringify(assigneeIds),
    gitlab_user_id: gitlabIds[0] ?? null, gitlab_user_ids: JSON.stringify(gitlabIds), status: error ? "blocked" : "pending", last_error: error,
    available_at: now, locked_until: null, updated_at: now };
  if (existing) await db("gitlab_issue_exports").where({ id: existing.id }).update(row);
  else await db("gitlab_issue_exports").insert({ ...row, id: randomUUID(), task_id: task.id,
    source_task_id: task.id, project_id: task.project_id, created_at: now });
  return exportStatus(db, String(task.id));
}

// Both API response and webhook use this under the same project lock.
export async function linkExport(db: Knex, operation: Row, issueId: string, iid: string): Promise<void> {
  if (operation.issue_id && operation.issue_id !== issueId) throw new AppError("VALIDATION_ERROR", "Export marker belongs to a different GitLab issue.");
  const key = { project_id: operation.project_id, host: operation.host, gitlab_project_id: operation.gitlab_project_id, issue_id: issueId };
  const linked = await db("gitlab_issue_links").where(key).first();
  if (linked && linked.task_id !== operation.task_id) throw new AppError("VALIDATION_ERROR", "GitLab issue is already linked to another task.");
  await db("gitlab_issue_links").insert({ ...key, issue_iid: iid, task_id: operation.task_id, created_at: nowIso() }).onConflict(["project_id", "host", "gitlab_project_id", "issue_id"]).ignore();
  await db("gitlab_issue_exports").where({ id: operation.id }).update({ status: "done", issue_id: issueId, issue_iid: iid,
    last_error: null, locked_until: null, updated_at: nowIso() });
}

export async function correlateExportEcho(db: Knex, repo: Row, description: string | null, issueId: string, iid: string): Promise<{ taskId: string | null } | null> {
  const id = exportMarkerId(description);
  if (!id) return null;
  const operation = await db("gitlab_issue_exports").where({ id, project_id: repo.project_id, host: repo.host, gitlab_project_id: repo.gitlab_project_id }).forUpdate().first();
  if (!operation || !operation.post_attempted_at) return null;
  await linkExport(db, operation, issueId, iid);
  return { taskId: operation.task_id ?? null };
}
