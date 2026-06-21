import { ApolloServer, HeaderMap, type HTTPGraphQLResponse } from "@apollo/server";
import { GraphQLError, GraphQLScalarType, Kind, type ValueNode } from "graphql";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AppError } from "../shared/errors.js";
import type { ToolResponse } from "../shared/mcp/tool-response.js";
import type { AppLogger } from "../shared/logging/logger.js";
import type { GatewayRequestContext } from "./pg-tool-service.js";

type Row = Record<string, unknown>;

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
    gatewayClients(anonymous: Boolean, staleOlderThanSeconds: Int, limit: Int): [GatewayClient!]!
    gatewayClientsPage(anonymous: Boolean, staleOlderThanSeconds: Int, pagination: PaginationInput): PaginatedGatewayClients!

    projects(status: String): [Project!]!
    projectsPage(status: String, pagination: PaginationInput): PaginatedProjects!
    project(id: ID, slug: String): Project!
    projectSummary(project: String!, query: String, includeCommon: Boolean, limits: ProjectSummaryLimitsInput): ProjectSummary!
    projectGraph(projectId: ID!, depth: Int = 2): ProjectGraph!
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
    tasksPage(project: String!, status: String, milestone: String, pagination: PaginationInput): PaginatedTasks!
    task(id: ID!): Task!
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
  }

  type Mutation {
    createProject(input: CreateProjectInput!): Project!
    deleteProject(id: ID, slug: String, cascade: Boolean, reason: String): DeleteProjectResult!

    createMemory(input: CreateMemoryInput!): MemoryRecord!
    updateMemory(input: UpdateMemoryInput!): MemoryRecord!
    archiveMemory(id: ID!, reason: String): ArchiveMemoryResult!
    deleteMemory(id: ID!, reason: String): DeleteMemoryResult!

    createTask(input: CreateTaskInput!): Task!
    updateTaskStatus(id: ID!, status: String!, note: String): Task!
    deleteTask(id: ID!, reason: String): DeleteTaskResult!

    recordDecision(input: RecordDecisionInput!): Decision!
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

  input CreateMemoryInput {
    id: ID
    project: String
    common: Boolean
    type: String!
    title: String!
    body: String!
    status: String
    tags: [String!]
  }

  input UpdateMemoryInput {
    id: ID!
    title: String
    body: String
    status: String
    tags: [String!]
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
    createdAt: String
    updatedAt: String
  }

  type PaginatedProjects {
    items: [Project!]!
    pageInfo: PageInfo!
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
  }

  type GraphEdge {
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
    rank: Float
    createdAt: String
    updatedAt: String
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

  type Task {
    id: ID!
    projectId: String
    title: String
    status: String!
    milestone: String
    priority: Int
    scope: String
    acceptance: String
    allowedFiles: [String!]!
    forbiddenFiles: [String!]!
    dependsOn: [String!]!
    notes: String
    createdAt: String
    updatedAt: String
  }

  type PaginatedTasks {
    items: [Task!]!
    pageInfo: PageInfo!
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
    createdAt: String
    updatedAt: String
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

  type ArtifactSearchResult {
    id: ID!
    projectId: String
    scope: String!
    path: String!
    title: String!
    description: String
    status: String
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
      await pageQuery(context, "links", cleanInput(args))
  },
  Mutation: {
    createProject: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "project.create", cleanInput(args.input as Row))).project,
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
    deleteTask: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      await callTool<Row>(context, "task.delete", cleanInput(args)),
    recordDecision: async (_parent: unknown, args: Row, context: GatewayGraphqlContext) =>
      (await callTool<Row>(context, "decision.record", cleanInput(args.input as Row))).decision,
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
      await callTool<Row>(context, "link.delete", cleanInput(args))
  }
};

export async function createGatewayGraphqlServer(): Promise<GatewayGraphqlServer> {
  const server = new ApolloServer<GatewayGraphqlContext>({
    typeDefs,
    resolvers,
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
    "access-control-allow-origin": process.env.GRAPHQL_CORS_ORIGIN ?? "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-project-memory-client-id,x-project-memory-client-label,x-project-memory-client-kind,x-request-id",
    "access-control-expose-headers": "x-request-id",
    vary: "origin"
  };
}

function operationNameFromBody(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const value = (body as Row).operationName;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
