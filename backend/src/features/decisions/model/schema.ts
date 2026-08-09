import * as z from "zod/v4";
import { recordLinksInputSchema } from "../../memory/model/schema.js";

export const decisionStatusSchema = z.enum(["draft", "current", "superseded", "rejected", "archived"]);

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
  links: recordLinksInputSchema
});

export const listDecisionsSchema = z.object({
  project: z.string().nullable().optional(),
  includeCommon: z.boolean().optional(),
  status: decisionStatusSchema.optional(),
  limit: z.number().int().min(1).max(100).optional()
});

export const getDecisionSchema = z.object({
  id: z.string().min(1)
});
