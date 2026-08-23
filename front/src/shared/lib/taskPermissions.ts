import type { ProjectMemberRole } from '../model/types';

// T-context (owner's ask, 2026-08-23): mirrors backend's TASK_ACTION_ROLES
// (projects-core.mixin.ts) exactly -- the backend is the real enforcement,
// this is purely a UI convenience so a viewer's own role hides/disables
// actions they don't have instead of letting them find out via an error
// toast after the fact. Keep the two in sync by hand; there's no shared
// package between front/back to generate this from.
export type TaskPermissionAction =
  | 'create' | 'delete' | 'edit_details' | 'reprioritize'
  | 'assign' | 'move' | 'complete' | 'review_decide';

const TASK_ACTION_ROLES: Record<TaskPermissionAction, ProjectMemberRole[]> = {
  create: ['pm', 'developer'],
  delete: ['pm'],
  edit_details: ['pm', 'developer'],
  reprioritize: ['pm'],
  assign: ['pm'],
  move: ['pm', 'developer'],
  complete: ['pm', 'tester'],
  review_decide: ['pm', 'tester'],
};

// While the viewer's role hasn't loaded yet (a brief query on mount),
// default to permissive -- the backend still enforces the real gate on
// submit, so a loading flash isn't a security concern, just a UX one, and
// defaulting to hidden/disabled would flicker every control on every page
// load instead.
export function canPerform(role: ProjectMemberRole | null | undefined, action: TaskPermissionAction): boolean {
  if (!role) return true;
  return TASK_ACTION_ROLES[action].includes(role);
}

// The action a status TRANSITION requires -- entering review (or any other
// non-terminal status) is a plain move, but the two decisions coming OUT of
// review are gated separately, mirroring updateTaskStatus's own branching.
export function actionForStatus(status: string): TaskPermissionAction {
  if (status === 'done') return 'complete';
  if (status === 'changes_requested') return 'review_decide';
  return 'move';
}
