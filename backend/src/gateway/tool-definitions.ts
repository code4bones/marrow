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
  access?: "read" | "write" | "admin";
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
  supersedesId: z.string().min(1),
  // Required here (unlike plain decision.record) — I-PMEM-010: the graph/
  // timeline visualization has nothing to render on a supersede edge without
  // a reason ("отвергли из-за X"), and decision.supersede already has a
  // dedicated rationale-shaped slot in its schema, unlike a bare status flip.
  rationale: z.string().min(1)
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
  limit: z.number().int().min(1).max(100).optional(),
  compact: z.boolean().optional()
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
const projectDeleteSchema = projectLookupSchema.extend({
  cascade: z.boolean().optional(),
  reason: z.string().optional()
});
const updateProjectSchema = projectLookupSchema.extend({
  title: z.string().min(1).optional(),
  description: z.string().optional()
});
const projectInviteClaimSchema = z.object({
  code: z.string().min(1)
});
const projectSummarySchema = z.object({
  project: z.string().nullable().optional(),
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
const taskDeleteSchema = getTaskSchema.extend({
  reason: z.string().optional()
});
const taskClaimRoleSchema = z.enum(["backend", "frontend", "test", "docs", "review", "devops", "coordination", "other"]);
const taskClaimSchema = z.object({
  taskId: z.string().min(1),
  role: taskClaimRoleSchema.optional(),
  scope: z.string().min(1).optional(),
  note: z.string().optional(),
  leaseSeconds: z.number().int().min(60).max(86_400).optional()
});
const taskClaimIdSchema = z.object({
  claimId: z.string().min(1),
  note: z.string().optional(),
  leaseSeconds: z.number().int().min(60).max(86_400).optional()
});
const taskClaimsSchema = z.object({
  taskId: z.string().min(1),
  includeInactive: z.boolean().optional()
});
const taskCompleteSchema = z.object({
  id: z.string().min(1),
  claimId: z.string().min(1).optional(),
  acceptanceEvidence: z.string().min(1).optional(),
  force: z.boolean().optional(),
  reason: z.string().optional()
});
const taskNoteSchema = z.object({
  taskId: z.string().min(1),
  type: z.enum(["implementation_note", "handoff", "test_result", "review_note", "coordination_note"]).optional(),
  title: z.string().min(1).optional(),
  body: z.string().min(1),
  tags: z.array(z.string()).optional(),
  relation: z.string().min(1).optional()
});
const idReasonSchema = z.object({
  id: z.string().min(1),
  reason: z.string().optional()
});
const memoryArchiveSchema = idReasonSchema;
const memoryDeleteSchema = idReasonSchema;
const decisionArchiveSchema = idReasonSchema;
const decisionDeleteSchema = idReasonSchema;
const eventDeleteSchema = idReasonSchema;
const linkDeleteSchema = idReasonSchema;
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
  project: z.string().nullable().optional(),
  includeCommon: z.boolean().optional(),
  includeArchived: z.boolean().optional(),
  status: z.enum(["active", "archived"]).optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  compact: z.boolean().optional()
});
const artifactListSchema = z.object({
  project: z.string().nullable().optional(),
  common: z.boolean().optional(),
  includeCommon: z.boolean().optional(),
  pathPrefix: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  includeArchived: z.boolean().optional(),
  status: z.enum(["active", "archived"]).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  compact: z.boolean().optional()
});
const artifactGetSchema = z
  .object({
    id: z.string().min(1).optional(),
    project: z.string().nullable().optional(),
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
    project: z.string().nullable().optional(),
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
    project: z.string().nullable().optional(),
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
const artifactDeleteSchema = artifactArchiveSchema;
const preflightByQuerySchema = z.object({
  query: z.string().min(1),
  project: z.string().nullable().optional(),
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
    project: z.string().nullable().optional(),
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
  project: z.string().nullable().optional(),
  includeCommon: z.boolean().optional(),
  includeContent: z.boolean().optional(),
  limit: z.number().int().min(1).max(50).optional()
});

// T-MEMORY-044: git host credentials (GitLab PATs today) + a read-only
// pipeline-status proxy. All four tools require a browser session
// (context.sessionUserId) regardless of scope tier -- see the
// "session-based only" note on git.credential_create's access below and
// docs/AUTH.md's "Git host credentials" section for why (mirrors
// T-MEMORY-042's WS-subscriptions-are-session-only precedent: there is no
// resolved "which human does this OAuth-connected agent act on behalf of"
// answer yet, so these tools refuse to guess rather than operate on
// nobody's/the-wrong-person's credentials).
const gitCredentialCreateSchema = z.object({
  host: z.string().min(1),
  label: z.string().min(1),
  token: z.string().min(1)
});
const gitCredentialDeleteSchema = z.object({
  id: z.string().min(1)
});
const gitPipelineStatusSchema = z.object({
  host: z.string().min(1),
  project: z.string().min(1),
  ref: z.string().min(1).optional()
});

const looseRecordSchema = z.object({}).catchall(z.unknown());
const errorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: looseRecordSchema.optional()
});
const efficiencyHintsSchema = z
  .object({
    rule: z.string(),
    severity: z.enum(["info", "warn"]),
    strategy: z.string(),
    fullBodiesIncluded: z.boolean(),
    base64Included: z.boolean(),
    estimatedChars: z.number().optional(),
    warnings: z.array(z.string()),
    preferredNextTools: z.array(z.string()).optional(),
    compactAfterThis: z.boolean().optional()
  })
  .catchall(z.unknown());
