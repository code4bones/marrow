import { stringOrNull } from "./common.js";
import type { Row } from "../types.js";

export function linkOut(row: Row) {
  return {
    id: String(row.id),
    projectId: stringOrNull(row.project_id),
    fromId: String(row.from_id),
    toId: String(row.to_id),
    relation: String(row.relation),
    createdAt: String(row.created_at)
  };
}

