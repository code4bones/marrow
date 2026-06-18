import * as z from "zod/v4";

export const itemStatusSchema = z.enum(["active", "draft", "archived", "superseded", "rejected"]);

export const createMemorySchema = z.object({
  project: z.string().nullable().optional(),
  common: z.boolean().optional(),
  type: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  status: itemStatusSchema.optional(),
  tags: z.array(z.string()).optional()
});

export const updateMemorySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  status: itemStatusSchema.optional(),
  tags: z.array(z.string()).optional()
});

export const getMemorySchema = z.object({
  id: z.string().min(1)
});

export const searchMemorySchema = z.object({
  query: z.string().min(1),
  project: z.string().optional(),
  includeCommon: z.boolean().optional(),
  type: z.string().optional(),
  status: itemStatusSchema.optional(),
  limit: z.number().int().min(1).max(100).optional()
});
