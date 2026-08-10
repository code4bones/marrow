import { dateStringOrNull, shortText, stringOrNull } from "./common.js";
import type { Row } from "../types.js";

export function compactEventRecord(record: Row) {
  return {
    id: String(record.id),
    type: String(record.type),
    title: shortText(stringOrNull(record.title), 220),
    relatedId: stringOrNull(record.relatedId),
    createdAt: stringOrNull(record.createdAt)
  };
}


export function eventOut(row: Row) {
  return {
    id: String(row.id),
    projectId: stringOrNull(row.project_id),
    type: String(row.type),
    title: stringOrNull(row.title),
    body: stringOrNull(row.body),
    relatedId: stringOrNull(row.related_id),
    // credentialId attributes the event to the client that performed the
    // operation (T-MEMORY-029 / D-MEMORY-007). recordEventForProject already
    // wrote this into created_by (and mirrored it into source_instance_id)
    // on every event row -- this DTO just stops hiding it from callers.
    credentialId: stringOrNull(row.created_by),
    createdAt: dateStringOrNull(row.created_at)
  };
}


export function eventTypeForStatus(status: string): string {
  switch (status) {
    case "doing":
      return "task.started";
    case "done":
      return "task.completed";
    case "blocked":
      return "task.blocked";
    case "cancelled":
      return "task.cancelled";
    default:
      return "task.status_changed";
  }
}
