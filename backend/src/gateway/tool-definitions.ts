import * as z from "zod/v4";
import {
  getDecisionSchema,
  listDecisionsSchema,
  recordDecisionSchema,
  updateDecisionAssigneeSchema,
  updateDecisionMilestoneSchema,
  updateDecisionStatusSchema
} from "../features/decisions/model/schema.js";
import { listEventsSchema, recordEventSchema } from "../features/events/model/schema.js";
import { createLinkSchema, listLinksSchema } from "../features/links/model/schema.js";
import {
  createMemorySchema,
  getMemorySchema,
  searchMemorySchema,
  updateMemorySchema
} from "../features/memory/model/schema.js";
import { preflightSchema } from "../features/preflight/model/schema.js";
import {
  approveProjectMemberSchema,
  createProjectSchema,
  listProjectsSchema,
  pendingProjectMembersSchema,
  projectLookupSchema,
  projectMembersSchema,
  rejectProjectMemberSchema,
  updateProjectMemberRoleSchema
} from "../features/projects/model/schema.js";
import {
  createTaskSchema,
  getTaskSchema,
  listTasksSchema,
  nextTaskSchema,
  updateTaskAssigneeSchema,
  updateTaskMilestoneSchema,
  updateTaskDetailsSchema,
  updateTaskPrioritySchema,
  updateTaskStatusSchema,
  updateTaskTitleSchema
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
  description: z.string().optional(),
  rootPath: z.string().min(1).optional(),
  // Ownership reassignment escape hatch (e.g. the owner left) -- only ever
  // honored when the caller is a system admin; silently ignored otherwise.
  ownerUserId: z.string().optional()
});
// T-MEMORY-086: per-user server-side prefs -- pin state, and a generic
// scalar key/value store (projects-list sort order, and a per-project
// Timeline root-kind pref keyed "timelineRootKind:<projectId>").
const pinProjectSchema = projectLookupSchema.extend({
  pinned: z.boolean()
});
// T-MEMORY-088: gateway-only extension of the shared listProjectsSchema --
// full-text search only exists against the PostgreSQL projects.search_vector
// column (migration 060), so it stays out of the schema local/SQLite mode
// shares.
const gatewayListProjectsSchema = listProjectsSchema.extend({
  search: z.string().optional()
});
const userPreferenceSetSchema = z.object({
  key: z.string().min(1),
  value: z.unknown()
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
// T-context (2026-08-25): resolvedBy links this fault (relation
// "resolved_by") to the decision/task/note that actually fixed it, at the
// exact moment it's archived -- otherwise a fixed fault is a dead end with
// no trace of what the fix was. Ignored for any other record type.
const memoryArchiveSchema = idReasonSchema.extend({
  resolvedBy: z.string().min(1).optional()
});
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
  status: z.enum(["current", "archived"]).optional(),
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
  status: z.enum(["current", "archived"]).optional(),
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

// Cross-project Q&A (T-MEMORY-055-ish): one project asks another a question
// through shared memory instead of a side channel. Deliberately no ACL --
// fromProject/project are just which project filed/was asked the question,
// not a permission boundary (single-account, common visibility per the
// owner's design call).
const requestCreateSchema = z.object({
  project: z.string().min(1),
  fromProject: z.string().min(1).optional(),
  question: z.string().min(1)
});
// "closed" isn't a third status -- an unwanted/resolved-without-a-reply
// request is archived via the existing generic memory.archive tool, same as
// any other memory item, rather than inventing a bespoke close verb.
const requestListSchema = z.object({
  project: z.string().nullable().optional(),
  status: z.enum(["open", "answered", "archived"]).optional(),
  limit: z.number().int().min(1).max(100).optional()
});
const requestGetSchema = z.object({
  id: z.string().min(1)
});
const replyCreateSchema = z.object({
  requestId: z.string().min(1),
  // Omit for a direct reply to the request (the thread root); set to another
  // reply's id to nest under it, LiveJournal-comment-style.
  parentId: z.string().min(1).optional(),
  project: z.string().nullable().optional(),
  body: z.string().min(1)
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
// Either jobId (from a prior git.pipeline_status call) or jobName (+
// optional ref) is required -- enforced at runtime in gitJobTrace itself
// (VALIDATION_ERROR), not here, matching decision.supersede's own pattern
// of leaning on the tool's own runtime check rather than a parallel
// refine() for a "one of several optional fields" requirement.
const gitJobTraceSchema = z.object({
  host: z.string().min(1),
  project: z.string().min(1),
  jobId: z.number().int().positive().optional(),
  ref: z.string().min(1).optional(),
  jobName: z.string().min(1).optional(),
  tailLines: z.number().int().min(1).max(2000).optional(),
  redact: z.boolean().optional()
});
const gitRunnersStatusSchema = z.object({
  host: z.string().min(1),
  project: z.string().min(1)
});

// D-MEMORY-037: gateway-only credits tools, same reasoning as the git.*
// schemas above -- wallets/credit_transactions are keyed on the
// hosted-gateway-only `users` table, no local-first (SQLite) counterpart.
const creditBalanceSchema = z.object({
  userId: z.string().min(1).optional()
});
const creditHistorySchema = z.object({
  userId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional()
});
const creditLeaderboardSchema = z.object({
  limit: z.number().int().min(1).max(100).optional()
});
// T-MEMORY-084: global admin on/off switch for the whole credits economy.
const creditSettingsGetSchema = z.object({});
const creditSettingsUpdateSchema = z.object({
  enabled: z.boolean()
});
// T-MEMORY-085: batch-resolve raw created_by/credentialId clientId strings
// into human-readable labels for the frontend's "authorship next to the
// date" display.
const actorLabelsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200)
});

const looseRecordSchema = z.object({}).catchall(z.unknown());
const errorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: looseRecordSchema.optional()
});
// T-MEMORY-063: tokenEfficiencyBase only carries the full field set when
// severity escalates past "info" -- the common info case is just
// rule/severity/estimatedChars, so everything else is optional here.
const efficiencyHintsSchema = z
  .object({
    rule: z.string(),
    severity: z.enum(["info", "warn"]),
    strategy: z.string().optional(),
    fullBodiesIncluded: z.boolean().optional(),
    base64Included: z.boolean().optional(),
    estimatedChars: z.number().optional(),
    warnings: z.array(z.string()).optional(),
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
    // T-MEMORY-063: project.summary/context.pack's nextCalls no longer carry
    // a reason (capped + trimmed for token efficiency) -- other nextCalls
    // builders (hygiene_report, changed_since) still do.
    reason: z.string().optional()
  })
  .catchall(z.unknown());
