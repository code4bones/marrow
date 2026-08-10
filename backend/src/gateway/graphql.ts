import { ApolloServer, HeaderMap, type HTTPGraphQLResponse } from "@apollo/server";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { GraphQLError, GraphQLScalarType, Kind, type ValueNode } from "graphql";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AppError } from "../shared/errors.js";
import type { ToolResponse } from "../shared/mcp/tool-response.js";
import type { AppLogger } from "../shared/logging/logger.js";
import type { GatewayRequestContext } from "./pg-tool-service.js";
import { GATEWAY_EVENT_TOPIC, gatewayEvents, type GatewayEventEnvelope } from "./event-bus.js";

type Row = Record<string, unknown>;

// T-MEMORY-029 / D-MEMORY-007: GraphQL mutation field names whose REST/MCP
// tool equivalent was reclassified from access:"write" to access:"admin" in
// tool-definitions.ts (the *.delete tools). http-server.ts's
// graphqlRequiredScopes() matches these against the raw query text -- the
// generic `/\bmutation\b/i` check there can't tell a delete apart from a
// create/update by text alone, so this list is the second, more specific
// check. Keep it in sync with tool-definitions.ts's admin-tier tool list.
// gateway.client_forget / gateway.client_prune are also admin-tier tools but
// have no GraphQL mutation counterpart -- the Mutation type below has no
// forgetClient/pruneClients field, so there is nothing to list for them.
// deleteProject is deliberately NOT here (as of the per-project owner
// concept, project.delete moved to access:"write" -- the fine-grained
// owner-or-admin check now lives inside deleteProject itself, same as
// updateProject/regenerateProjectInviteLink below it).
export const ADMIN_GRAPHQL_MUTATION_NAMES = [
  "deleteMemory",
  "deleteTask",
  "deleteDecision",
  "deleteArtifact",
  "deleteEvent",
  "deleteLink"
] as const;

export interface GatewayGraphqlToolService {
  call(toolName: string, input: unknown, context?: GatewayRequestContext): Promise<ToolResponse<unknown>>;
  graphqlPage(pageName: string, input: unknown, context?: GatewayRequestContext): Promise<Row>;
  graphqlProjectGraph(input: unknown, context?: GatewayRequestContext): Promise<Row>;
  graphqlRecord(id: string, context?: GatewayRequestContext): Promise<Row>;
}

export interface GatewayGraphqlContext {
  service: GatewayGraphqlToolService;
  requestContext: GatewayRequestContext;
}

// T-MEMORY-042: the resolver context graphql-ws builds per WS connection
// (see http-server.ts's useServer({ context }) wiring) -- distinct from
// GatewayGraphqlContext above, which is per-HTTP-request for queries and
// mutations. Subscriptions are session-only (no static token, no OAuth --
// see AUTH.md), so sessionIdentity is always present by the time this
// context is built: http-server.ts's onConnect already rejected the WS
// upgrade for any connection that didn't resolve a valid session.
export interface GatewaySubscriptionContext {
  sessionIdentity: { userId: string; role: string; email: string };
  isProjectVisible(projectId: string | null): Promise<boolean>;
}

export interface GatewayGraphqlServer {
  server: ApolloServer<GatewayGraphqlContext>;
  stop(): Promise<void>;
}

export interface GatewayGraphqlRequestResult {
  status: number;
  operationName?: string;
  errors?: GraphqlLoggedError[];
}

export interface GraphqlLoggedError {
  message: string;
  locations?: unknown;
  path?: unknown;
  extensions?: unknown;
}

