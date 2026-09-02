import * as z from "zod/v4";

// T-MEMORY-115: "review" (submitted, awaiting a pm/tester decision) and
// "changes_requested" (reviewer rejected it -- terminal for THIS task, a
// linked follow-up task carries the actual rework, see
// TasksMixin.createFollowUpTask) sit between "doing" and "done" in the
// normal flow but aren't mandatory -- "done" is still reachable directly.
export const taskStatusSchema = z.enum(["todo", "doing", "blocked", "review", "changes_requested", "done", "cancelled"]);

export const createTaskSchema = z.object({
  project: z.string().optional(),
  title: z.string().min(1),
  milestone: z.string().optional(),
  priority: z.number().int().optional(),
  scope: z.string().optional(),
  acceptance: z.string().optional(),
  allowedFiles: z.array(z.string()).optional(),
  forbiddenFiles: z.array(z.string()).optional(),
  dependsOn: z.array(z.string()).optional(),
  notes: z.string().optional(),
  assignee: z.string().nullable().optional()
});

export const listTasksSchema = z.object({
  project: z.string().nullable().optional(),
  status: taskStatusSchema.optional(),
  milestone: z.string().optional(),
  // T-context (owner's ask, 2026-08-23): answers "do I have any tasks?" --
  // "me" resolves to the caller's own identity (context.sessionUserId),
  // same as any other agent connection authenticated as a real person
  // (personal token, OAuth, or browser session). A member email/fragment
  // also works, same resolution task.create's own assignee field already
  // uses.
  assignee: z.string().optional(),
  // T-context (2026-09-02, owner's ask): distinct from `assignee` -- an
  // agent-executor is a self-declared name tied to an active task_claims
  // row (task.claim's `agent` param), not a real project member. Lets one
  // agent find what another agent (or itself) currently has claimed,
  // e.g. task.list({ claimedByAgent: "branch-pwa" }).
  claimedByAgent: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  compact: z.boolean().optional()
});

export const getTaskSchema = z.object({
  id: z.string().min(1)
});

export const nextTaskSchema = z.object({
  project: z.string().nullable().optional()
});

export const updateTaskStatusSchema = z.object({
  id: z.string().min(1),
  status: taskStatusSchema,
  note: z.string().optional(),
  force: z.boolean().optional(),
  reason: z.string().optional()
});

export const updateTaskMilestoneSchema = z.object({
  id: z.string().min(1),
  milestone: z.string().nullable()
});

export const updateTaskTitleSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1)
});

export const updateTaskPrioritySchema = z.object({
  id: z.string().min(1),
  priority: z.number().int()
});

export const updateTaskAssigneeSchema = z.object({
  id: z.string().min(1),
  assignee: z.string().nullable()
});

// T-MEMORY-110: backs the full task-editing form -- everything task.create
// can set except assignee (which already has its own dedicated tool/UI).
// Every field is optional and independently applied: omit a field to leave
// it untouched, pass null to clear milestone/scope/acceptance/notes. Present
// as one call so the form has a single Save action instead of firing one
// mutation per changed field.
export const updateTaskDetailsSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  milestone: z.string().nullable().optional(),
  priority: z.number().int().optional(),
  scope: z.string().nullable().optional(),
  acceptance: z.string().nullable().optional(),
  notes: z.string().nullable().optional()
});
