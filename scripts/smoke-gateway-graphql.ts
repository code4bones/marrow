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

  const project = await callGateway("project.create", {
    slug: projectSlug,
    title: `Gateway GraphQL Smoke ${unique}`
  });
  projectId = expectData<{ project: { id: string } }>(project).project.id;

  await callGateway("task.create", {
    project: projectId,
    title: "Gateway GraphQL smoke task",
    scope: "Verify GraphQL task list.",
    acceptance: "GraphQL returns this task.",
    priority: 1
  });

  await callGateway("artifact.put_text", {
    project: projectId,
    path: "docs/graphql-smoke.md",
    title: "GraphQL Smoke Artifact",
    text: "# GraphQL Smoke\n\nThis text should be readable without base64.",
    contentType: "text/markdown; charset=utf-8",
    tags: ["smoke", "graphql"]
  });

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

  const deleted = await callGateway("project.delete", {
    id: projectId,
    cascade: true,
    reason: "Gateway GraphQL smoke cleanup."
  });
  assert(expectData<{ deletedProject: { id: string } }>(deleted).deletedProject.id === projectId, "project.delete returned wrong project.");
  projectId = undefined;
  console.log("ok - graphql smoke cleanup");

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

function expectData<T>(response: ToolResponse<unknown>): T {
  assert(response.ok, response.ok ? "Unexpected gateway failure." : response.error.message);
  return response.data as T;
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