const typeDefs = `#graphql
  scalar JSON

  type Query {
    gatewayVersion: JSON!
    gatewayStatus: JSON!
    gatewayDiagnostics: JSON!
    gatewayConnectorInfo: JSON!
    gatewayClients(anonymous: Boolean, staleOlderThanSeconds: Int, limit: Int): [GatewayClient!]!
    gatewayClientsPage(anonymous: Boolean, staleOlderThanSeconds: Int, pagination: PaginationInput): PaginatedGatewayClients!

    projects(status: String): [Project!]!
    projectsPage(status: String, pagination: PaginationInput): PaginatedProjects!
    project(id: ID, slug: String): Project!
    # Get-or-create: lazily creates the project's invite link on first
    # request (T-MEMORY-047's "lazy generation" precedent). Any current
    # project member (or admin) may call this.
    projectInviteLink(id: ID, slug: String): ProjectInviteLink!
    projectSummary(project: String!, query: String, includeCommon: Boolean, limits: ProjectSummaryLimitsInput): ProjectSummary!
    projectGraph(projectId: ID!, depth: Int = 2, maxPerType: Int = 60): ProjectGraph!
    record(id: ID!): RecordLookup!

    memory(id: ID!): MemoryRecord!
    memorySearch(
      project: String
      query: String!
      includeCommon: Boolean
      type: String
      status: String
      limit: Int
    ): [MemoryRecord!]!
    memorySearchPage(
      project: String
      query: String!
      includeCommon: Boolean
      type: String
      status: String
      pagination: PaginationInput
    ): PaginatedMemoryRecords!
    memoryItemsPage(
      project: String
      common: Boolean
      includeCommon: Boolean
      type: String
      status: String
      tags: [String!]
      pagination: PaginationInput
    ): PaginatedMemoryRecords!

    tasks(project: String!, status: String, milestone: String, limit: Int): [Task!]!
    # T-MEMORY-051 follow-up: server-driven sort for the Tasks list.
    # sortField/sortDirection default to updated_at desc; GraphQL enums (not
    # free-text) make invalid values impossible -- the schema rejects them
    # before the resolver runs.
    tasksPage(
      project: String!
      status: String
      milestone: String
      sortField: TaskSortField = UPDATED_AT
      sortDirection: SortDirection = DESC
      pagination: PaginationInput
    ): PaginatedTasks!
    task(id: ID!): Task!
    taskClaims(taskId: ID!, includeInactive: Boolean): [TaskClaim!]!
    nextTask(project: String!): Task

    decisions(project: String, includeCommon: Boolean, status: String, limit: Int): [Decision!]!
    decisionsPage(project: String, includeCommon: Boolean, status: String, pagination: PaginationInput): PaginatedDecisions!
    decision(id: ID!): Decision!

    artifacts(
      project: String
      common: Boolean
      includeCommon: Boolean
      pathPrefix: String
      tags: [String!]
      includeArchived: Boolean
      status: String
      limit: Int
    ): [Artifact!]!
    artifactsPage(
      project: String
      common: Boolean
      includeCommon: Boolean
      pathPrefix: String
      tags: [String!]
      includeArchived: Boolean
      status: String
      pagination: PaginationInput
    ): PaginatedArtifacts!
    artifact(id: ID, project: String, path: String): Artifact!
    artifactSearch(
      project: String
      query: String
      includeCommon: Boolean
      includeArchived: Boolean
      status: String
      tags: [String!]
      limit: Int
    ): [ArtifactSearchResult!]!
    artifactSearchPage(
      project: String
      query: String
      includeCommon: Boolean
      includeArchived: Boolean
      status: String
      tags: [String!]
      pagination: PaginationInput
    ): PaginatedArtifactSearchResults!
    artifactText(
      id: ID
      project: String
      path: String
      maxBytes: Int
      maxChars: Int
      maxLines: Int
      outlineLimit: Int
      redactSecrets: Boolean
    ): ArtifactText!

    events(project: String, common: Boolean, relatedId: String, limit: Int): [Event!]!
    event(id: ID!): Event!
    eventsPage(project: String, common: Boolean, relatedId: String, pagination: PaginationInput): PaginatedEvents!

    link(id: ID!): Link!
    links(
      id: ID!
      direction: String
      relation: String
      limit: Int
    ): [Link!]!
    linksPage(
      id: ID
      project: String
      common: Boolean
      includeCommon: Boolean
      direction: String
      relation: String
      pagination: PaginationInput
    ): PaginatedLinks!

    # T-MEMORY-044: requires a browser session (context.sessionUserId) --
    # static token, OAuth, and anonymous callers get a clear
    # "requires a logged-in session" error, not an empty/guessed result. See
    # docs/AUTH.md's "Git host credentials" section.
    gitCredentials: [GitCredential!]!
    gitPipelineStatus(host: String!, project: String!, ref: String): JSON
  }

  type Mutation {
    createProject(input: CreateProjectInput!): Project!
    updateProject(id: ID, slug: String, title: String, description: String, ownerUserId: String): Project!
    regenerateProjectInviteLink(id: ID, slug: String): ProjectInviteLink!
    claimProjectInviteLink(code: String!): ClaimProjectInviteLinkResult!
    deleteProject(id: ID, slug: String, cascade: Boolean, reason: String): DeleteProjectResult!

    createMemory(input: CreateMemoryInput!): MemoryRecord!
    updateMemory(input: UpdateMemoryInput!): MemoryRecord!
    archiveMemory(id: ID!, reason: String): ArchiveMemoryResult!
    deleteMemory(id: ID!, reason: String): DeleteMemoryResult!

    createTask(input: CreateTaskInput!): Task!
    updateTaskStatus(id: ID!, status: String!, note: String, force: Boolean, reason: String): Task!
    claimTask(input: TaskClaimInput!): TaskClaimResult!
    heartbeatTaskClaim(claimId: ID!, leaseSeconds: Int, note: String): TaskClaim!
    completeTaskClaim(claimId: ID!, note: String): TaskClaimResult!
    releaseTaskClaim(claimId: ID!, note: String): TaskClaimResult!
    completeTask(id: ID!, claimId: ID, acceptanceEvidence: String, force: Boolean, reason: String): TaskCompleteResult!
    addTaskNote(input: TaskNoteInput!): TaskNoteResult!
    deleteTask(id: ID!, reason: String): DeleteTaskResult!

    recordDecision(input: RecordDecisionInput!): Decision!
    updateDecisionStatus(id: ID!, status: String!, reason: String): Decision!
    # Reuses RecordDecisionInput's schema shape; supersedesId/rationale are
    # required at runtime by decisionSupersedeSchema, not by this GraphQL
    # type — matches recordDecision's own pattern of leaning on the MCP
    # tool's Zod validation rather than a parallel strict input type.
    supersedeDecision(input: RecordDecisionInput!): SupersedeDecisionResult!
    archiveDecision(id: ID!, reason: String): ArchiveDecisionResult!
    deleteDecision(id: ID!, reason: String): DeleteDecisionResult!

    putTextArtifact(input: PutTextArtifactInput!): Artifact!
    updateArtifactMetadata(input: UpdateArtifactMetadataInput!): Artifact!
    archiveArtifact(id: ID, project: String, path: String, reason: String): ArtifactArchiveResult!
    deleteArtifact(id: ID, project: String, path: String, reason: String): DeleteArtifactResult!

    recordEvent(input: RecordEventInput!): Event!
    deleteEvent(id: ID!, reason: String): DeleteEventResult!

    createLink(input: CreateLinkInput!): Link!
    deleteLink(id: ID!, reason: String): DeleteLinkResult!

    # T-MEMORY-044: deliberately NOT in ADMIN_GRAPHQL_MUTATION_NAMES below --
    # unlike the other delete* mutations, this one can only ever delete the
    # calling session's OWN credential (owner_user_id-scoped in
    # deleteGitCredential(), pg-tool-service.ts), so it stays at the normal
    # mutation (write-scope) tier rather than admin. See the access comment
    # on git.credential_delete in tool-definitions.ts for the full
    # rationale.
    createGitCredential(host: String!, label: String!, token: String!): GitCredential!
    deleteGitCredential(id: ID!): Boolean!
  }

  # T-MEMORY-042: single unified live-update channel over WS -- deliberately
  # not per-entity-type subscriptions (owner decision). event mirrors the
  # underlying events.type column (e.g. "item.created", "task.updated");
  # payload reuses eventOut()'s shape, unchanged from what event.list /
  # Event already expose over HTTP. See docs/GRAPHQL_API.md and
  # src/gateway/event-bus.ts.
  type GatewayEventEnvelope {
    event: String!
    payload: JSON!
  }

  type Subscription {
    gatewayEvents: GatewayEventEnvelope!
  }

  input ProjectSummaryLimitsInput {
    tasks: Int
    decisions: Int
    faults: Int
    handoffs: Int
    artifacts: Int
    memory: Int
    events: Int
  }

  input PaginationInput {
    limit: Int = 50
    offset: Int = 0
  }

  # T-MEMORY-051 follow-up: tasksPage sort controls.
  enum TaskSortField {
    UPDATED_AT
    CREATED_AT
    PRIORITY
  }

  enum SortDirection {
    ASC
    DESC
  }

  type PageInfo {
    limit: Int!
    offset: Int!
    totalCount: Int!
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
  }

  enum RecordKind {
    PROJECT
    MEMORY
    TASK
    DECISION
    ARTIFACT
    EVENT
    LINK
  }

  union RecordPayload = Project | MemoryRecord | Task | Decision | Artifact | Event | Link

  type RecordLookup {
    id: ID!
    kind: RecordKind!
    projectId: String
    record: RecordPayload!
  }

  input CreateProjectInput {
    slug: String!
    title: String!
    description: String
    rootPath: String
  }

  input CreateTaskInput {
    project: String!
    title: String!
    milestone: String
    priority: Int
    scope: String
    acceptance: String
    allowedFiles: [String!]
    forbiddenFiles: [String!]
    dependsOn: [String!]
    notes: String
  }

  input TaskClaimInput {
    taskId: ID!
    role: String
    scope: String
    note: String
    leaseSeconds: Int
  }

  input TaskNoteInput {
    taskId: ID!
    type: String
    title: String
    body: String!
    tags: [String!]
    relation: String
  }

  input RecordLinkInput {
    toId: String!
    relation: String!
  }

  input CreateMemoryInput {
    id: ID
    project: String
    common: Boolean
    type: String!
    title: String!
    body: String!
    status: String
    tags: [String!]
    summary: String
    links: [RecordLinkInput!]
  }

  input UpdateMemoryInput {
    id: ID!
    title: String
    body: String
    status: String
    tags: [String!]
    summary: String
  }

  input RecordDecisionInput {
    project: String
    title: String!
    status: String
    context: String
    decision: String!
    rationale: String
    consequences: String
    tags: [String!]
    supersedesId: String
    summary: String
    links: [RecordLinkInput!]
  }

  input RecordEventInput {
    project: String
    type: String!
    title: String
    body: String
    relatedId: String
  }

  input CreateLinkInput {
    project: String
    fromId: String!
    toId: String!
    relation: String!
  }

  input PutTextArtifactInput {
    id: ID
    project: String
    common: Boolean
    path: String!
    title: String
    description: String
    contentType: String
    text: String!
    tags: [String!]
    overwrite: Boolean
  }

  input UpdateArtifactMetadataInput {
    id: ID
    project: String
    path: String
    title: String
    description: String
    tags: [String!]
  }

  type Project {
    id: ID!
    slug: String!
    title: String
    description: String
    status: String!
    rootPath: String
    ownerUserId: String
    createdAt: String
    updatedAt: String
  }

  type PaginatedProjects {
    items: [Project!]!
    pageInfo: PageInfo!
  }

  # Project sharing: reusable, per-project invite link (get-or-create /
  # regenerate) and the result of following one.
  type ProjectInviteLink {
    code: String!
    url: String!
  }

  type ClaimProjectInviteLinkResult {
    project: Project!
    joined: Boolean!
  }

  type GatewayClient {
    id: ID!
    label: String
    lastSeenAt: String
    metadata: JSON!
    createdAt: String
    updatedAt: String
  }

  type PaginatedGatewayClients {
    items: [GatewayClient!]!
    pageInfo: PageInfo!
  }

  # T-MEMORY-044: no token field, ever -- the underlying resolver value
  # (git.credential_create/list's tool output) may carry a tokenHint or
  # updatedAt key too, but this type only ever selects the fields declared
  # here, so those extra keys are simply never exposed over GraphQL.
  type GitCredential {
    id: ID!
    host: String!
    label: String!
    createdAt: String!
    lastUsedAt: String
  }

  type ProjectSummary {
    summary: String!
    budget: JSON!
    project: Project!
    query: String!
    includeCommon: Boolean!
    counts: ProjectCounts!
    openTasks: [Task!]!
    handoffs: [MemoryRecord!]!
    decisions: [Decision!]!
    knownFaults: [MemoryRecord!]!
    artifacts: [ArtifactSearchResult!]!
    memory: [MemoryRecord!]!
    recentEvents: [Event!]!
    nextCalls: [NextCall!]!
  }

  type ProjectCounts {
    tasks: Int!
    openTasks: Int!
    items: Int!
    decisions: Int!
    links: Int!
    artifacts: Int!
    events: Int!
  }

  type GraphNode {
    id: ID!
    kind: String!
    title: String!
    status: String
    createdAt: String
  }

  type GraphEdge {
    id: ID!
    from: ID!
    to: ID!
    relation: String!
  }

  type ProjectGraph {
    nodes: [GraphNode!]!
    edges: [GraphEdge!]!
  }

  type ProjectDeleteCounts {
    tasks: Int!
    taskClaims: Int
    items: Int!
    decisions: Int!
    links: Int!
    events: Int!
    artifacts: Int!
    currentProjectKeys: Int
  }

  type DeleteProjectResult {
    deletedProject: Project!
    cascade: Boolean!
    counts: ProjectDeleteCounts!
  }

  type RelatedRecordCandidate {
    id: ID!
    type: String!
    title: String!
  }

  # T-MEMORY-063: ProjectSummary.handoffs/ContextPack.handoffs source from
  # compactHandoffRecord, which drops projectId as redundant within a
  # section already scoped to one project. type stays non-null and
  # hardcoded to "handoff" there (never omitted) -- this field is shared
  # with Event.type (also String!) in GET_RECORD's inline-fragment union
  # selection, and GraphQL requires the same field name to resolve to the
  # same nullability everywhere it's used in one query document.
  type MemoryRecord {
    id: ID!
    projectId: String
    scope: String
    type: String!
    title: String
    body: String
    excerpt: String
    status: String!
    tags: [String!]!
    summary: String
    rank: Float
    createdAt: String
    updatedAt: String
    linksCreated: [Link!]
    relatedCandidates: [RelatedRecordCandidate!]
  }

  type PaginatedMemoryRecords {
    items: [MemoryRecord!]!
    pageInfo: PageInfo!
  }

  type ArchiveMemoryResult {
    action: String!
    memory: MemoryRecord!
    event: Event
  }

  type DeleteMemoryResult {
    deletedMemory: MemoryRecord!
    deletedLinks: Int!
    event: Event!
  }

  # T-MEMORY-063: ProjectSummary.openTasks/ContextPack.task source from
  # compactTask, which omits allowedFiles/forbiddenFiles/dependsOn entirely
  # when empty rather than serializing an empty array -- nullable here for
  # that reason (task.get/tasksPage's full taskOut always populates them).
  type Task {
    id: ID!
    projectId: String
    title: String
    status: String!
    milestone: String
    priority: Int
    scope: String
    acceptance: String
    allowedFiles: [String!]
    forbiddenFiles: [String!]
    dependsOn: [String!]
    notes: String
    activeClaimCount: Int!
    createdAt: String
    updatedAt: String
  }

  type PaginatedTasks {
    items: [Task!]!
    pageInfo: PageInfo!
  }

  type TaskClaim {
    id: ID!
    taskId: String!
    projectId: String!
    clientId: String!
    clientLabel: String
    clientKind: String
    role: String!
    scope: String
    status: String!
    leaseExpiresAt: String!
    heartbeatAt: String!
    note: String
    createdAt: String!
    updatedAt: String!
  }

  type TaskClaimResult {
    claim: TaskClaim!
    task: Task
    event: Event
  }

  type TaskCompleteResult {
    task: Task!
    completedClaim: TaskClaim
    event: Event
  }

  type TaskNoteResult {
    item: MemoryRecord!
    link: Link!
    event: Event!
  }

  type DeleteTaskResult {
    deletedTask: Task!
    deletedLinks: Int
    event: Event!
  }

  type Decision {
    id: ID!
    projectId: String
    title: String
    status: String!
    context: String
    decision: String
    rationale: String
    consequences: String
    tags: [String!]!
    supersedesId: String
    summary: String
    createdAt: String
    updatedAt: String
    linksCreated: [Link!]
    relatedCandidates: [RelatedRecordCandidate!]
  }

  type PaginatedDecisions {
    items: [Decision!]!
    pageInfo: PageInfo!
  }

  type ArchiveDecisionResult {
    action: String!
    decision: Decision!
    event: Event
  }

  type SupersedeDecisionResult {
    decision: Decision!
    superseded: Decision!
    link: Link!
    event: Event!
  }

  type DeleteDecisionResult {
    deletedDecision: Decision!
    deletedLinks: Int!
    event: Event!
  }

  type Artifact {
    id: ID!
    projectId: String
    scope: String
    path: String!
    title: String
    description: String
    status: String!
    contentType: String!
    sizeBytes: Int!
    sha256: String
    tags: [String!]!
    downloadPath: String!
    archivedAt: String
    archivedBy: String
    archiveReason: String
    createdAt: String
    updatedAt: String
  }

  type PaginatedArtifacts {
    items: [Artifact!]!
    pageInfo: PageInfo!
  }

  # T-MEMORY-063: this type also serves ProjectSummary.artifacts and
  # ContextPack.artifacts, whose compactArtifactRecord source now only
  # provides id/path/title/tags -- scope/contentType/sizeBytes/downloadPath
  # are nullable here for that reason (they're still always present when
  # this type backs the full artifactSearch/artifactSearchPage queries).
  type ArtifactSearchResult {
    id: ID!
    projectId: String
    scope: String
    path: String!
    title: String!
    description: String
    status: String
    contentType: String
    sizeBytes: Int
    sha256: String
    tags: [String!]!
    downloadPath: String
    archivedAt: String
    archivedBy: String
    archiveReason: String
    createdAt: String
    updatedAt: String
    rank: Float
    preferredNextTool: String
  }

  type PaginatedArtifactSearchResults {
    items: [ArtifactSearchResult!]!
    pageInfo: PageInfo!
  }

  type ArtifactText {
    id: ID!
    projectId: String
    scope: String!
    path: String!
    title: String!
    description: String
    status: String!
    contentType: String!
    sizeBytes: Int!
    sha256: String
    tags: [String!]!
    downloadPath: String!
    text: String!
    textInfo: ArtifactTextInfo!
    outline: [MarkdownOutlineItem!]!
    createdAt: String
    updatedAt: String
  }

  type ArtifactTextInfo {
    isText: Boolean!
    isMarkdown: Boolean!
    encoding: String!
    readBytes: Int!
    maxBytes: Int!
    maxChars: Int!
    maxLines: Int!
    truncated: Boolean!
    truncatedByBytes: Boolean!
    truncatedByChars: Boolean!
    truncatedByLines: Boolean!
    redacted: Boolean!
    redactions: Int!
    base64Included: Boolean!
  }

  type ArtifactArchiveResult {
    action: String!
    artifact: Artifact!
    event: Event
  }

  type DeleteArtifactResult {
    deletedArtifact: Artifact!
    deletedLinks: Int!
    event: Event!
  }

  type MarkdownOutlineItem {
    level: Int!
    title: String!
    line: Int!
  }

  type Event {
    id: ID!
    projectId: String
    type: String!
    title: String
    body: String
    relatedId: String
    # Which client credential performed the operation this event records
    # (T-MEMORY-029 / D-MEMORY-007 attribution).
    credentialId: String
    createdAt: String
  }

  type PaginatedEvents {
    items: [Event!]!
    pageInfo: PageInfo!
  }

  type DeleteEventResult {
    deletedEvent: Event!
  }

  type Link {
    id: ID!
    projectId: String
    fromId: String!
    toId: String!
    relation: String!
    createdAt: String
  }

  type PaginatedLinks {
    items: [Link!]!
    pageInfo: PageInfo!
  }

  type DeleteLinkResult {
    deletedLink: Link!
    event: Event!
  }

  type NextCall {
    tool: String!
    input: JSON!
    reason: String!
  }
`;

