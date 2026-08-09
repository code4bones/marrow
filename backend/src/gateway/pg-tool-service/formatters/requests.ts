import { stringOrNull } from "./common.js";
import type { Row } from "../types.js";

export function requestOut(item: Row, fromProjectId: string | null, toProjectId: string | null) {
  return {
    id: String(item.id),
    fromProjectId,
    toProjectId,
    question: String(item.body),
    status: String(item.status),
    createdAt: String(item.createdAt),
    updatedAt: String(item.updatedAt)
  };
}

export function replyOut(item: Row, requestId: string, parentId: string) {
  return {
    id: String(item.id),
    requestId,
    parentId,
    projectId: stringOrNull(item.projectId),
    body: String(item.body),
    createdAt: String(item.createdAt)
  };
}

export interface ReplyTreeNode {
  reply: ReturnType<typeof replyOut>;
  children: ReplyTreeNode[];
}

// Assembles the flat (thread-tagged) reply list plus their "replies"-relation
// parent links into a LiveJournal-style comment tree: each node's children
// are replies to that specific reply, not just to the root request.
export function buildReplyTree(
  replyItems: Row[],
  parentByReplyId: Map<string, string>,
  rootId: string
): ReplyTreeNode[] {
  const childrenByParent = new Map<string, Row[]>();
  for (const item of replyItems) {
    const parentId = parentByReplyId.get(String(item.id)) ?? rootId;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(item);
    childrenByParent.set(parentId, siblings);
  }

  function assemble(parentId: string): ReplyTreeNode[] {
    const nodes = childrenByParent.get(parentId) ?? [];
    return nodes.map((node) => ({
      reply: replyOut(node, rootId, parentId),
      children: assemble(String(node.id))
    }));
  }

  return assemble(rootId);
}
