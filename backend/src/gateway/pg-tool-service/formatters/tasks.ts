import { taskClaimRoles, defaultTaskClaimLeaseSeconds } from "../types.js";
import { boundedInteger, shortText, stringArray, stringOrNull } from "./common.js";
import type { Row } from "../types.js";

export function compactTask(task: Row) {
  return {
    id: String(task.id),
    title: String(task.title),
    status: String(task.status),
    scope: shortText(stringOrNull(task.scope), 360),
    acceptance: shortText(stringOrNull(task.acceptance), 360),
    allowedFiles: stringArray(task.allowedFiles),
    forbiddenFiles: stringArray(task.forbiddenFiles),
    dependsOn: stringArray(task.dependsOn)
  };
}


export function taskOut(row: Row) {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    title: String(row.title),
    status: String(row.status),
    milestone: stringOrNull(row.milestone),
    priority: Number(row.priority ?? 100),
    scope: stringOrNull(row.scope),
    acceptance: stringOrNull(row.acceptance),
    allowedFiles: stringArray(row.allowed_files),
    forbiddenFiles: stringArray(row.forbidden_files),
    dependsOn: stringArray(row.depends_on),
    notes: stringOrNull(row.notes),
    activeClaimCount: Number(row.active_claim_count ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}


export function taskClaimOut(row: Row) {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    projectId: String(row.project_id),
    clientId: String(row.client_id),
    clientLabel: stringOrNull(row.client_label),
    clientKind: stringOrNull(row.client_kind),
    role: String(row.role),
    scope: stringOrNull(row.scope),
    status: taskClaimEffectiveStatus(row),
    leaseExpiresAt: String(row.lease_expires_at),
    heartbeatAt: String(row.heartbeat_at),
    note: stringOrNull(row.note),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}


export function taskClaimEffectiveStatus(row: Row): string {
  const status = String(row.status);
  if (status === "active" && new Date(String(row.lease_expires_at)).getTime() <= Date.now()) {
    return "expired";
  }
  return status;
}


export function taskClaimRole(value: unknown): string {
  return typeof value === "string" && taskClaimRoles.includes(value as (typeof taskClaimRoles)[number]) ? value : "other";
}


export function taskClaimLeaseExpiresAt(value: unknown): string {
  const seconds = boundedInteger(value, defaultTaskClaimLeaseSeconds, 60, 86_400);
  return new Date(Date.now() + seconds * 1000).toISOString();
}


export function taskClaimEventBody(row: Row): string {
  return [
    `claimId: ${String(row.id)}`,
    `clientId: ${String(row.client_id)}`,
    `clientLabel: ${String(row.client_label ?? "")}`,
    `role: ${String(row.role)}`,
    stringOrNull(row.scope) ? `scope: ${String(row.scope)}` : null,
    `leaseExpiresAt: ${String(row.lease_expires_at)}`,
    stringOrNull(row.note) ? `note: ${String(row.note)}` : null
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}


export function appendText(existing: string | null, addition: string | null): string | null {
  if (!addition) {
    return existing;
  }
  return existing ? `${existing}\n\n${addition}` : addition;
}


export function taskNoteTypeTitle(type: string): string {
  switch (type) {
    case "implementation_note":
      return "Implementation note";
    case "handoff":
      return "Handoff";
    case "test_result":
      return "Test result";
    case "review_note":
      return "Review note";
    default:
      return "Coordination note";
  }
}


export function taskNoteDefaultRelation(type: string): string {
  switch (type) {
    case "handoff":
      return "handoff_for";
    case "test_result":
      return "test_result_for";
    case "review_note":
      return "review_note_for";
    case "implementation_note":
      return "implementation_note_for";
    default:
      return "note_for";
  }
}

