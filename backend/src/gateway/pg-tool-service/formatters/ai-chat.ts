import { dateStringOrNull } from "./common.js";
import type { Row } from "../types.js";

export function aiConversationOut(row: Row) {
  return {
    id: String(row.id),
    title: String(row.title),
    createdAt: dateStringOrNull(row.created_at),
    updatedAt: dateStringOrNull(row.updated_at)
  };
}

export function aiChatMessageOut(row: Row) {
  return {
    role: row.role as "user" | "assistant",
    content: String(row.content),
    createdAt: dateStringOrNull(row.created_at)
  };
}
