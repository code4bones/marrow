import { dateStringOrNull, stringOrNull } from "./common.js";
import type { Row } from "../types.js";

export function projectGroupMemberOut(row: Row) {
  return {
    key: String(row.key),
    projectId: String(row.project_id),
    createdBy: stringOrNull(row.created_by),
    createdAt: dateStringOrNull(row.created_at)
  };
}