// T-MEMORY-063: a compact artifact card is for deciding whether to open it,
// not for reading it -- id/path/title/tags is enough; everything else lives
// behind artifact.get/peek/read_text.
const compactArtifactSchema = z
  .object({
    id: z.string(),
    path: z.string(),
    title: z.string(),
    tags: z.array(z.string())
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
  id: z.number(),
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
const gitJobTraceOutSchema = z.object({
  jobId: z.number(),
  jobName: z.string(),
  jobStatus: z.string(),
  trace: z.string(),
  truncated: z.boolean()
});
const gitRunnerSchema = z.object({
  id: z.number(),
  description: z.string(),
  ipAddress: z.string().nullable(),
  online: z.boolean(),
  status: z.string(),
  isSharedRunner: z.boolean(),
  runnerType: z.string()
});
const gitRunnersStatusOutSchema = z.object({
  runners: z.array(gitRunnerSchema)
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
      "Explain what Marrow is, how agents should use it, and which first tools to call after connecting.",
    schema: emptySchema
  },
  {
    name: "gateway.version",
    description:
      "Return package version, storage mode, tool count, and gateway runtime identity. Use this to confirm which Marrow build is connected.",
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
      "Return this deployment's MCP connector URL. OAuth connector credentials (client id/secret) are per-user and self-generated from each user's own profile page, not returned here -- oauthClientId/oauthClientSecret are always null.",
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
    name: "gateway.actor_labels",
    description:
      "Resolve a batch of raw created_by/credentialId clientId strings (\"user:<id>\" for a real login, or a plain gateway client id otherwise) into human-readable labels -- a user's email, or the client's own label, falling back to the raw id when neither is found. One batched call for a whole page of rows instead of a lookup per row.",
    schema: actorLabelsSchema
  },
  {
    name: "user.preferences_get",
    description:
      "Get every server-side UI preference stored for the calling session's own user, as a flat key/value object (e.g. the projects-list sort order, or a per-project Timeline root-kind pref keyed \"timelineRootKind:<projectId>\"). Requires a logged-in session. Deliberately NOT localStorage -- these follow the user across devices/sessions.",
    schema: emptySchema
  },
  {
    name: "user.preference_set",
    description:
      "Set one server-side UI preference for the calling session's own user (upsert by key). Requires a logged-in session.",
    schema: userPreferenceSetSchema,
    access: "write"
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
    description: "List shared project scopes from the gateway database. Use compact=true for low-token project selection. search full-text-matches title/slug/description (plus a plain substring match against the owner's email) -- gateway-only, ignored in local/SQLite mode.",
    schema: gatewayListProjectsSchema
  },
  {
    name: "project.get",
    description: "Get a shared project by id or slug.",
    schema: projectLookupSchema
  },
  {
    name: "project.members",
    description: "List a project's members (userId + email) -- gateway-only. Use to see who is assignable before setting assignee on task.create/decision.record/task.update_assignee/decision.update_assignee, or to answer \"who is on this project\".",
    schema: projectMembersSchema
  },
  {
    name: "project.update",
    description:
      "Rename a shared project (title/description). Only this project's owner or a system admin can rename -- ownerUserId may also be set, but only takes effect for an admin caller (ownership reassignment).",
    schema: updateProjectSchema,
    access: "write"
  },
  {
    name: "project.pin",
    description:
      "Pin or unpin a project for the calling session's own user -- a pinned project always sorts to the top of project.list/projects regardless of the chosen sort order. Requires a logged-in session; purely a per-user display preference, no effect on the project itself or on other users.",
    schema: pinProjectSchema,
    access: "write"
  },
  {
    name: "project.invite_link_get",
    description:
      "Get this project's reusable invite link, lazily creating it on first request. Only this project's owner or a system admin can share it -- opening the link and joining adds the project to whoever opens it.",
    schema: projectLookupSchema,
    outputSchema: output(z.object({ code: z.string(), url: z.string() })),
    access: "write"
  },
  {
    name: "project.invite_link_regenerate",
    description:
      "Replace this project's invite link with a new code, invalidating the old one immediately (like regenerating a Slack workspace invite link, not a single-use token). Only this project's owner or a system admin can do this.",
    schema: projectLookupSchema,
    outputSchema: output(z.object({ code: z.string(), url: z.string() })),
    access: "write"
  },
  {
    name: "project.invite_claim",
    description:
      "Request to join a project by its invite code. Requires a logged-in session or personal API token. T-MEMORY-110: no longer instant -- lands as a pending membership request (pendingApproval: true) that the project's owner must approve (with a role) before it grants any access. Idempotent -- re-claiming while already active or already pending is a no-op, not an error.",
    schema: projectInviteClaimSchema,
    outputSchema: output(z.object({ project: looseRecordSchema, joined: z.boolean(), pendingApproval: z.boolean() })),
    access: "write"
  },
  {
    name: "project.my_role",
    description: "Return the calling session's own effective role on this project (pm/developer/tester) -- pm if they're the project's owner or an admin/agent-style caller with no per-project role concept. Powers permission-aware UI and lets an agent check before attempting an action its human's role might not allow.",
    schema: projectMembersSchema,
    outputSchema: output(z.object({ role: z.string() }))
  },
  {
    name: "project.pending_members",
    description: "List membership requests awaiting the owner's approval on this project. Only this project's owner or a system admin can see this.",
    schema: pendingProjectMembersSchema,
    access: "write"
  },
  {
    name: "project.approve_member",
    description: "Approve a pending membership request and assign it a role (pm/developer/tester -- see project.approve_member's role matrix in docs/task tool descriptions). Only this project's owner or a system admin can do this.",
    schema: approveProjectMemberSchema,
    access: "write"
  },
  {
    name: "project.reject_member",
    description: "Reject a pending membership request outright (the row is deleted, not just left pending). Only this project's owner or a system admin can do this.",
    schema: rejectProjectMemberSchema,
    access: "write"
  },
  {
    name: "project.update_member_role",
    description: "Change an already-active member's role (pm/developer/tester). Only this project's owner or a system admin can do this.",
    schema: updateProjectMemberRoleSchema,
    access: "write"
  },
  {
    name: "project.delete",
    description:
      "Hard-delete a shared project by id or slug. Refuses non-empty projects unless cascade=true. Use only after an explicit user request. Only this project's owner or a system admin can delete it.",
    schema: projectDeleteSchema,
    outputSchema: output(z.object({ deletedProject: looseRecordSchema, cascade: z.boolean(), counts: deleteCountsSchema })),
    access: "write"
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
    description: "Search shared memory using PostgreSQL full-text search across project and common records. Omit query to browse by type/status only, most-recent-first.",
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
    description: "Archive a shared memory item without deleting it. Prefer this before hard delete for durable project knowledge. Archiving a failed_attempt fault: pass resolvedBy (the id of the decision/task/note that actually fixed it) to link the fault to its resolution instead of leaving it a dead end.",
    schema: memoryArchiveSchema,
    outputSchema: output(archiveRecordSchema.extend({ memory: looseRecordSchema })),
    access: "write"
  },
  {
    name: "memory.delete",
    description: "Hard-delete a shared memory item and cleanup links that point to it. Use only after an explicit user request.",
    schema: memoryDeleteSchema,
    outputSchema: output(deleteRecordSchema.extend({ deletedMemory: looseRecordSchema })),
    access: "write"
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
      "Get artifact metadata by id or project/path. Set includeContent=true for small TEXT files when the agent needs base64 content inline; binary artifacts always reject includeContent -- fetch downloadPath instead.",
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
    access: "write"
  },
  {
    name: "task.create",
    description: "Create a shared executable task for a project. REQUIRED CHECK before every call: is this task part of a batch of related work -- several tasks for the same refactor/feature, or a follow-up to a task created earlier in this conversation? If yes, this is not optional: set milestone to a short, stable, git-commit-subject-style name (e.g. \"Refactor auth module\") and reuse the exact same string on every task in that batch, so they group under one heading in the Tasks list and Timeline -- do not wait for the user to ask for this grouping. Only leave milestone unset when the task is genuinely standalone, with no siblings past or future. assignee hands this task to a specific project member instead of the creator -- pass their email, or a distinguishing fragment of it (e.g. a username), and it resolves against current project members; omit it to default to the creator, or pass null to explicitly leave it unassigned. When the user says something like \"assign this to X\" / \"назначь на X\", set assignee to X.",
    schema: createTaskSchema,
    access: "write"
  },
  {
    name: "task.list",
    description: "List shared tasks for a project. Use compact=true for low-token task selection before task.get/preflight. Pass assignee=\"me\" to answer \"do I have any tasks?\" -- resolves to whichever real person this connection is authenticated as; a member's email or a distinguishing fragment of it also works, same resolution task.create's own assignee field uses.",
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
    access: "write"
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
    name: "task.update_milestone",
    description: "Set or clear (milestone: null) an existing task's milestone -- the work-process grouping that task.create's own milestone field can set at creation but has no update path afterward.",
    schema: updateTaskMilestoneSchema,
    access: "write"
  },
  {
    name: "task.update_title",
    description: "Rename an existing task's title in place.",
    schema: updateTaskTitleSchema,
    access: "write"
  },
  {
    name: "task.update_priority",
    description: "Set an existing task's priority to an exact value -- task.create's own priority field can set it at creation but has no update path afterward. Lower numbers sort first (task.next picks the lowest-priority open task).",
    schema: updateTaskPrioritySchema,
    access: "write"
  },
  {
    name: "task.update_details",
    description: "Update several of an existing task's descriptive fields in one call -- title, milestone, scope, acceptance criteria, notes, and priority. Backs a full task-editing form: only fields present in the input are changed, omit a field to leave it untouched, pass null to clear milestone/scope/acceptance/notes. Changing priority still requires the reprioritize permission even when it's submitted alongside other fields in the same call.",
    schema: updateTaskDetailsSchema,
    access: "write"
  },
  {
    name: "task.update_assignee",
    description: "Reassign an existing task to a different project member, or clear it back to unassigned (assignee: null). assignee accepts a member's email or a distinguishing fragment of it (e.g. a username), resolved against current project members. Use when the user says something like \"assign this to X\" / \"назначь на X\" / \"поставь эту задачу на X\" about an already-created task.",
    schema: updateTaskAssigneeSchema,
    access: "write"
  },
  {
    name: "decision.record",
    description: "Record a shared project or common decision. REQUIRED CHECK before every call: does this decision belong to the same refactor/feature as other tasks/decisions created together, or is it a follow-up to one created earlier in this conversation? If yes, this is not optional: set milestone to the exact same short, stable, git-commit-subject-style name (e.g. \"Refactor auth module\") used across that whole batch, so they group under one heading in the Decisions list and Timeline -- do not wait for the user to ask for this grouping. Only leave milestone unset when the decision is genuinely standalone, with no siblings past or future. assignee hands this decision to a specific project member instead of the creator -- pass their email, or a distinguishing fragment of it (e.g. a username); omit it to default to the creator, or pass null to explicitly leave it unassigned. Requires a project-scoped decision (not a common one).",
    schema: recordDecisionSchema,
    access: "write"
  },
  {
    name: "decision.update_status",
    description: "Update a shared decision's status directly (draft/accepted/rejected/archived). Use decision.supersede to mark a decision superseded.",
    schema: updateDecisionStatusSchema,
    access: "write"
  },
  {
    name: "decision.update_milestone",
    description: "Set or clear (milestone: null) an existing decision's milestone -- the work-process grouping that decision.record's own milestone field can set at creation but has no update path afterward.",
    schema: updateDecisionMilestoneSchema,
    access: "write"
  },
  {
    name: "decision.update_assignee",
    description: "Reassign an existing project-scoped decision to a different project member, or clear it back to unassigned (assignee: null). assignee accepts a member's email or a distinguishing fragment of it (e.g. a username), resolved against current project members. Use when the user says something like \"assign this to X\" / \"назначь на X\" about an already-recorded decision.",
    schema: updateDecisionAssigneeSchema,
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
    access: "write"
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
    access: "write"
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
    access: "write"
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
    name: "request.create",
    description:
      "Ask another project a question. Files it as an open request under the target project (`project`) with a link back to the asking project (`fromProject`, defaults to the caller's current project).",
    schema: requestCreateSchema,
    access: "write"
  },
  {
    name: "request.list",
    description:
      "List requests addressed to a project (defaults to open ones). Use this to check whether another project has asked something.",
    schema: requestListSchema
  },
  {
    name: "request.get",
    description:
      "Get a request by id together with its full reply thread as a nested tree (replies can nest under other replies, not just the request).",
    schema: requestGetSchema
  },
  {
    name: "reply.create",
    description:
      "Reply to a request, or to another reply within the same thread (set parentId). The first reply flips an open request to answered.",
    schema: replyCreateSchema,
    access: "write"
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
      "Resolve a stored credential for `host` (the caller's own for a browser session, the instance owner's for an agent connection) and call that GitLab instance's REST API for the latest pipeline (optionally filtered by ref) and its jobs (each with id/name/status). The raw token never leaves the server. Fails clearly if no credential is stored for that host.",
    schema: gitPipelineStatusSchema,
    outputSchema: output(gitPipelineStatusOutSchema)
  },
  {
    name: "git.job_trace",
    description:
      "Fetch the tail of a GitLab job's raw log (e.g. to see why a failed pipeline job actually failed) using the same stored credential as git.pipeline_status. Pass jobId from a prior git.pipeline_status call, or jobName (+ optional ref) to resolve it from the latest pipeline. Defaults to the last 200 lines and redacts common secret patterns (token=/password=/Bearer .../glpat-.../etc) -- pass redact=false only when a human explicitly needs the raw output.",
    schema: gitJobTraceSchema,
    outputSchema: output(gitJobTraceOutSchema)
  },
  {
    name: "git.runners_status",
    description:
      "List the GitLab runners available to a project (its own runners plus any shared/group runners assigned to it), using the same stored credential as git.pipeline_status. Each entry reports online/status (GitLab's own heartbeat-based online/offline/stale/never_contacted classification) -- useful for diagnosing a pipeline stuck in created/pending because no matching runner is online, which git.pipeline_status/git.job_trace alone can't explain.",
    schema: gitRunnersStatusSchema,
    outputSchema: output(gitRunnersStatusOutSchema)
  },
  {
    name: "credit.balance",
    description: "Get a wallet balance plus streak info -- your own if userId is omitted and you have a logged-in session, otherwise userId is required.",
    schema: creditBalanceSchema
  },
  {
    name: "credit.history",
    description: "List a user's credit_transactions ledger (own by default), newest first, optionally filtered by project or reason.",
    schema: creditHistorySchema
  },
  {
    name: "credit.leaderboard",
    description: "Top N users by wallet balance, globally.",
    schema: creditLeaderboardSchema
  },
  {
    name: "credit.settings_get",
    description: "Get the global credits-economy on/off switch. Open to any caller -- clients use this to decide whether to render credit UI at all.",
    schema: creditSettingsGetSchema
  },
  {
    name: "credit.settings_update",
    description: "Admin-only: turn the whole credits economy on or off. While off, every award/penalty hook (task completion, streaks, decisions, failed attempts, signup bonus) becomes a no-op instead of writing to the ledger; existing wallet/ledger/streak data is left untouched.",
    schema: creditSettingsUpdateSchema,
    access: "admin"
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