const jsonScalar = new GraphQLScalarType({
  name: "JSON",
  description: "Arbitrary JSON value.",
  serialize: (value) => value,
  parseValue: (value) => value,
  parseLiteral: parseJsonLiteral
});

const resolvers = {
  JSON: jsonScalar,
  RecordPayload: {
    __resolveType(value: Row) {
      return typeof value.__typename === "string" ? value.__typename : null;
    }
  },
  Query: {
    gatewayVersion: async (_parent: unknown, _args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "gateway.version", {})).version,
    gatewayStatus: async (_parent: unknown, _args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "gateway.status", {})).status,
    gatewayDiagnostics: async (_parent: unknown, _args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "gateway.diagnostics", {})).diagnostics,
    gatewayConnectorInfo: async (_parent: unknown, _args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "gateway.connector_info", {})).connectorInfo,
    gatewayClients: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "gateway.clients", cleanInput(args))).clients,
    gatewayClientsPage: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await pageQuery(context, "gatewayClients", cleanInput(args)),
    projects: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "project.list", cleanInput(args))).projects,
    projectsPage: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await pageQuery(context, "projects", cleanInput(args)),
    project: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "project.get", requireOne(cleanInput(args), ["id", "slug"], "project"))).project,
    projectInviteLink: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await callTool<Row>(context, "project.invite_link_get", requireOne(cleanInput(args), ["id", "slug"], "projectInviteLink")),
    projectSummary: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await callTool<Row>(context, "project.summary", cleanInput(args)),
    projectGraph: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await projectGraphQuery(context, cleanInput(args)),
    record: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await recordQuery(context, String(args.id)),
    memory: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await typedRecordQuery(context, String(args.id), "MEMORY")).record,
    memorySearch: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "memory.search", cleanInput(args))).results,
    memorySearchPage: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await pageQuery(context, "memorySearch", cleanInput(args)),
    memoryItemsPage: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await pageQuery(context, "memoryItems", cleanInput(args)),
    tasks: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "task.list", cleanInput(args))).tasks,
    tasksPage: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await pageQuery(context, "tasks", cleanInput(args)),
    task: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "task.get", cleanInput(args))).task,
    taskClaims: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "task.claims", cleanInput(args))).claims,
    nextTask: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "task.next", cleanInput(args))).task,
    decisions: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "decision.list", cleanInput(args))).decisions,
    decisionsPage: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await pageQuery(context, "decisions", cleanInput(args)),
    decision: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "decision.get", cleanInput(args))).decision,
    artifacts: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "artifact.list", cleanInput(args))).artifacts,
    artifactsPage: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await pageQuery(context, "artifacts", cleanInput(args)),
    artifact: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "artifact.get", requireOne(cleanInput(args), ["id", "path"], "artifact"))).artifact,
    artifactSearch: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "artifact.search", cleanInput(args))).results,
    artifactSearchPage: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await pageQuery(context, "artifactSearch", cleanInput(args)),
    artifactText: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "artifact.read_text", requireOne(cleanInput(args), ["id", "path"], "artifactText"))).artifact,
    events: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) => {
      const input = cleanInput(args);
      if (input.common === true) {
        input.project = null;
      }
      delete input.common;
      return (await callTool<Row>(context, "event.list", input)).events;
    },
    event: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await typedRecordQuery(context, String(args.id), "EVENT")).record,
    eventsPage: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) => {
      const input = cleanInput(args);
      if (input.common === true) {
        input.project = null;
      }
      delete input.common;
      return await pageQuery(context, "events", input);
    },
    link: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await typedRecordQuery(context, String(args.id), "LINK")).record,
    links: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "link.list", cleanInput(args))).links,
    linksPage: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await pageQuery(context, "links", cleanInput(args)),
    gitCredentials: async (_parent: unknown, _args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "git.credential_list", {})).credentials,
    gitPipelineStatus: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await callTool<Row>(context, "git.pipeline_status", cleanInput(args))
  },
  Mutation: {
    createProject: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "project.create", cleanInput(args.input as Row))).project,
    updateProject: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "project.update", requireOne(cleanInput(args), ["id", "slug"], "updateProject"))).project,
    regenerateProjectInviteLink: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await callTool<Row>(context, "project.invite_link_regenerate", requireOne(cleanInput(args), ["id", "slug"], "regenerateProjectInviteLink")),
    claimProjectInviteLink: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await callTool<Row>(context, "project.invite_claim", cleanInput(args)),
    deleteProject: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await callTool<Row>(context, "project.delete", requireOne(cleanInput(args), ["id", "slug"], "deleteProject")),
    createMemory: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "memory.create", cleanInput(args.input as Row))).item,
    updateMemory: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "memory.update", cleanInput(args.input as Row))).item,
    archiveMemory: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await callTool<Row>(context, "memory.archive", cleanInput(args)),
    deleteMemory: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await callTool<Row>(context, "memory.delete", cleanInput(args)),
    createTask: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "task.create", cleanInput(args.input as Row))).task,
    updateTaskStatus: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "task.update_status", cleanInput(args))).task,
    claimTask: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await callTool<Row>(context, "task.claim", cleanInput(args.input as Row)),
    heartbeatTaskClaim: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "task.claim_heartbeat", cleanInput(args))).claim,
    completeTaskClaim: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await callTool<Row>(context, "task.claim_complete", cleanInput(args)),
    releaseTaskClaim: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await callTool<Row>(context, "task.release", cleanInput(args)),
    completeTask: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await callTool<Row>(context, "task.complete", cleanInput(args)),
    addTaskNote: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await callTool<Row>(context, "task.add_note", cleanInput(args.input as Row)),
    deleteTask: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await callTool<Row>(context, "task.delete", cleanInput(args)),
    recordDecision: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "decision.record", cleanInput(args.input as Row))).decision,
    updateDecisionStatus: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "decision.update_status", cleanInput(args))).decision,
    supersedeDecision: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await callTool<Row>(context, "decision.supersede", cleanInput(args.input as Row)),
    archiveDecision: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await callTool<Row>(context, "decision.archive", cleanInput(args)),
    deleteDecision: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await callTool<Row>(context, "decision.delete", cleanInput(args)),
    putTextArtifact: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "artifact.put_text", cleanInput(args.input as Row))).artifact,
    updateArtifactMetadata: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "artifact.update_metadata", requireOne(cleanInput(args.input as Row), ["id", "path"], "updateArtifactMetadata"))).artifact,
    archiveArtifact: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await callTool<Row>(context, "artifact.archive", requireOne(cleanInput(args), ["id", "path"], "archiveArtifact")),
    deleteArtifact: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await callTool<Row>(context, "artifact.delete", requireOne(cleanInput(args), ["id", "path"], "deleteArtifact")),
    recordEvent: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "event.record", cleanInput(args.input as Row))).event,
    deleteEvent: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await callTool<Row>(context, "event.delete", cleanInput(args)),
    createLink: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "link.create", cleanInput(args.input as Row))).link,
    deleteLink: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await callTool<Row>(context, "link.delete", cleanInput(args)),
    createGitCredential: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await callTool<Row>(context, "git.credential_create", cleanInput(args)),
    deleteGitCredential: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) => {
      const result = await callTool<Row>(context, "git.credential_delete", cleanInput(args));
      return result.deleted === true;
    }
  },
  Subscription: {
    gatewayEvents: {
      subscribe: (_parent: unknown, _args: Row, context: GatewaySubscriptionContext) => filteredGatewayEvents(context),
      // Default field resolution would look for a `gatewayEvents` key on the
      // yielded root value; the envelopes flowing out of the PubSub (and
      // through filteredGatewayEvents below) already ARE the
      // GatewayEventEnvelope value, so resolve them as-is.
      resolve: (envelope: GatewayEventEnvelope) => envelope
    }
  }
};

