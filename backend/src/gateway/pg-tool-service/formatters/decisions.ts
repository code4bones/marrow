import { shortText, stringArray, stringOrNull } from "./common.js";
import type { Row } from "../types.js";

// T-MEMORY-063: a compact card is for picking a decision, not reading it --
// rationale/consequences are full-body fields, only available via
// decision.get from here on.
export function compactDecisionRecord(record: Row) {
  return {
    id: String(record.id),
    projectId: stringOrNull(record.projectId),
    title: String(record.title),
    status: String(record.status),
    decisionExcerpt: shortText(String(record.decision ?? ""), 140),
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