const defaultOutputDataSchema = z.any();
export const defaultGatewayOutputSchema = toolOutputSchema(defaultOutputDataSchema);

const artifactSchema = z
  .object({
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
  })
  .catchall(z.unknown());
const artifactWithContentSchema = artifactSchema.extend({
  contentBase64: z.string().optional()
});
const artifactOutputDataSchema = z.object({
  artifact: artifactSchema,
  efficiencyHints: efficiencyHintsSchema.optional()
});
const artifactWithContentOutputDataSchema = z.object({
  artifact: artifactWithContentSchema,
  efficiencyHints: efficiencyHintsSchema.optional()
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
const artifactPreviewOutputDataSchema = z.object({
  artifact: artifactPreviewSchema,
  efficiencyHints: efficiencyHintsSchema.optional()
});
const artifactReadTextOutputDataSchema = z.object({
  artifact: artifactReadTextSchemaOut,
  efficiencyHints: efficiencyHintsSchema.optional()
});
const eventLikeSchema = looseRecordSchema.nullable();
const taskClaimOutSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    projectId: z.string(),
    clientId: z.string(),
    clientLabel: z.string().nullable(),
    clientKind: z.string().nullable(),
    role: z.string(),
    scope: z.string().nullable(),
    status: z.string(),
    leaseExpiresAt: z.string(),
    heartbeatAt: z.string(),
    note: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string()
  })
  .catchall(z.unknown());
const taskClaimResultSchema = z.object({
  claim: taskClaimOutSchema,
  task: looseRecordSchema.optional(),
  event: eventLikeSchema.optional()
});
const taskNoteResultSchema = z.object({
  item: looseRecordSchema,
  link: looseRecordSchema,
  event: eventLikeSchema
});
const deleteCountsSchema = z.object({
  tasks: z.number(),
  taskClaims: z.number().optional(),
  items: z.number(),
  decisions: z.number(),
  links: z.number(),
  events: z.number(),
  artifacts: z.number(),
  currentProjectKeys: z.number().optional()
});
const archiveRecordSchema = z.object({
  action: z.string(),
  event: eventLikeSchema
}).catchall(z.unknown());
const deleteRecordSchema = z.object({
  event: eventLikeSchema.optional(),
  deletedLinks: z.number().optional()
}).catchall(z.unknown());
const nextCallSchema = z
  .object({
    tool: z.string(),
    input: looseRecordSchema,
    reason: z.string()
  })
  .catchall(z.unknown());
const compactArtifactSchema = z
  .object({
    id: z.string(),
    scope: z.string(),
    path: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    status: z.enum(["active", "archived"]).optional(),
    contentType: z.string(),
    sizeBytes: z.number(),
    tags: z.array(z.string()),
    downloadPath: z.string(),
    preferredNextTool: z.string()
  })
  .catchall(z.unknown());
const artifactListItemSchema = z.union([artifactSchema, compactArtifactSchema]);
const artifactSearchItemSchema = z.union([artifactSearchResultSchema, compactArtifactSchema.extend({ rank: z.number().optional() })]);
const projectSummaryDataSchema = z
  .object({
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
    nextCalls: z.array(nextCallSchema),
    efficiencyHints: efficiencyHintsSchema.optional()
  })
  .catchall(z.unknown());