// T-MEMORY-042: per the task's WS auth section -- one async generator per
// open subscription, re-yielding only the envelopes this connection's
// session is allowed to see. Mirrors assertProjectMember's exact bypass
// rules (pg-tool-service.ts): role=admin or a common-scope event
// (payload.projectId == null) always passes; role=member is checked against
// project_members via isProjectVisible (PgToolService.isProjectVisibleToSession).
async function* filteredGatewayEvents(context: GatewaySubscriptionContext): AsyncGenerator<GatewayEventEnvelope> {
  // Narrowed to AsyncIterable (not graphql-subscriptions' own
  // PubSubAsyncIterableIterator type): its throw() resolves Promise<never>
  // rather than Promise<IteratorResult<T>>, which trips up TS's inferred
  // return type for this generator's own throw() under `for await` --
  // for-await only actually needs [Symbol.asyncIterator]/next(), so
  // AsyncIterable is both sufficient and sidesteps the mismatch.
  const events: AsyncIterable<GatewayEventEnvelope> = gatewayEvents.asyncIterableIterator<GatewayEventEnvelope>(
    GATEWAY_EVENT_TOPIC
  );
  for await (const envelope of events) {
    const projectId = envelope.payload.projectId;
    const normalizedProjectId = typeof projectId === "string" ? projectId : null;
    if (await context.isProjectVisible(normalizedProjectId)) {
      yield envelope;
    }
  }
}

