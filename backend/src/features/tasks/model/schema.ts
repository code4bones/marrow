import * as z from "zod/v4";

export const taskStatusSchema = z.enum(["todo", "doing", "blocked", "done", "cancelled"]);

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
  notes: z.string().optional()
});

export const listTasksSchema = z.object({
  project: z.string().nullable().optional(),
  status: taskStatusSchema.optional(),
  milestone: z.string().optional(),
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
