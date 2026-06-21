import { startGatewayServer } from "../src/gateway/http-server.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { createPgKnex } from "../src/shared/pg/knex.js";
import type { ToolResponse } from "../src/shared/mcp/tool-response.js";

const db = createPgKnex();
const service = new PgToolService(db);
const token = `gateway-graphql-smoke-token-${Date.now()}`;
const started = await startGatewayServer(service, {
  host: "127.0.0.1",
  port: 0,
  token
});
const graphqlPath = `${normalizedApiEndpoint() ?? ""}/graphql`;
const graphqlUrl = `${started.url}${graphqlPath}`;

const unique = Date.now();
const clientId = `gateway-graphql-smoke-${unique}`;
const projectSlug = `gateway-graphql-smoke-${unique}`;
let projectId: string | undefined;

try {
  const unauthorized = await fetch(graphqlUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "{ gatewayStatus }" })
  });
  assert(unauthorized.status === 401, `GraphQL endpoint did not reject missing auth. Status: ${unauthorized.status}`);
  console.log("ok - graphql auth required");

  const options = await fetch(graphqlUrl, { method: "OPTIONS" });
  assert(options.status === 204, `GraphQL OPTIONS did not return 204. Status: ${options.status}`);
  console.log("ok - graphql cors preflight");

  const status = await graphql<{ gatewayStatus: { storage: string } }>("{ gatewayStatus }");
  assert(status.gatewayStatus.storage === "postgresql", "GraphQL gatewayStatus did not expose PostgreSQL storage.");
  console.log("ok - graphql gatewayStatus");

  const created = await graphql<{
    createProject: { id: string; slug: string };
    createTask: { id: string; title: string; status: string };
    putTextArtifact: { id: string; path: string; title: string };
  }>(
    `mutation CreateSmoke($project: CreateProjectInput!, $task: CreateTaskInput!, $artifact: PutTextArtifactInput!) {
      createProject(input: $project) { id slug }
      createTask(input: $task) { id title status }
      putTextArtifact(input: $artifact) { id path title }
    }`,
    {
      project: {
        slug: projectSlug,
        title: `Gateway GraphQL Smoke ${unique}`
      },
      task: {
        project: projectSlug,
        title: "Gateway GraphQL smoke task",
        scope: "Verify GraphQL task list.",
        acceptance: "GraphQL returns this task.",
        priority: 1
      },
      artifact: {
        project: projectSlug,
        path: "docs/graphql-smoke.md",
        title: "GraphQL Smoke Artifact",
        text: "# GraphQL Smoke\n\nThis text should be readable without base64.",
        contentType: "text/markdown; charset=utf-8",
        tags: ["smoke", "graphql"]
      }
    }
  );
  projectId = created.createProject.id;
  const taskId = created.createTask.id;
  const artifactId = created.putTextArtifact.id;
  assert(created.createTask.status === "todo", "GraphQL createTask did not create a todo task.");
  console.log("ok - graphql create mutations");

  const memoryCreated = await callGateway("memory.create", {
    project: projectId,
    type: "note",
    title: "GraphQL pagination smoke memory",
    body: "GraphQL pagination smoke memory validates memorySearchPage totalCount and items.",
    tags: ["smoke", "graphql", "pagination"]
  });
  assert(memoryCreated.ok, "GraphQL smoke memory.create failed.");
  const memoryId = String((memoryCreated.data as { item?: { id?: string } }).item?.id);
  assert(memoryId.startsWith("I-"), "GraphQL smoke memory.create did not return an I-* item.");
  const linkCreated = await callGateway("link.create", {
    project: projectId,
    fromId: memoryId,
    toId: taskId,
    relation: "documents"
  });
  assert(linkCreated.ok, "GraphQL smoke link.create failed.");
  const linkId = String((linkCreated.data as { link?: { id?: string } }).link?.id);
  assert(linkId.startsWith("L-"), "GraphQL smoke link.create did not return an L-* link.");

  const data = await graphql<{
    project: { id: string; slug: string; title: string };
    tasks: Array<{ id: string; title: string; status: string }>;
    artifactText: { path: string; text: string; textInfo: { base64Included: boolean } };
    projectSummary: {
      project: { id: string };
      counts: { tasks: number; artifacts: number };
      openTasks: Array<{ id: string; title: string }>;
    };
  }>(
    `query Smoke($project: String!, $path: String!) {
      project(slug: "${projectSlug}") { id slug title }
      tasks(project: $project) { id title status }
      artifactText(project: $project, path: $path, maxBytes: 2000) {
        path
        text
        textInfo { base64Included }
      }
      projectSummary(project: $project) {
        project { id }
        counts { tasks artifacts }
        openTasks { id title }
      }
    }`,
    { project: projectId, path: "docs/graphql-smoke.md" }
  );

  assert(data.project.id === projectId, "GraphQL project query returned wrong project.");
  assert(data.tasks.some((task) => task.title === "Gateway GraphQL smoke task"), "GraphQL tasks query missed smoke task.");
  assert(data.artifactText.text.includes("readable without base64"), "GraphQL artifactText did not return text.");
  assert(data.artifactText.textInfo.base64Included === false, "GraphQL artifactText included base64.");
  assert(data.projectSummary.counts.tasks >= 1, "GraphQL projectSummary did not report task count.");
  assert(data.projectSummary.counts.artifacts >= 1, "GraphQL projectSummary did not report artifact count.");
  console.log("ok - graphql project explorer queries");

  const pages = await graphql<{
    projectsPage: { items: Array<{ id: string }>; pageInfo: PageInfo };
    gatewayClientsPage: { items: Array<{ id: string }>; pageInfo: PageInfo };
    tasksPage: { items: Array<{ id: string }>; pageInfo: PageInfo };
    artifactsPage: { items: Array<{ id: string }>; pageInfo: PageInfo };
    artifactSearchPage: { items: Array<{ id: string }>; pageInfo: PageInfo };
    memoryItemsPage: { items: Array<{ id: string }>; pageInfo: PageInfo };
    memorySearchPage: { items: Array<{ id: string }>; pageInfo: PageInfo };
    eventsPage: { items: Array<{ id: string }>; pageInfo: PageInfo };
    links: Array<{ id: string; fromId: string; toId: string; relation: string }>;
    linksPage: { items: Array<{ id: string }>; pageInfo: PageInfo };
  }>(
    `query Pages($project: String!, $memoryId: ID!) {
      projectsPage(status: "active", pagination: { limit: 2, offset: 0 }) {
        items { id }
        pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
      }
      gatewayClientsPage(pagination: { limit: 5, offset: 0 }) {
        items { id }
        pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
      }
      tasksPage(project: $project, pagination: { limit: 1, offset: 0 }) {
        items { id }
        pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
      }
      artifactsPage(project: $project, includeArchived: true, pagination: { limit: 1, offset: 0 }) {
        items { id }
        pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
      }
      artifactSearchPage(project: $project, query: "GraphQL", includeArchived: true, pagination: { limit: 1, offset: 0 }) {
        items { id }
        pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
      }
      memoryItemsPage(project: $project, pagination: { limit: 1, offset: 0 }) {
        items { id }
        pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
      }
      memorySearchPage(project: $project, query: "GraphQL pagination smoke", pagination: { limit: 1, offset: 0 }) {
        items { id }
        pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
      }
      eventsPage(project: $project, pagination: { limit: 2, offset: 0 }) {
        items { id }
        pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
      }
      links(id: $memoryId) {
        id
        fromId
        toId
        relation
      }
      linksPage(project: $project, pagination: { limit: 1, offset: 0 }) {
        items { id }
        pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
      }
    }`,
    { project: projectId, memoryId }
  );
  assertPage(pages.projectsPage.pageInfo, 2, 0, 1, "projectsPage");
  assertPage(pages.gatewayClientsPage.pageInfo, 5, 0, 1, "gatewayClientsPage");
  assertPage(pages.tasksPage.pageInfo, 1, 0, 1, "tasksPage");
  assertPage(pages.artifactsPage.pageInfo, 1, 0, 1, "artifactsPage");
  assertPage(pages.artifactSearchPage.pageInfo, 1, 0, 1, "artifactSearchPage");
  assertPage(pages.memoryItemsPage.pageInfo, 1, 0, 1, "memoryItemsPage");
  assertPage(pages.memorySearchPage.pageInfo, 1, 0, 1, "memorySearchPage");
  assertPage(pages.eventsPage.pageInfo, 2, 0, 1, "eventsPage");
  assert(pages.links.some((link) => link.id === linkId), "GraphQL links query missed smoke link.");
  assertPage(pages.linksPage.pageInfo, 1, 0, 1, "linksPage");
  console.log("ok - graphql paginated table queries");

  const updated = await graphql<{
    updateTaskStatus: { id: string; status: string };
    updateArtifactMetadata: { id: string; title: string; tags: string[] };
    archiveArtifact: { action: string; artifact: { id: string; status: string } };
  }>(
    `mutation UpdateSmoke($taskId: ID!, $artifactId: ID!) {
      updateTaskStatus(id: $taskId, status: "doing", note: "GraphQL smoke status update.") { id status }
      updateArtifactMetadata(input: { id: $artifactId, title: "GraphQL Smoke Artifact Updated", tags: ["smoke", "graphql", "updated"] }) {
        id
        title
        tags
      }
      archiveArtifact(id: $artifactId, reason: "GraphQL smoke archive.") {
        action
        artifact { id status }
      }
    }`,
    { taskId, artifactId }
  );
  assert(updated.updateTaskStatus.status === "doing", "GraphQL updateTaskStatus did not update status.");
  assert(updated.updateArtifactMetadata.title === "GraphQL Smoke Artifact Updated", "GraphQL updateArtifactMetadata did not update title.");
  assert(updated.archiveArtifact.artifact.status === "archived", "GraphQL archiveArtifact did not archive artifact.");
  console.log("ok - graphql update/archive mutations");

  const tempTask = await graphql<{ createTask: { id: string } }>(
    `mutation TempTask($task: CreateTaskInput!) {
      createTask(input: $task) { id }
    }`,
    {
      task: {
        project: projectId,
        title: "Gateway GraphQL smoke delete task",
        priority: 99
      }
    }
  );
  const deletedTask = await graphql<{ deleteTask: { deletedTask: { id: string }; event: { type: string } } }>(
    `mutation DeleteTask($id: ID!) {
      deleteTask(id: $id, reason: "GraphQL smoke task cleanup.") {
        deletedTask { id }
        event { type }
      }
    }`,
    { id: tempTask.createTask.id }
  );
  assert(deletedTask.deleteTask.deletedTask.id === tempTask.createTask.id, "GraphQL deleteTask returned wrong task.");
  console.log("ok - graphql deleteTask mutation");

  const deleted = await graphql<{ deleteProject: { deletedProject: { id: string }; cascade: boolean } }>(
    `mutation DeleteProject($id: ID!) {
      deleteProject(id: $id, cascade: true, reason: "Gateway GraphQL smoke cleanup.") {
        deletedProject { id }
        cascade
      }
    }`,
    { id: projectId }
  );
  assert(deleted.deleteProject.deletedProject.id === projectId, "GraphQL deleteProject returned wrong project.");
  projectId = undefined;
  console.log("ok - graphql deleteProject cleanup");

  console.log(`Gateway GraphQL smoke test passed using ${graphqlUrl}`);
} finally {
  if (projectId) {
    const cleanup = await callGateway("project.delete", {
      id: projectId,
      cascade: true,
      reason: "Gateway GraphQL smoke cleanup after failure."
    });
    if (!cleanup.ok) {
      await db("projects").where({ id: projectId }).del();
    }
  }
  await db("gateway_clients").where({ id: clientId }).del();
  await started.stop();
  await service.close();
}

