import * as z from "zod/v4";

export const linkDirectionSchema = z.enum(["from", "to", "both"]);

export const createLinkSchema = z.object({
  project: z.string().nullable().optional(),
  fromId: z.string().min(1),
  toId: z.string().min(1),
  relation: z.string().min(1)
});

export const listLinksSchema = z.object({
  id: z.string().min(1),
  direction: linkDirectionSchema.optional()
});