// Built once via @graphql-tools/schema (a transitive dependency of
// @apollo/server itself, which uses it internally for its own typeDefs +
// resolvers constructor overload) so the exact same executable GraphQLSchema
// object backs both the HTTP ApolloServer below and the WS transport's
// useServer({ schema }) in http-server.ts -- one schema, one source of
// truth, instead of building it twice from the same typeDefs/resolvers and
// hoping they stay in sync.
export const gatewaySchema = makeExecutableSchema({ typeDefs, resolvers });

export async function createGatewayGraphqlServer(): Promise<GatewayGraphqlServer> {
  const server = new ApolloServer<GatewayGraphqlContext>({
    schema: gatewaySchema,
    introspection: true,
    csrfPrevention: false
  });
  await server.start();
  return {
    server,
    stop: () => server.stop()
  };
}

export async function handleGatewayGraphqlRequest(input: {
  graphql: GatewayGraphqlServer;
  request: IncomingMessage;
  response: ServerResponse;
  requestContext: GatewayRequestContext;
  requestId: string;
  service: GatewayGraphqlToolService;
  logger?: AppLogger;
  body?: unknown;
}): Promise<GatewayGraphqlRequestResult> {
  const { request, response, requestId } = input;
  if (request.method === "OPTIONS") {
    sendGraphqlOptions(response, requestId);
    return { status: 204 };
  }
  if (request.method !== "GET" && request.method !== "POST") {
    sendGraphqlJson(response, 405, { errors: [{ message: "Method not allowed." }] }, requestId);
    return { status: 405 };
  }

  const requestUrl = new URL(request.url ?? "/", "http://gateway.local");
  const body = input.body ?? (request.method === "POST" ? await readGraphqlBody(request) : undefined);
  const operationName = operationNameFromBody(body);
  const httpGraphQLResponse = await input.graphql.server.executeHTTPGraphQLRequest({
    httpGraphQLRequest: {
      method: request.method,
      headers: headersFromRequest(request),
      search: requestUrl.search,
      body
    },
    context: async () => ({
      service: input.service,
      requestContext: input.requestContext
    })
  });

  const errors = graphqlErrorsFromResponse(httpGraphQLResponse);
  await sendGraphqlResponse(response, httpGraphQLResponse, requestId);
  return {
    status: httpGraphQLResponse.status ?? 200,
    operationName,
    errors
  };
}

