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
  outputSchema?: z.ZodType;
}

const emptySchema = z.object({});
const gatewayManualsSchema = z.object({
  audience: z
    .enum([
      "developer",
      "user",
      "manual",
      "onboarding",
      "start",
      "first-run",
      "quickstart",
      "agent",
      "workflow",
      "conventions",
      "collaboration",
      "all"
    ])
    .optional(),
  includeContent: z.boolean().optional()
});
const memoryUpsertSchema = createMemorySchema.extend({
  match: z.enum(["id", "scope_type_title"]).optional()
});
const memoryHygieneReportSchema = z.object({
  project: z.string().nullable().optional(),
  includeCommon: z.boolean().optional(),
  largeBodyChars: z.number().int().min(500).max(200_000).optional(),
  staleDays: z.number().int().min(1).max(3650).optional(),
  limit: z.number().int().min(1).max(100).optional()
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
const projectSummarySchema = z.object({
  project: z.string().optional(),
  query: z.string().min(1).optional(),
  includeCommon: z.boolean().optional(),
  limits: z
    .object({
      tasks: z.number().int().min(1).max(50).optional(),
      decisions: z.number().int().min(1).max(50).optional(),
      faults: z.number().int().min(1).max(50).optional(),
      handoffs: z.number().int().min(1).max(20).optional(),
      artifacts: z.number().int().min(1).max(50).optional(),
      memory: z.number().int().min(1).max(50).optional(),
      events: z.number().int().min(1).max(50).optional()
    })
    .optional()
});
const contextChangedSinceSchema = z.object({
  project: z.string().nullable().optional(),
  since: z.string().min(1),
  includeCommon: z.boolean().optional(),
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
const artifactPutTextSchema = z.object({
  id: z.string().min(1).optional(),
  project: z.string().nullable().optional(),
  common: z.boolean().optional(),
  path: z.string().min(1),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  contentType: z.string().min(1).optional(),
  text: z.string(),
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
const artifactPeekSchema = z
  .object({
    id: z.string().min(1).optional(),
    project: z.string().optional(),
    path: z.string().min(1).optional(),
    maxBytes: z.number().int().min(1).max(512 * 1024).optional(),
    excerptChars: z.number().int().min(1).max(20000).optional(),
    outlineLimit: z.number().int().min(1).max(100).optional()
  })
  .refine((value) => Boolean(value.id || value.path), {
    message: "Either id or path is required."
  });
const artifactReadTextSchema = z
  .object({
    id: z.string().min(1).optional(),
    project: z.string().optional(),
    path: z.string().min(1).optional(),
    maxBytes: z.number().int().min(1).max(512 * 1024).optional(),
    maxChars: z.number().int().min(1).max(100_000).optional(),
    maxLines: z.number().int().min(1).max(5000).optional(),
    outlineLimit: z.number().int().min(1).max(100).optional(),
    redactSecrets: z.boolean().optional()
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
const contextPackSchema = z
  .object({
    taskId: z.string().min(1).optional(),
    query: z.string().min(1).optional(),
    project: z.string().optional(),
    includeCommon: z.boolean().optional(),
    mode: z.enum(["brief", "normal", "deep"]).optional(),
    profile: z.enum(["general", "implement", "review", "deploy", "chatgpt", "onboarding"]).optional(),
    tokenBudget: z.number().int().min(500).max(20000).optional(),
    limits: z
      .object({
        decisions: z.number().int().min(1).max(50).optional(),
        items: z.number().int().min(1).max(50).optional(),
        failedAttempts: z.number().int().min(1).max(50).optional(),
        artifacts: z.number().int().min(1).max(50).optional(),
        events: z.number().int().min(1).max(50).optional(),
        handoffs: z.number().int().min(1).max(20).optional()
      })
      .optional()
  })
  .refine((value) => Boolean(value.taskId || value.query), {
    message: "Either taskId or query is required."
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
const handoffLatestSchema = z.object({
  project: z.string().nullable().optional(),
  includeCommon: z.boolean().optional(),
  includeContent: z.boolean().optional(),
  limit: z.number().int().min(1).max(20).optional()
});
const handoffSearchSchema = z.object({
  query: z.string().min(1),
  project: z.string().optional(),
  includeCommon: z.boolean().optional(),
  includeContent: z.boolean().optional(),
  limit: z.number().int().min(1).max(50).optional()
});

const looseRecordSchema = z.object({}).catchall(z.unknown());
const errorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: looseRecordSchema.optional()
});
const defaultOutputDataSchema = z.any();
export const defaultGatewayOutputSchema = toolOutputSchema(defaultOutputDataSchema);

const artifactSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  scope: z.enum(["project", "common"]),
  path: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  sha256: z.string(),
  tags: z.array(z.string()),
  downloadPath: z.string(),
  archivedAt: z.string().nullable(),
  archivedBy: z.string().nullable(),
  archiveReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
const artifactWithContentSchema = artifactSchema.extend({
  contentBase64: z.string().optional()
});
const artifactSearchResultSchema = artifactSchema.extend({
  rank: z.number()
});
const markdownOutlineItemSchema = z.object({
  level: z.number(),
  title: z.string(),
  line: z.number()
});
const artifactPreviewSchema = artifactSchema.extend({
  preview: z.object({
    isText: z.boolean(),
    isMarkdown: z.boolean(),
    truncated: z.boolean(),
    readBytes: z.number().optional(),
    maxBytes: z.number().optional(),
    excerpt: z.string().nullable(),
    outline: z.array(markdownOutlineItemSchema),
    note: z.string().optional()
  })
});
const artifactReadTextSchemaOut = artifactSchema.extend({
  text: z.string(),
  textInfo: z.object({
    isText: z.boolean(),
    isMarkdown: z.boolean(),
    encoding: z.string(),
    readBytes: z.number(),
    maxBytes: z.number(),
    maxChars: z.number(),
    maxLines: z.number(),
    truncated: z.boolean(),
    truncatedByBytes: z.boolean(),
    truncatedByChars: z.boolean(),
    truncatedByLines: z.boolean(),
    redacted: z.boolean(),
    redactions: z.number(),
    base64Included: z.literal(false)
  }),
  outline: z.array(markdownOutlineItemSchema)
});
const eventLikeSchema = looseRecordSchema.nullable();
const nextCallSchema = z.object({
  tool: z.string(),
  input: looseRecordSchema,
  reason: z.string()
});
const compactArtifactSchema = z.object({
  id: z.string(),
  scope: z.string(),
  path: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  contentType: z.string(),
  sizeBytes: z.number(),
  tags: z.array(z.string()),
  downloadPath: z.string(),
  preferredNextTool: z.string()
});
const projectSummaryDataSchema = z.object({
  summary: z.string(),
  budget: looseRecordSchema,
  project: looseRecordSchema,
  query: z.string(),
  includeCommon: z.boolean(),
  counts: looseRecordSchema,
  openTasks: z.array(looseRecordSchema),
  handoffs: z.array(looseRecordSchema),
  decisions: z.array(looseRecordSchema),
  knownFaults: z.array(looseRecordSchema),
  artifacts: z.array(compactArtifactSchema),
  memory: z.array(looseRecordSchema),
  recentEvents: z.array(looseRecordSchema),
  nextCalls: z.array(nextCallSchema)
});
const contextPackDataSchema = z.object({
  summary: z.string(),
  budget: looseRecordSchema,
  project: looseRecordSchema.nullable().optional(),
  task: looseRecordSchema.nullable().optional(),
  query: z.string(),
  mustRead: z.array(looseRecordSchema),
  handoffs: z.array(looseRecordSchema),
  decisions: z.array(looseRecordSchema),
  knownFaults: z.array(looseRecordSchema),
  memory: z.array(looseRecordSchema),
  artifacts: z.array(compactArtifactSchema),
  recentEvents: z.array(looseRecordSchema),
  nextCalls: z.array(nextCallSchema)
});
const preflightByQueryDataSchema = z.object({
  project: looseRecordSchema.nullable().optional(),
  query: z.string(),
  relevantDecisions: z.array(looseRecordSchema),
  commonRules: z.array(looseRecordSchema),
  relatedItems: z.array(looseRecordSchema),
  failedAttempts: z.array(looseRecordSchema),
  knownFaults: z.array(looseRecordSchema),
  artifacts: z.array(looseRecordSchema),
  recentEvents: z.array(looseRecordSchema),
  summary: z.string()
});

function toolOutputSchema(dataSchema: z.ZodType): z.ZodType {
  return z.object({
    ok: z.boolean(),
    summary: z.string().optional(),
    data: dataSchema.optional(),
    error: errorSchema.optional()
  });
}

function output(dataSchema: z.ZodType): z.ZodType {
  return toolOutputSchema(dataSchema);
}

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
    name: "project.summary",
    description:
      "Return a compact token-conscious project state card: open tasks, recent handoffs, decisions, known faults, artifacts, memory, events, and next calls.",
    schema: projectSummarySchema,
    outputSchema: output(projectSummaryDataSchema)
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
    name: "memory.hygiene_report",
    description:
      "Return compact memory quality signals for project/common scope: large records, stale active records, duplicate title groups, and suggested next calls.",
    schema: memoryHygieneReportSchema
  },
  {
    name: "artifact.put",
    description:
      "Store or update a shared artifact file on the gateway from base64 bytes. Use this for binary files or exact byte transport; prefer artifact.put_text for Markdown/text. Existing scope/path conflicts return ARTIFACT_CONFLICT unless overwrite=true.",
    schema: artifactPutSchema,
    outputSchema: output(z.object({ artifact: artifactSchema }))
  },
  {
    name: "artifact.put_text",
    description:
      "Store or update a shared UTF-8 text/Markdown artifact on the gateway without base64. Prefer this for templates, docs, handoffs, and other text files. Existing scope/path conflicts return ARTIFACT_CONFLICT unless overwrite=true.",
    schema: artifactPutTextSchema,
    outputSchema: output(z.object({ artifact: artifactSchema }))
  },
  {
    name: "artifact.search",
    description: "Search shared artifact metadata and return download paths for matching files.",
    schema: artifactSearchSchema,
    outputSchema: output(z.object({ results: z.array(artifactSearchResultSchema) }))
  },
  {
    name: "artifact.list",
    description: "List artifacts by project/common scope, path prefix, tags, and lifecycle status for navigation.",
    schema: artifactListSchema,
    outputSchema: output(z.object({ artifacts: z.array(artifactSchema) }))
  },
  {
    name: "artifact.get",
    description:
      "Get artifact metadata by id or project/path. Set includeContent=true for small files when the agent needs base64 content inline.",
    schema: artifactGetSchema,
    outputSchema: output(z.object({ artifact: artifactWithContentSchema }))
  },
  {
    name: "artifact.peek",
    description:
      "Get a compact artifact preview without base64 content. Text/Markdown artifacts return an excerpt and outline; binary artifacts return metadata only. Prefer artifact.read_text when text content is needed.",
    schema: artifactPeekSchema,
    outputSchema: output(z.object({ artifact: artifactPreviewSchema }))
  },
  {
    name: "artifact.read_text",
    description:
      "Read bounded UTF-8 text from a text/Markdown artifact without base64 content. Prefer this for ChatGPT and other agents that need artifact text in model context.",
    schema: artifactReadTextSchema,
    outputSchema: output(z.object({ artifact: artifactReadTextSchemaOut }))
  },
  {
    name: "artifact.update_metadata",
    description: "Update artifact title, description, and tags without re-uploading bytes.",
    schema: artifactUpdateMetadataSchema,
    outputSchema: output(z.object({ artifact: artifactSchema }))
  },
  {
    name: "artifact.archive",
    description: "Archive an artifact without deleting bytes. Archived artifacts are hidden from default search.",
    schema: artifactArchiveSchema,
    outputSchema: output(z.object({ action: z.string(), artifact: artifactSchema, event: eventLikeSchema }))
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
    schema: preflightByQuerySchema,
    outputSchema: output(preflightByQueryDataSchema)
  },
  {
    name: "context.pack",
    description:
      "Build a compact token-conscious start-of-work context package for a task or query. Returns summaries, stop-signals, pointers, and next tool calls instead of full record bodies or base64 content.",
    schema: contextPackSchema,
    outputSchema: output(contextPackDataSchema)
  },
  {
    name: "context.changed_since",
    description:
      "Return compact project/common changes since an ISO timestamp cursor so agents can refresh context without broad reloads.",
    schema: contextChangedSinceSchema
  },
  {
    name: "handoff.create",
    description:
      "Create a compact shared handoff for another agent: work completed, files touched, blockers, validation, and next steps.",
    schema: handoffCreateSchema
  },
  {
    name: "handoff.latest",
    description:
      "Return recent compact handoffs for the current/project/common scope. Use this as the first continuation point before broad memory search.",
    schema: handoffLatestSchema
  },
  {
    name: "handoff.search",
    description: "Search handoff records by query and return compact continuation summaries by default.",
    schema: handoffSearchSchema
  }
];
