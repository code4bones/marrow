import { assigneeDiffersFromOwner } from "../../assignees.js";
import { dateStringOrNull, stringOrNull } from "./common.js";
import type { GraphEdge, GraphNode, Row } from "../types.js";

export function graphNodeOut(kind: string, row: Row): GraphNode {
  const createdBy = stringOrNull(row.created_by) ?? stringOrNull(row.createdBy);
  const assigneeUserId = stringOrNull(row.assignee_user_id) ?? stringOrNull(row.assigneeUserId);
  return {
    id: String(row.id),
    kind,
    title: graphNodeTitle(kind, row),
    status: stringOrNull(row.status),
    milestone: stringOrNull(row.milestone),
    // Most callers pass a raw db row (snake_case created_at/created_by, a
    // Date object), but the PROJECT node is built from resolveProject()'s
    // already-transformed projectOut() shape (camelCase createdAt/createdBy,
    // already a string) — accept either.
    createdAt: dateStringOrNull(row.created_at) ?? dateStringOrNull(row.createdAt),
    createdBy,
    assigneeUserId,
    assigneeDiffersFromOwner: assigneeDiffersFromOwner(assigneeUserId, createdBy)
  };
}


export function graphNodeTitle(kind: string, row: Row): string {
  const title = stringOrNull(row.title);
  if (title) {
    return title;
  }
  if (kind === "PROJECT") {
    return stringOrNull(row.slug) ?? String(row.id);
  }
  if (kind === "ARTIFACT") {
    return stringOrNull(row.path) ?? String(row.id);
  }
  if (kind === "EVENT") {
    return stringOrNull(row.type) ?? String(row.id);
  }
  return String(row.id);
}


export function graphNodeSortKey(node: GraphNode): string {
  const order = ["PROJECT", "TASK", "DECISION", "MEMORY", "ARTIFACT", "EVENT"];
  const index = order.includes(node.kind) ? order.indexOf(node.kind) : order.length;
  return `${String(index).padStart(2, "0")}:${node.id}`;
}


export function graphEdgeSortKey(edge: GraphEdge): string {
  return `${edge.from}:${edge.relation}:${edge.to}`;
}

