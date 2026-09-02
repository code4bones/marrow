import { stringOrNull } from "./common.js";
import type { Row } from "../types.js";

// Agent addressing (backend/front-style same-project Q&A) piggybacks on the
// existing tags array instead of adding columns -- same trick threadTag()
// in requests.mixin.ts already uses for threading.
const TO_AGENT_PREFIX = "to-agent:";
const FROM_AGENT_PREFIX = "from-agent:";

export function toAgentTag(agent: string): string {
  return `${TO_AGENT_PREFIX}${agent}`;
}

export function fromAgentTag(agent: string): string {
  return `${FROM_AGENT_PREFIX}${agent}`;
}

function agentFromTags(tags: unknown, prefix: string): string | null {
  const list = Array.isArray(tags) ? (tags as string[]) : [];
  const tag = list.find((t) => t.startsWith(prefix));
  return tag ? tag.slice(prefix.length) : null;
}

export function requestOut(item: Row, fromProjectId: string | null, toProjectId: string | null) {
  return {
    id: String(item.id),
    fromProjectId,
    toProjectId,
    fromAgent: agentFromTags(item.tags, FROM_AGENT_PREFIX),
    toAgent: agentFromTags(item.tags, TO_AGENT_PREFIX),
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
    fromAgent: agentFromTags(item.tags, FROM_AGENT_PREFIX),
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
