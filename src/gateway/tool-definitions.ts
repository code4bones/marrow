import * as z from "zod/v4";
import { getDecisionSchema, listDecisionsSchema, recordDecisionSchema } from "../features/decisions/model/schema.js";
import { listEventsSchema, recordEventSchema } from "../features/events/model/schema.js";
import { createLinkSchema, listLinksSchema } from "../features/links/model/schema.js";
import {
  createMemorySchema,
  getMemorySchema,
  searchMemorySchema,
  updateMemorySchema
} from "../features/memory/model/schema.js";
import { preflightSchema } from "../features/preflight/model/schema.js";
import { createProjectSchema, listProjectsSchema, projectLookupSchema } from "../features/projects/model/schema.js";
import {
  createTaskSchema,
  getTaskSchema,
  listTasksSchema,
  nextTaskSchema,
  updateTaskStatusSchema
} from "../features/tasks/model/schema.js";

export interface GatewayToolSpec {
  name: string;
  description: string;
  schema: z.ZodObject;
}

const emptySchema = z.object({});
const gatewayManualsSchema = z.object({
  audience: z.enum(["developer", "user", "agent", "all"]).optional(),
  includeContent: z.boolean().optional()
});
const memoryUpsertSchema = createMemorySchema.extend({
  match: z.enum(["id", "scope_type_title"]).optional()
});
const listGatewayClientsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional()
});
const artifactPutSchema = z.object({
  id: z.string().min(1).optional(),
  project: z.string().nullable().optional(),
  common: z.boolean().optional(),
  path: z.string().min(1),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  contentType: z.string().min(1).optional(),
  contentBase64: z.string().min(1),
  tags: z.array(z.string()).optional(),
  overwrite: z.boolean().optional()
});
const artifactSearchSchema = z.object({
  query: z.string().min(1).optional(),
  project: z.string().optional(),
  includeCommon: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(100).optional()
});
const artifactGetSchema = z
  .object({
    id: z.string().min(1).optional(),
    project: z.string().optional(),
    path: z.string().min(1).optional(),
    includeContent: z.boolean().optional(),
    maxBytes: z.number().int().min(1).max(5 * 1024 * 1024).optional()
  })
  .refine((value) => Boolean(value.id || value.path), {
    message: "Either id or path is required."
  });

export const gatewayToolSpecs: GatewayToolSpec[] = [
  {
    name: "gateway.about",
    description:
      "Explain what Project Memory (pmem) is, how agents should use it, and which first tools to call after connecting.",
    schema: emptySchema
  },
  {
    name: "gateway.version",
    description:
      "Return package version, storage mode, tool count, and gateway runtime identity. Use this to confirm which pmem build is connected.",
    schema: emptySchema
  },
  {
    name: "gateway.diagnostics",
    description:
      "Return safe gateway diagnostics including readiness, migrations, record counts, artifact settings, and logging settings without exposing secrets.",
    schema: emptySchema
  },
  {
    name: "gateway.manuals",
    description:
      "Return Project Memory Markdown manuals for developers/users and agents. Set includeContent=true when the caller needs the actual .md text.",
    schema: gatewayManualsSchema
  },
  {
    name: "gateway.status",
    description:
      "Return PostgreSQL gateway status, registered client count, and core record counts. Use this to confirm the shared memory gateway is reachable before collaboration workflows.",
    schema: emptySchema
  },
  {
    name: "gateway.clients",
    description:
      "List recently seen gateway clients. Use this to inspect which agents or developers are sharing the project memory gateway.",
    schema: listGatewayClientsSchema
  },
  {
    name: "project.create",
    description:
      "Create a durable shared project scope. In gateway mode this writes to PostgreSQL for all connected developers and agents.",
    schema: createProjectSchema
  },
  {
    name: "project.list",
    description: "List shared project scopes from the gateway database.",
    schema: listProjectsSchema
  },
  {
    name: "project.get",
    description: "Get a shared project by id or slug.",
    schema: projectLookupSchema
  },
  {
    name: "project.set_current",
    description: "Set the gateway current project used when project arguments are omitted.",
    schema: projectLookupSchema
  },
  {
    name: "project.current",
    description: "Return the gateway current project.",
    schema: listProjectsSchema.pick({})
  },
  {
    name: "memory.create",
    description: "Create a project or common memory item in the shared gateway database.",
    schema: createMemorySchema
  },
  {
    name: "memory.upsert",
    description:
      "Create or update a memory item idempotently. Match by id when provided, otherwise by scope + type + title to avoid duplicate shared records.",
    schema: memoryUpsertSchema
  },
  {
    name: "memory.get",
    description: "Get a memory item by id from shared gateway storage.",
    schema: getMemorySchema
  },
  {
    name: "memory.search",
    description: "Search shared memory using PostgreSQL full-text search across project and common records.",
    schema: searchMemorySchema
  },
  {
    name: "memory.update",
    description: "Update a shared memory item and record an event.",
    schema: updateMemorySchema
  },
  {
    name: "artifact.put",
    description:
      "Store or update a shared artifact file on the gateway. Content is base64 so agents can upload text files and binaries.",
    schema: artifactPutSchema
  },
  {
    name: "artifact.search",
    description: "Search shared artifact metadata and return download paths for matching files.",
    schema: artifactSearchSchema
  },
  {
    name: "artifact.get",
    description:
      "Get artifact metadata by id or project/path. Set includeContent=true for small files when the agent needs base64 content inline.",
    schema: artifactGetSchema
  },
  {
    name: "task.create",
    description: "Create a shared executable task for a project.",
    schema: createTaskSchema
  },
  {
    name: "task.list",
    description: "List shared tasks for a project.",
    schema: listTasksSchema
  },
  {
    name: "task.get",
    description: "Get a shared task by id.",
    schema: getTaskSchema
  },
  {
    name: "task.next",
    description: "Return the next shared todo task by priority and creation time.",
    schema: nextTaskSchema
  },
  {
    name: "task.update_status",
    description: "Update shared task status and record lifecycle event.",
    schema: updateTaskStatusSchema
  },
  {
    name: "decision.record",
    description: "Record a shared project or common decision.",
    schema: recordDecisionSchema
  },
  {
    name: "decision.list",
    description: "List shared project and common decisions.",
    schema: listDecisionsSchema
  },
  {
    name: "decision.get",
    description: "Get a shared decision by id.",
    schema: getDecisionSchema
  },
  {
    name: "event.record",
    description: "Record an append-only shared gateway event.",
    schema: recordEventSchema
  },
  {
    name: "event.list",
    description: "List shared gateway events.",
    schema: listEventsSchema
  },
  {
    name: "link.create",
    description: "Create a shared relationship between records.",
    schema: createLinkSchema
  },
  {
    name: "link.list",
    description: "List shared links for a record.",
    schema: listLinksSchema
  },
  {
    name: "preflight",
    description: "Return shared preflight context for a task before editing files.",
    schema: preflightSchema
  }
];
