import * as z from "zod/v4";

export const itemStatusSchema = z.enum(["current", "draft", "archived", "superseded", "rejected"]);

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
  // T-context (2026-08-25): was z.string().min(1) -- the handler
  // (memory.mixin.ts searchMemory) already treated a missing/blank query as
  // "browse by type/status, most-recent-first" rather than a hard error
  // (project.summary's own knownFaults call relies on exactly that), but the
  // public schema didn't allow the empty case, so a type-only browse (e.g.
  // the Faults page listing failed_attempt records with no search term) had
  // to fake a query string, which then silently hid any real record whose
  // text didn't happen to match it. Optional now to match what the handler
  // already does.
  query: z.string().optional(),
  project: z.string().nullable().optional(),
  includeCommon: z.boolean().optional(),
  type: z.string().optional(),
  status: itemStatusSchema.optional(),
  limit: z.number().int().min(1).max(100).optional()
});