const contextPackDataSchema = z
  .object({
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
    nextCalls: z.array(nextCallSchema),
    efficiencyHints: efficiencyHintsSchema.optional()
  })
  .catchall(z.unknown());
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
  summary: z.string(),
  efficiencyHints: efficiencyHintsSchema.optional()
});

// T-MEMORY-044: the token itself is NEVER part of this shape, on any
// tool's output -- create, list, and delete all resolve through this same
// schema (or a superset of it) so there is exactly one place a stray
// `token` field could slip back into a response, and it isn't here.
const gitCredentialOutSchema = z
  .object({
    id: z.string(),
    host: z.string(),
    label: z.string(),
    createdAt: z.string(),
    updatedAt: z.string().optional(),
    lastUsedAt: z.string().nullable().optional(),
    // Last 4 characters only, for UI recognition -- never enough to
    // reconstruct the token. Optional/omitted on the create response since
    // the caller just typed the token in and doesn't need a reminder.
    tokenHint: z.string().optional()
  })
  .catchall(z.unknown());
const gitPipelineJobSchema = z.object({
  name: z.string(),
  status: z.string()
});
const gitPipelineStatusOutSchema = z.object({
  status: z.string(),
  ref: z.string(),
  sha: z.string(),
  webUrl: z.string(),
  jobs: z.array(gitPipelineJobSchema)
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
    name: "gateway.connector_info",
    description:
      "Return this deployment's OAuth connector setup info (MCP URL, OAuth client id/secret) so any logged-in user can self-serve connecting their own Claude/ChatGPT connector, without an operator reading .env for them. Unlike gateway.diagnostics, this intentionally includes a real secret value (the OAuth client secret) -- see gatewayConnectorInfo()'s own comment for why that's safe here.",
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
      "Return Project Memory manual metadata by default. Set includeContent=true only when the caller needs the actual Markdown text in context.",
    schema: gatewayManualsSchema,
    outputSchema: output(z.object({ manuals: z.array(looseRecordSchema), efficiencyHints: efficiencyHintsSchema }))
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
      "List recently seen gateway clients for diagnostics/collaboration audit. Not part of normal coding flow; default limit is small and compact=true returns selection fields only.",
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
    schema: gatewayClientForgetSchema,
    access: "admin"
  },
  {
    name: "gateway.client_prune",
    description:
      "Prune stale gateway clients and matching current-project keys. Defaults to dry-run and anonymous-only cleanup.",
    schema: gatewayClientPruneSchema,
    access: "admin"
  },
  {
    name: "project.create",
    description:
      "Create a durable shared project scope. In gateway mode this writes to PostgreSQL for all connected developers and agents.",
    schema: createProjectSchema,
    access: "write"
  },
  {
    name: "project.list",
    description: "List shared project scopes from the gateway database. Use compact=true for low-token project selection.",
    schema: listProjectsSchema
  },
  {
    name: "project.get",
    description: "Get a shared project by id or slug.",
    schema: projectLookupSchema
  },
  {
    name: "project.update",
    description:
      "Rename a shared project (title/description). Any current project member (or admin) can rename -- there is no separate per-project owner concept.",
    schema: updateProjectSchema,
    access: "write"
  },
  {
    name: "project.invite_link_get",
    description:
      "Get this project's reusable invite link, lazily creating it on first request. Any current project member (or admin) can share it -- opening the link and joining adds the project to whoever opens it.",
    schema: projectLookupSchema,
    outputSchema: output(z.object({ code: z.string(), url: z.string() })),
    access: "write"
  },
  {
    name: "project.invite_link_regenerate",
    description:
      "Replace this project's invite link with a new code, invalidating the old one immediately (like regenerating a Slack workspace invite link, not a single-use token).",
    schema: projectLookupSchema,
    outputSchema: output(z.object({ code: z.string(), url: z.string() })),
    access: "write"
  },
  {
    name: "project.invite_claim",
    description:
      "Join a project by its invite code. Requires a logged-in session or personal API token; idempotent -- claiming an already-joined project is a no-op, not an error.",
    schema: projectInviteClaimSchema,
    outputSchema: output(z.object({ project: looseRecordSchema, joined: z.boolean() })),
    access: "write"
  },
  {
    name: "project.delete",
    description:
      "Hard-delete a shared project by id or slug. Refuses non-empty projects unless cascade=true. Use only after an explicit user request.",
    schema: projectDeleteSchema,
    outputSchema: output(z.object({ deletedProject: looseRecordSchema, cascade: z.boolean(), counts: deleteCountsSchema })),
    access: "admin"
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
    schema: projectLookupSchema,
    access: "write"
  },
  {
    name: "project.current",
    description: "Return the gateway current project.",
    schema: listProjectsSchema.pick({})
  },
  {
    name: "memory.create",
    description: "Create a project or common memory item in the shared gateway database.",
    schema: createMemorySchema,
    access: "write"
  },
  {
    name: "memory.upsert",
    description:
      "Create or update a memory item idempotently. Match by id when provided, otherwise by scope + type + title to avoid duplicate shared records.",
    schema: memoryUpsertSchema,
    access: "write"
  },
  {
    name: "failed_attempt.record",
    description:
      "Record a failed attempt/fault as first-class searchable memory. Captures what was tried, why it failed, what not to repeat, and optional better next approach.",
    schema: failedAttemptRecordSchema,
    access: "write"
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
    schema: updateMemorySchema,
    access: "write"
  },
  {
    name: "memory.archive",
    description: "Archive a shared memory item without deleting it. Prefer this before hard delete for durable project knowledge.",
    schema: memoryArchiveSchema,
    outputSchema: output(archiveRecordSchema.extend({ memory: looseRecordSchema })),
    access: "write"
  },
  {
    name: "memory.delete",
    description: "Hard-delete a shared memory item and cleanup links that point to it. Use only after an explicit user request.",
    schema: memoryDeleteSchema,
    outputSchema: output(deleteRecordSchema.extend({ deletedMemory: looseRecordSchema })),
    access: "admin"
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
    outputSchema: output(artifactOutputDataSchema),
    access: "write"
  },
  {
    name: "artifact.put_text",
    description:
      "Store or update a shared UTF-8 text/Markdown artifact on the gateway without base64. Prefer this for templates, docs, handoffs, and other text files. Existing scope/path conflicts return ARTIFACT_CONFLICT unless overwrite=true.",
    schema: artifactPutTextSchema,
    outputSchema: output(artifactOutputDataSchema),
    access: "write"
  },
  {
    name: "artifact.search",
    description:
      "Search shared artifact metadata and return pointers for matching files. Prefer this over broad artifact.list; use compact=true for low-token selection results, then artifact.peek/read_text only for the chosen artifact.",
    schema: artifactSearchSchema,
    outputSchema: output(z.object({ results: z.array(artifactSearchItemSchema) }))
  },
  {
    name: "artifact.list",
    description:
      "Browse artifacts by scope/path/tags for navigation. Keep limits low and use compact=true unless full metadata is needed; prefer artifact.search for targeted lookup.",
    schema: artifactListSchema,
    outputSchema: output(z.object({ artifacts: z.array(artifactListItemSchema) }))
  },
  {
    name: "artifact.get",
    description:
      "Get artifact metadata by id or project/path. Set includeContent=true for small files when the agent needs base64 content inline.",
    schema: artifactGetSchema,
    outputSchema: output(artifactWithContentOutputDataSchema)
  },
  {
    name: "artifact.peek",
    description:
      "Get a compact artifact preview without base64 content. Defaults keep excerpts small; increase excerptChars only when needed, and use artifact.read_text only after selecting a specific artifact.",
    schema: artifactPeekSchema,
    outputSchema: output(artifactPreviewOutputDataSchema)
  },
  {
    name: "artifact.read_text",
    description:
      "Read bounded UTF-8 text from one selected text/Markdown artifact without base64 content. This can be token-expensive; set maxChars/maxLines and compact the chat after large reads.",
    schema: artifactReadTextSchema,
    outputSchema: output(artifactReadTextOutputDataSchema)
  },
  {
    name: "artifact.update_metadata",
    description: "Update artifact title, description, and tags without re-uploading bytes.",
    schema: artifactUpdateMetadataSchema,
    outputSchema: output(z.object({ artifact: artifactSchema })),
    access: "write"
  },
  {
    name: "artifact.archive",
    description: "Archive an artifact without deleting bytes. Archived artifacts are hidden from default search.",
    schema: artifactArchiveSchema,
    outputSchema: output(z.object({ action: z.string(), artifact: artifactSchema, event: eventLikeSchema })),
    access: "write"
  },
  {
    name: "artifact.delete",
    description: "Hard-delete an artifact metadata row and remove its stored bytes. Use only after an explicit user request.",
    schema: artifactDeleteSchema,
    outputSchema: output(deleteRecordSchema.extend({ deletedArtifact: artifactSchema })),
    access: "admin"
  },
  {
    name: "task.create",
    description: "Create a shared executable task for a project.",
    schema: createTaskSchema,
    access: "write"
  },
  {
    name: "task.list",
    description: "List shared tasks for a project. Use compact=true for low-token task selection before task.get/preflight.",
    schema: listTasksSchema
  },
  {
    name: "task.get",
    description: "Get a shared task by id.",
    schema: getTaskSchema
  },
  {
    name: "task.delete",
    description: "Hard-delete a shared task by id. Use only after an explicit user request or smoke-test cleanup.",
    schema: taskDeleteSchema,
    outputSchema: output(deleteRecordSchema.extend({ deletedTask: looseRecordSchema })),
    access: "admin"
  },
  {
    name: "task.claim",
    description:
      "Claim a task with a time-bounded lease for collaborative work. Returns claim.id; agents can use that handle even when they do not know their own client id.",
    schema: taskClaimSchema,
    outputSchema: output(taskClaimResultSchema),
    access: "write"
  },
  {
    name: "task.claim_heartbeat",
    description: "Extend a live task claim lease by claimId. Use while actively working on a claimed task.",
    schema: taskClaimIdSchema,
    outputSchema: output(z.object({ claim: taskClaimOutSchema })),
    access: "write"
  },
  {
    name: "task.claim_complete",
    description:
      "Mark one task claim completed by claimId. This records that one agent finished its part; it does not close the task.",
    schema: taskClaimIdSchema.omit({ leaseSeconds: true }),
    outputSchema: output(taskClaimResultSchema),
    access: "write"
  },
  {
    name: "task.release",
    description: "Release one task claim by claimId when the agent stops working without completing that part.",
    schema: taskClaimIdSchema.omit({ leaseSeconds: true }),
    outputSchema: output(taskClaimResultSchema),
    access: "write"
  },
  {
    name: "task.claims",
    description: "List active or historical claims for a task so agents and UI can see who is working on what.",
    schema: taskClaimsSchema,
    outputSchema: output(z.object({ claims: z.array(taskClaimOutSchema) }))
  },
  {
    name: "task.complete",
    description:
      "Close a task as done. Refuses while other active claims exist unless force=true with a reason or acceptance evidence.",
    schema: taskCompleteSchema,
    outputSchema: output(z.object({ task: looseRecordSchema, completedClaim: taskClaimOutSchema.nullable().optional(), event: eventLikeSchema })),
    access: "write"
  },
  {
    name: "task.add_note",
    description:
      "Create a task-linked memory item (I-*) for implementation notes, handoffs, test results, reviews, or coordination traces.",
    schema: taskNoteSchema,
    outputSchema: output(taskNoteResultSchema),
    access: "write"
  },
  {
    name: "task.next",
    description: "Return the next shared todo task by priority and creation time.",
    schema: nextTaskSchema
  },
  {
    name: "task.update_status",
    description: "Update shared task status and record lifecycle event.",
    schema: updateTaskStatusSchema,
    access: "write"
  },
  {
    name: "decision.record",
    description: "Record a shared project or common decision.",
    schema: recordDecisionSchema,
    access: "write"
  },
  {
    name: "decision.supersede",
    description:
      "Create a replacement decision in the same scope, mark the old decision as superseded, and record link/event history.",
    schema: decisionSupersedeSchema,
    access: "write"
  },
  {
    name: "decision.archive",
    description: "Archive a shared decision without deleting it. Archived decisions stay available by explicit status filters.",
    schema: decisionArchiveSchema,
    outputSchema: output(archiveRecordSchema.extend({ decision: looseRecordSchema })),
    access: "write"
  },
  {
    name: "decision.delete",
    description: "Hard-delete a shared decision and cleanup links that point to it. Use only after an explicit user request.",
    schema: decisionDeleteSchema,
    outputSchema: output(deleteRecordSchema.extend({ deletedDecision: looseRecordSchema })),
    access: "admin"
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
    schema: recordEventSchema,
    access: "write"
  },
  {
    name: "event.list",
    description: "List shared gateway events.",
    schema: listEventsSchema
  },
  {
    name: "event.delete",
    description: "Hard-delete one event from the timeline. Use only for explicit cleanup or test data removal.",
    schema: eventDeleteSchema,
    outputSchema: output(z.object({ deletedEvent: looseRecordSchema })),
    access: "admin"
  },
  {
    name: "link.create",
    description: "Create a shared relationship between records.",
    schema: createLinkSchema,
    access: "write"
  },
  {
    name: "link.list",
    description: "List shared links for a record.",
    schema: listLinksSchema
  },
  {
    name: "link.delete",
    description: "Hard-delete one shared relationship link. Use only after an explicit user request.",
    schema: linkDeleteSchema,
    outputSchema: output(deleteRecordSchema.extend({ deletedLink: looseRecordSchema })),
    access: "admin"
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
      "Build a compact token-conscious start-of-work context package for a task or query. Prefer brief/normal; deep is expensive. Use profile=chatgpt for a smaller pointer-first budget.",
    schema: contextPackSchema,
    outputSchema: output(contextPackDataSchema)
  },
  {
    name: "context.changed_since",
    description:
      "Return compact project/common changes since an ISO timestamp cursor so agents can refresh context without broad reloads.",
    schema: contextChangedSinceSchema,
    outputSchema: output(looseRecordSchema.extend({ efficiencyHints: efficiencyHintsSchema.optional() }))
  },
  {
    name: "handoff.create",
    description:
      "Create a compact shared handoff for another agent: work completed, files touched, blockers, validation, and next steps.",
    schema: handoffCreateSchema,
    access: "write"
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
  },
  {
    name: "git.credential_create",
    description:
      "Store a git host access token (e.g. a GitLab personal access token) encrypted at rest, bound to the caller's own logged-in session. The token is never returned by this or any other git.* tool -- requires a browser session (no static token, OAuth, or anonymous caller); see docs/AUTH.md.",
    schema: gitCredentialCreateSchema,
    outputSchema: output(gitCredentialOutSchema),
    access: "write"
  },
  {
    name: "git.credential_list",
    description:
      "List stored git host credentials (host, label, dates, and an optional last-4-characters hint) -- never the token value. A browser session sees its own credentials; a static-token/OAuth caller (an agent) sees the instance owner's, so it can use them via git.pipeline_status.",
    schema: emptySchema,
    outputSchema: output(z.object({ credentials: z.array(gitCredentialOutSchema) }))
  },
  {
    name: "git.credential_delete",
    // Deliberately access:"write", not "admin" -- a deviation from this
    // codebase's usual *.delete-is-always-admin convention. That convention
    // exists to protect shared/team-visible records from an OAuth-connected
    // agent hallucinating a destructive call (D-MEMORY-017's rationale).
    // This tool can only ever delete the CALLER'S OWN credential (enforced
    // by an owner_user_id match in deleteGitCredential(), not just by
    // argument shape) and, on top of that, is already unreachable by any
    // OAuth/static/anonymous caller regardless of scope because it requires
    // a real browser session -- the exact caller class *.delete=admin
    // exists to guard against. Requiring admin here as well would only
    // block ordinary role=member users from managing their own profile,
    // which the task's acceptance criteria (a delete button in every
    // user's own profile) rules out.
    description:
      "Permanently delete one of the caller's own stored git host credentials. Requires a browser session; deleting another user's credential (or an unknown id) fails with GIT_CREDENTIAL_NOT_FOUND.",
    schema: gitCredentialDeleteSchema,
    outputSchema: output(z.object({ deleted: z.literal(true) })),
    access: "write"
  },
  {
    name: "git.pipeline_status",
    description:
      "Resolve a stored credential for `host` (the caller's own for a browser session, the instance owner's for an agent connection) and call that GitLab instance's REST API for the latest pipeline (optionally filtered by ref) and its jobs. The raw token never leaves the server. Fails clearly if no credential is stored for that host.",
    schema: gitPipelineStatusSchema,
    outputSchema: output(gitPipelineStatusOutSchema)
  }
];

export function gatewayToolRequiredScopes(toolName: string): string[] {
  const canonicalName = gatewayToolCanonicalName(toolName);
  const spec = gatewayToolSpecs.find((tool) => tool.name === canonicalName);
  switch (spec?.access) {
    case "admin":
      return ["memory:read", "memory:write", "memory:admin"];
    case "write":
      return ["memory:read", "memory:write"];
    default:
      return ["memory:read"];
  }
}

export function gatewayToolClaudeName(toolName: string): string {
  return toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function gatewayToolCanonicalName(toolName: string): string {
  if (gatewayToolSpecs.some((tool) => tool.name === toolName)) {
    return toolName;
  }
  return gatewayToolSpecs.find((tool) => gatewayToolClaudeName(tool.name) === toolName)?.name ?? toolName;
}
