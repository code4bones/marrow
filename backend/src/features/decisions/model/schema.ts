import * as z from "zod/v4";
import { recordLinksInputSchema } from "../../memory/model/schema.js";

export const decisionStatusSchema = z.enum(["draft", "accepted", "superseded", "rejected", "archived"]);

export const recordDecisionSchema = z.object({
  project: z.string().nullable().optional(),
  title: z.string().min(1),
  status: decisionStatusSchema.optional(),
  context: z.string().optional(),
  decision: z.string().min(1),
  rationale: z.string().optional(),
  consequences: z.string().optional(),
  tags: z.array(z.string()).optional(),
  supersedesId: z.string().nullable().optional(),
  summary: z.string().optional(),
  milestone: z.string().optional(),
  assignee: z.string().nullable().optional(),
  links: recordLinksInputSchema
});

export const listDecisionsSchema = z.object({
  project: z.string().nullable().optional(),
  includeCommon: z.boolean().optional(),
  status: decisionStatusSchema.optional(),
  milestone: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional()
});

export const getDecisionSchema = z.object({
  id: z.string().min(1)
});

// "superseded" deliberately excluded — that transition only happens as a
// side effect of decision.supersede (paired with the new decision + the
// supersedes link), never as a standalone status flip.
export const updateDecisionStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["draft", "accepted", "rejected", "archived"]),
  reason: z.string().optional()
});

export const updateDecisionMilestoneSchema = z.object({
  id: z.string().min(1),
  milestone: z.string().nullable()
});

export const updateDecisionAssigneeSchema = z.object({
  id: z.string().min(1),
  assignee: z.string().nullable()
});
