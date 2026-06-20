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
  audience: z.enum(["developer", "user", "manual", "onboarding", "start", "first-run", "quickstart", "agent", "workflow", "all"]).optional(),
  includeContent: z.boolean().optional()
});
const memoryUpsertSchema = createMemorySchema.extend({
  match: z.enum(["id", "scope_type_title"]).optional()
});
const decisionSupersedeSchema = recordDecisionSchema.extend({
  supersedesId: z.string().min(1)
});
const failedAttemptRecordSchema = z.object({
  id: z.string().min(1).optional(),
  project: z.string().nullable().optional(),
  common: z.boolean().optional(),
  title: z.string().min(1),
  whatTried: z.string().min(1),
  whyFailed: z.string().min(1),
  doNotRepeat: z.string().min(1),
  betterNextApproach: z.string().min(1).optional(),
  relatedId: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  match: z.enum(["id", "scope_type_title"]).optional()
});
const listGatewayClientsSchema = z.object({
  anonymous: z.boolean().optional(),
  staleOlderThanSeconds: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100).optional()
});
const gatewayClientGetSchema = z.object({
  id: z.string().min(1)
});
const gatewayClientForgetSchema = z.object({
  id: z.string().min(1)
});
const gatewayClientPruneSchema = z.object({
  anonymousOnly: z.boolean().optional(),
  olderThanSeconds: z.number().int().min(0).optional(),
  dryRun: z.boolean().optional(),
  limit: z.number().int().min(1).max(1000).optional()
});
const projectResolveSchema = z
  .object({
    id: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    rootPath: z.string().min(1).optional(),
    remoteUrl: z.string().min(1).optional(),
    query: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(20).optional()
  })
  .refine((value) => Boolean(value.id || value.slug || value.title || value.rootPath || value.remoteUrl || value.query), {
    message: "At least one resolver field is required."
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
  includeArchived: z.boolean().optional(),
  status: z.enum(["active", "archived"]).optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(100).optional()
});
const artifactListSchema = z.object({
  project: z.string().nullable().optional(),
  common: z.boolean().optional(),
  includeCommon: z.boolean().optional(),
  pathPrefix: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  includeArchived: z.boolean().optional(),
  status: z.enum(["active", "archived"]).optional(),
  limit: z.number().int().min(1).max(200).optional()
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
const artifactUpdateMetadataSchema = z
  .object({
    id: z.string().min(1).optional(),
    project: z.string().nullable().optional(),
    path: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    tags: z.array(z.string()).optional()
  })
  .refine((value) => Boolean(value.id || value.path), {
    message: "Either id or path is required."
  })
  .refine(
    (value) => value.title !== undefined || value.description !== undefined || value.tags !== undefined,
    {
      message: "At least one metadata field is required."
    }
  );
const artifactArchiveSchema = z
  .object({
    id: z.string().min(1).optional(),
    project: z.string().nullable().optional(),
    path: z.string().min(1).optional(),
    reason: z.string().optional()
  })
  .refine((value) => Boolean(value.id || value.path), {
    message: "Either id or path is required."
  });
const preflightByQuerySchema = z.object({
  query: z.string().min(1),
  project: z.string().optional(),
  includeCommon: z.boolean().optional(),
  limits: z
    .object({
      decisions: z.number().int().min(1).max(50).optional(),
      items: z.number().int().min(1).max(50).optional(),
      failedAttempts: z.number().int().min(1).max(50).optional(),
      artifacts: z.number().int().min(1).max(50).optional(),
      events: z.number().int().min(1).max(50).optional()
    })
    .optional()
});
const handoffCreateSchema = z
  .object({
    project: z.string().nullable().optional(),
    title: z.string().min(1),
    taskId: z.string().min(1).optional(),
    workCompleted: z.array(z.string()).optional(),
    filesTouched: z.array(z.string()).optional(),
    blockers: z.array(z.string()).optional(),
    validation: z.array(z.string()).optional(),
    nextSteps: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional()
  })
  .refine(
    (value) =>
      Boolean(
        value.workCompleted?.length ||
          value.filesTouched?.length ||
          value.blockers?.length ||
          value.validation?.length ||
          value.nextSteps?.length
      ),
    {
      message: "At least one handoff section is required."
    }
  );

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
    name: "gateway.backup_manifest",
    description:
      "Return the safe backup surface for operators: PostgreSQL identity, required tables, artifact directory, counts, sizes, and migration state without exposing secrets.",
    schema: emptySchema
  },
  {
    name: "gateway.manuals",
    description:
      "Return Project Memory Markdown manuals for developers/users, onboarding, and agents. Set includeContent=true when the caller needs the actual .md text.",
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
      "List recently seen gateway clients. Filter anonymous or stale clients when inspecting shared gateway activity.",
    schema: listGatewayClientsSchema
  },
  {
    name: "gateway.client_get",
    description: "Get one gateway client by id, including metadata and current project key if present.",
    schema: gatewayClientGetSchema
  },
  {
    name: "gateway.client_forget",
    description:
      "Forget one gateway client and remove its current-project key. Use this for stale or renamed internal clients.",
    schema: gatewayClientForgetSchema
  },
  {
    name: "gateway.client_prune",
    description:
      "Prune stale gateway clients and matching current-project keys. Defaults to dry-run and anonymous-only cleanup.",
    schema: gatewayClientPruneSchema
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
    name: "project.resolve",
    description:
      "Resolve a likely project from id, slug, title, repository path, remote URL, or query. Returns candidates instead of guessing when ambiguous.",
    schema: projectResolveSchema
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
    name: "failed_attempt.record",
    description:
      "Record a failed attempt/fault as first-class searchable memory. Captures what was tried, why it failed, what not to repeat, and optional better next approach.",
    schema: failedAttemptRecordSchema
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
      "Store or update a shared artifact file on the gateway. Content is base64 so agents can upload text files and binaries. Existing scope/path conflicts return ARTIFACT_CONFLICT unless overwrite=true.",
    schema: artifactPutSchema
  },
  {
    name: "artifact.search",
    description: "Search shared artifact metadata and return download paths for matching files.",
    schema: artifactSearchSchema
  },
  {
    name: "artifact.list",
    description: "List artifacts by project/common scope, path prefix, tags, and lifecycle status for navigation.",
    schema: artifactListSchema
  },
  {
    name: "artifact.get",
    description:
      "Get artifact metadata by id or project/path. Set includeContent=true for small files when the agent needs base64 content inline.",
    schema: artifactGetSchema
  },
  {
    name: "artifact.update_metadata",
    description: "Update artifact title, description, and tags without re-uploading bytes.",
    schema: artifactUpdateMetadataSchema
  },
  {
    name: "artifact.archive",
    description: "Archive an artifact without deleting bytes. Archived artifacts are hidden from default search.",
    schema: artifactArchiveSchema
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
    name: "decision.supersede",
    description:
      "Create a replacement decision in the same scope, mark the old decision as superseded, and record link/event history.",
    schema: decisionSupersedeSchema
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
    description: "Return shared preflight context for a task before editing files, including knownFaults that should stop repeated mistakes.",
    schema: preflightSchema
  },
  {
    name: "preflight.by_query",
    description:
      "Return preflight-like shared context for ad-hoc work before a task exists. Includes decisions, memory, knownFaults, artifacts, and recent events.",
    schema: preflightByQuerySchema
  },
  {
    name: "handoff.create",
    description:
      "Create a compact shared handoff for another agent: work completed, files touched, blockers, validation, and next steps.",
    schema: handoffCreateSchema
  }
];
