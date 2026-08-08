import { shortText, stringArray, stringOrNull } from "./common.js";
import type { Row } from "../types.js";

export function compactDecisionRecord(record: Row) {
  return {
    id: String(record.id),
    projectId: stringOrNull(record.projectId),
    title: String(record.title),
    status: String(record.status),
    decision: shortText(String(record.decision ?? ""), 360),
    rationale: shortText(stringOrNull(record.rationale), 260),
    consequences: shortText(stringOrNull(record.consequences), 260),
    tags: stringArray(record.tags)
  };
}


export function decisionOut(row: Row) {
  return {
    id: String(row.id),
    projectId: stringOrNull(row.project_id),
    title: String(row.title),
    status: String(row.status),
    context: stringOrNull(row.context),
    decision: String(row.decision),
    rationale: stringOrNull(row.rationale),
    consequences: stringOrNull(row.consequences),
    tags: stringArray(row.tags),
    supersedesId: stringOrNull(row.supersedes_id),
    summary: stringOrNull(row.summary),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