async function callTool<T extends Row>(
  context: GatewayGraphqlContext,
  toolName: string,
  input: Row
): Promise<T> {
  const result = await context.service.call(toolName, input, context.requestContext);
  if (!result.ok) {
    throw new GraphQLError(result.error.message, {
      extensions: {
        code: result.error.code,
        details: result.error.details
      }
    });
  }
  return result.data as T;
}

async function pageQuery(
  context: GatewayGraphqlContext,
  pageName: string,
  input: Row
): Promise<Row> {
  try {
    return await context.service.graphqlPage(pageName, input, context.requestContext);
  } catch (error) {
    if (error instanceof AppError) {
      throw new GraphQLError(error.message, {
        extensions: {
          code: error.code,
          details: error.details
        }
      });
    }
    throw error;
  }
}

async function projectGraphQuery(context: GatewayGraphqlContext, input: Row): Promise<Row> {
  try {
    return await context.service.graphqlProjectGraph(input, context.requestContext);
  } catch (error) {
    if (error instanceof AppError) {
      throw new GraphQLError(error.message, {
        extensions: {
          code: error.code,
          details: error.details
        }
      });
    }
    throw error;
  }
}

async function recordQuery(context: GatewayGraphqlContext, id: string): Promise<Row> {
  try {
    return await context.service.graphqlRecord(id, context.requestContext);
  } catch (error) {
    if (error instanceof AppError) {
      throw new GraphQLError(error.message, {
        extensions: {
          code: error.code,
          details: error.details
        }
      });
    }
    throw error;
  }
}

