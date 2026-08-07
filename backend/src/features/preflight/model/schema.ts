import * as z from "zod/v4";

export const preflightSchema = z.object({
  taskId: z.string().min(1),
  includeCommon: z.boolean().optional(),
  limits: z
    .object({
      decisions: z.number().int().min(1).max(50).optional(),
      items: z.number().int().min(1).max(50).optional(),
      failedAttempts: z.number().int().min(1).max(50).optional(),
      events: z.number().int().min(1).max(50).optional()
    })
    .optional()
});
