import type { GraphNode } from '../model/types';

/** Responsible assignees, independently of the record's author or current performer. */
export function graphNodeAssignedTo(node: GraphNode, userId: string): boolean {
  return node.assigneeUserIds.includes(userId);
}