async function typedRecordQuery(context: GatewayGraphqlContext, id: string, kind: string): Promise<Row> {
  const lookup = await recordQuery(context, id);
  if (lookup.kind !== kind) {
    throw new GraphQLError(`Record ${id} is ${lookup.kind}, not ${kind}.`, {
      extensions: {
        code: "TYPE_MISMATCH",
        details: { id, actualKind: lookup.kind, expectedKind: kind }
      }
    });
  }
  return lookup;
}

function requireOne(input: Row, fields: string[], label: string): Row {
  if (fields.some((field) => typeof input[field] === "string" && String(input[field]).length > 0)) {
    return input;
  }
  throw new AppError("VALIDATION_ERROR", `${label} requires one of: ${fields.join(", ")}.`);
}

function graphqlErrorsFromResponse(response: HTTPGraphQLResponse): GraphqlLoggedError[] | undefined {
  if (response.body.kind !== "complete") {
    return undefined;
  }
  try {
    const payload = JSON.parse(response.body.string) as { errors?: unknown };
    if (!Array.isArray(payload.errors) || payload.errors.length === 0) {
      return undefined;
    }
    return payload.errors.map(graphqlErrorForLog);
  } catch {
    return undefined;
  }
}

function graphqlErrorForLog(error: unknown): GraphqlLoggedError {
  if (!isRow(error)) {
    return { message: String(error) };
  }
  return {
    message: typeof error.message === "string" ? error.message : JSON.stringify(error),
    locations: error.locations,
    path: error.path,
    extensions: error.extensions
  };
}

