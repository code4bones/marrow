import * as z from "zod/v4";

export const recordEventSchema = z.object({
  project: z.string().nullable().optional(),
  type: z.string().min(1),
  title: z.string().optional(),
  body: z.string().optional(),
  relatedId: z.string().optional()
});

export const listEventsSchema = z.object({
  project: z.string().nullable().optional(),
  relatedId: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional()
});