async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(graphqlUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-project-memory-client-id": clientId,
      "x-project-memory-client-label": "Gateway GraphQL Smoke",
      "x-project-memory-client-kind": "smoke"
    },
    body: JSON.stringify({ query, variables })
  });
  assert(response.ok, `GraphQL HTTP request returned ${response.status}.`);
  const body = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);
  }
  assert(body.data, "GraphQL response did not include data.");
  return body.data;
}

async function callGateway(tool: string, input: unknown): Promise<ToolResponse<unknown>> {
  const response = await fetch(`${started.url}/call`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-project-memory-client-id": clientId,
      "x-project-memory-client-label": "Gateway GraphQL Smoke",
      "x-project-memory-client-kind": "smoke"
    },
    body: JSON.stringify({ tool, input })
  });
  assert(response.ok, `Gateway call ${tool} returned HTTP ${response.status}.`);
  return (await response.json()) as ToolResponse<unknown>;
}

type PageInfo = {
  limit: number;
  offset: number;
  totalCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

function assertPage(pageInfo: PageInfo, limit: number, offset: number, minTotalCount: number, label: string): void {
  assert(pageInfo.limit === limit, `${label} returned wrong limit.`);
  assert(pageInfo.offset === offset, `${label} returned wrong offset.`);
  assert(pageInfo.totalCount >= minTotalCount, `${label} returned too small totalCount.`);
  assert(pageInfo.hasPreviousPage === (offset > 0), `${label} returned wrong hasPreviousPage.`);
  assert(
    pageInfo.hasNextPage === offset + limit < pageInfo.totalCount,
    `${label} returned wrong hasNextPage.`
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizedApiEndpoint(): string | null {
  const raw = process.env.API_ENDPOINT?.trim();
  if (!raw || raw === "/") {
    return null;
  }
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.replace(/\/+$/, "");
}