function cleanInput(input: Row): Row {
  const output: Row = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      output[key] = value;
    }
  }
  return output;
}

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonLiteral(ast: ValueNode): unknown {
  switch (ast.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN:
      return ast.value;
    case Kind.INT:
    case Kind.FLOAT:
      return Number(ast.value);
    case Kind.NULL:
      return null;
    case Kind.LIST:
      return ast.values.map(parseJsonLiteral);
    case Kind.OBJECT: {
      const output: Row = {};
      for (const field of ast.fields) {
        output[field.name.value] = parseJsonLiteral(field.value);
      }
      return output;
    }
    default:
      return null;
  }
}

function headersFromRequest(request: IncomingMessage): HeaderMap {
  const headers = new HeaderMap();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return headers;
}

async function readGraphqlBody(request: IncomingMessage): Promise<unknown> {
  const raw = await readText(request);
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw);
}

async function readText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function sendGraphqlResponse(
  response: ServerResponse,
  graphqlResponse: HTTPGraphQLResponse,
  requestId: string
): Promise<void> {
  for (const [key, value] of graphqlResponse.headers) {
    response.setHeader(key, value);
  }
  setCorsHeaders(response);
  response.setHeader("x-request-id", requestId);
  response.statusCode = graphqlResponse.status ?? 200;
  if (graphqlResponse.body.kind === "complete") {
    response.end(graphqlResponse.body.string);
    return;
  }
  for await (const chunk of graphqlResponse.body.asyncIterator) {
    response.write(chunk);
  }
  response.end();
}

function sendGraphqlOptions(response: ServerResponse, requestId: string): void {
  response.writeHead(204, {
    "x-request-id": requestId,
    ...corsHeaders()
  });
  response.end();
}

function sendGraphqlJson(response: ServerResponse, status: number, body: unknown, requestId: string): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "x-request-id": requestId,
    ...corsHeaders()
  });
  response.end(payload);
}

function setCorsHeaders(response: ServerResponse): void {
  for (const [key, value] of Object.entries(corsHeaders())) {
    response.setHeader(key, value);
  }
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": process.env.GRAPHQL_CORS_ORIGIN ?? defaultCorsOrigin(),
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-project-memory-client-id,x-project-memory-client-label,x-project-memory-client-kind,x-request-id",
    "access-control-expose-headers": "x-request-id",
    vary: "origin"
  };
}

// T-MEMORY-060 (whitebox pentest finding #5, I-MEMORY-055): the web UI is
// always same-origin with this API (nginx serves both from one vhost), so
// scoping this to that origin has zero effect on legitimate use -- "*" only
// ever helped a cross-origin attacker page, and bearer-token auth + a
// SameSite=Lax session cookie already mean stolen credentials aren't usable
// cross-origin anyway (this was a low-risk finding, not a live exploit).
// Derived from PROJECT_MEMORY_PUBLIC_URL (already set in every real
// deployment for the OAuth facade) so this tightens automatically with no
// new required env var; GRAPHQL_CORS_ORIGIN above still wins if set
// explicitly, and "*" remains the fallback only when neither is configured.
function defaultCorsOrigin(): string {
  const publicUrl = process.env.PROJECT_MEMORY_PUBLIC_URL;
  if (!publicUrl) {
    return "*";
  }
  try {
    return new URL(publicUrl).origin;
  } catch {
    return "*";
  }
}

function operationNameFromBody(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const value = (body as Row).operationName;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
