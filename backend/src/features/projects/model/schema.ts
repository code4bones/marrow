import * as z from "zod/v4";

export const projectStatusSchema = z.enum(["active", "paused", "archived"]);

export const createProjectSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  rootPath: z.string().optional()
});

export const projectLookupSchema = z
  .object({
    id: z.string().optional(),
    slug: z.string().optional()
  })
  .refine((value) => Boolean(value.id || value.slug), {
    message: "Either id or slug is required."
  });

export const listProjectsSchema = z.object({
  status: projectStatusSchema.optional(),
  compact: z.boolean().optional()
});
