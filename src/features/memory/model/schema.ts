import * as z from "zod/v4";

export const itemStatusSchema = z.enum(["active", "draft", "archived", "superseded", "rejected"]);

// Reused by decision.record too. Optional, additive: creates link.create
// edges atomically with the new record so the knowledge graph doesn't stay
// sparse (see I-MEMORY-022 step 2 — the graph and graph-based retrieval
// expansion are both useless without real edges).
export const recordLinksInputSchema = z
  .array(z.object({ toId: z.string().min(1), relation: z.string().min(1) }))
  .optional();

export const createMemorySchema = z.object({
  id: z.string().min(1).optional(),
  project: z.string().nullable().optional(),
  common: z.boolean().optional(),
  type: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  status: itemStatusSchema.optional(),
  tags: z.array(z.string()).optional(),
  // Curated TL;DR, preferred over both the raw body truncation and the KWIC
  // highlight in search results — see I-MEMORY-022 step 5. Optional: no
  // backfill requirement for existing records.
  summary: z.string().optional(),
  links: recordLinksInputSchema
});

export const updateMemorySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  status: itemStatusSchema.optional(),
  tags: z.array(z.string()).optional(),
  summary: z.string().optional()
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
