import { dateStringOrNull, shortText, stringArray, stringOrNull } from "./common.js";
import type { Row } from "../types.js";

export function skillOut(row: Row) {
  return {
    id: String(row.id),
    projectId: stringOrNull(row.project_id),
    scope: row.project_id ? "project" : "common",
    name: String(row.name),
    description: stringOrNull(row.description),
    body: String(row.body),
    status: String(row.status),
    tags: stringArray(row.tags),
    activationCount: Number(row.activation_count ?? 0),
    lastActivatedAt: dateStringOrNull(row.last_activated_at),
    archivedAt: dateStringOrNull(row.archived_at),
    archivedBy: stringOrNull(row.archived_by),
    archiveReason: stringOrNull(row.archive_reason),
    createdBy: stringOrNull(row.created_by),
    createdAt: dateStringOrNull(row.created_at),
    updatedAt: dateStringOrNull(row.updated_at)
  };
}

// T-context (D-MEMORY-041): compact card for project.summary's
// availableSkills + skill.list(compact:true) -- name + short description
// ONLY, deliberately excluding body. The whole point of "surface then
// activate" is that an agent sees what's available without paying for
// every skill's full instructions up front; skill.activate(id) loads the
// full body when the agent decides it needs one. Mirrors
// compactDecisionRecord's "excerpt not full body" rule (T-MEMORY-063).
export function compactSkillRecord(record: Row) {
  return {
    id: String(record.id),
    name: String(record.name),
    description: shortText(String(record.description ?? ""), 160),
    tags: stringArray(record.tags)
  };
}
