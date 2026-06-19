import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { startGatewayServer } from "../src/gateway/http-server.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { createPgKnex } from "../src/shared/pg/knex.js";

const db = createPgKnex();
const service = new PgToolService(db);
const token = `gateway-mcp-http-smoke-token-${Date.now()}`;
const started = await startGatewayServer(service, {
  host: "127.0.0.1",
  port: 0,
  token
});
const clientId = `gateway-mcp-http-smoke-${Date.now()}`;
const secondClientId = `gateway-mcp-http-smoke-second-${Date.now()}`;
const endpoint = new URL(`${started.url}/mcp`);
endpoint.searchParams.set("client_id", clientId);
endpoint.searchParams.set("client_label", "Gateway MCP HTTP Smoke");
endpoint.searchParams.set("client_kind", "mcp-http");
const secondEndpoint = new URL(`${started.url}/mcp`);
secondEndpoint.searchParams.set("client_id", secondClientId);
secondEndpoint.searchParams.set("client_label", "Gateway MCP HTTP Smoke Second");
secondEndpoint.searchParams.set("client_kind", "mcp-http");

const transport = new StreamableHTTPClientTransport(endpoint, {
  requestInit: {
    headers: {
      authorization: `Bearer ${token}`
    }
  }
});
const secondTransport = new StreamableHTTPClientTransport(secondEndpoint, {
  requestInit: {
    headers: {
      authorization: `Bearer ${token}`
    }
  }
});

const client = new Client({
  name: "project-memory-gateway-mcp-http-smoke",
  version: "0.1.0"
});
const secondClient = new Client({
  name: "project-memory-gateway-mcp-http-smoke-second",
  version: "0.1.0"
});

const state: {
  projectId?: string;
  secondProjectId?: string;
  taskId?: string;
  artifactId?: string;
  artifactPath?: string;
} = {};

try {
  await client.connect(transport);
  await secondClient.connect(secondTransport);

  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name);
  assert(toolNames.includes("gateway.about"), "gateway.about tool was not listed.");
  assert(toolNames.includes("gateway.version"), "gateway.version tool was not listed.");
  assert(toolNames.includes("gateway.diagnostics"), "gateway.diagnostics tool was not listed.");
  assert(toolNames.includes("gateway.backup_manifest"), "gateway.backup_manifest tool was not listed.");
  assert(toolNames.includes("gateway.manuals"), "gateway.manuals tool was not listed.");
  assert(toolNames.includes("gateway.status"), "gateway.status tool was not listed.");
  assert(toolNames.includes("gateway.clients"), "gateway.clients tool was not listed.");
  assert(toolNames.includes("gateway.client_get"), "gateway.client_get tool was not listed.");
  assert(toolNames.includes("gateway.client_forget"), "gateway.client_forget tool was not listed.");
  assert(toolNames.includes("gateway.client_prune"), "gateway.client_prune tool was not listed.");
  assert(toolNames.includes("project.create"), "project.create tool was not listed.");
  assert(toolNames.includes("project.resolve"), "project.resolve tool was not listed.");
  assert(toolNames.includes("memory.upsert"), "memory.upsert tool was not listed.");
  assert(toolNames.includes("failed_attempt.record"), "failed_attempt.record tool was not listed.");
  assert(toolNames.includes("decision.supersede"), "decision.supersede tool was not listed.");
  assert(toolNames.includes("artifact.update_metadata"), "artifact.update_metadata tool was not listed.");
  assert(toolNames.includes("artifact.archive"), "artifact.archive tool was not listed.");
  assert(toolNames.includes("artifact.list"), "artifact.list tool was not listed.");
  assert(toolNames.includes("memory.search"), "memory.search tool was not listed.");
  assert(toolNames.includes("preflight"), "preflight tool was not listed.");
  assert(toolNames.includes("preflight.by_query"), "preflight.by_query tool was not listed.");
  assert(toolNames.includes("handoff.create"), "handoff.create tool was not listed.");
  console.log(`ok - gateway MCP HTTP listed ${toolNames.length} tools`);

  const aboutResult = await client.callTool({
    name: "gateway.about",
    arguments: {}
  });
  assertOk(aboutResult.structuredContent, "gateway.about failed.");
  assert(
    readNestedString(aboutResult.structuredContent, ["data", "about", "shortName"]) === "pmem",
    "gateway.about did not describe pmem."
  );
  assert(
    readNestedString(aboutResult.structuredContent, ["data", "about", "manuals", "tool"]) === "gateway.manuals",
    "gateway.about did not point at gateway.manuals."
  );
  const connectionSnippets = readNestedArray(aboutResult.structuredContent, ["data", "about", "connectionSnippets"]);
  assert(
    connectionSnippets.some((snippet) => isRecord(snippet) && snippet.client === "codex"),
    "gateway.about did not include Codex connection snippet."
  );
  assert(
    connectionSnippets.some((snippet) => isRecord(snippet) && snippet.client === "codewhale"),
    "gateway.about did not include CodeWhale connection snippet."
  );

  const manualsResult = await client.callTool({
    name: "gateway.manuals",
    arguments: {
      audience: "all",
      includeContent: true
    }
  });
  assertOk(manualsResult.structuredContent, "gateway.manuals failed.");
  const manuals = readNestedArray(manualsResult.structuredContent, ["data", "manuals"]);
  assert(manuals.length >= 2, "gateway.manuals did not return both manuals.");
  assert(
    manuals.some(
      (manual) =>
        isRecord(manual) &&
        manual.id === "developer" &&
        typeof manual.content === "string" &&
        manual.content.includes("Developer Manual")
    ),
    "gateway.manuals did not return developer Markdown content."
  );
  assert(
    manuals.some(
      (manual) =>
        isRecord(manual) &&
        manual.id === "agent" &&
        typeof manual.content === "string" &&
        manual.content.includes("Agent Guide")
    ),
    "gateway.manuals did not return agent Markdown content."
  );

  const statusResult = await client.callTool({
    name: "gateway.status",
    arguments: {}
  });
  assertOk(statusResult.structuredContent, "gateway.status failed.");

  const versionResult = await client.callTool({
    name: "gateway.version",
    arguments: {}
  });
  assertOk(versionResult.structuredContent, "gateway.version failed.");
  assert(
    readNestedString(versionResult.structuredContent, ["data", "version", "packageName"]) === "@deadragdoll/pm3m",
    "gateway.version returned the wrong package name."
  );

  const diagnosticsResult = await client.callTool({
    name: "gateway.diagnostics",
    arguments: {}
  });
  assertOk(diagnosticsResult.structuredContent, "gateway.diagnostics failed.");
  assert(
    readNestedString(diagnosticsResult.structuredContent, ["data", "diagnostics", "version", "packageName"]) ===
      "@deadragdoll/pm3m",
    "gateway.diagnostics did not include version metadata."
  );

  const backupManifestResult = await client.callTool({
    name: "gateway.backup_manifest",
    arguments: {}
  });
  assertOk(backupManifestResult.structuredContent, "gateway.backup_manifest failed.");
  assert(
    readNestedString(backupManifestResult.structuredContent, ["data", "manifest", "database", "engine"]) ===
      "postgresql",
    "gateway.backup_manifest did not include PostgreSQL backup scope."
  );
  assert(
    !JSON.stringify(backupManifestResult.structuredContent).includes("password"),
    "gateway.backup_manifest exposed password metadata."
  );

  const clientsResult = await client.callTool({
    name: "gateway.clients",
    arguments: {}
  });
  assertOk(clientsResult.structuredContent, "gateway.clients failed.");
  const clientIds = readNestedArray(clientsResult.structuredContent, ["data", "clients"]).map((item) =>
    isRecord(item) ? item.id : undefined
  );
  assert(clientIds.includes(clientId), "gateway.clients did not include the MCP HTTP smoke client.");
  console.log("ok - gateway MCP HTTP status and clients");

  const unique = Date.now();
  const projectResult = await client.callTool({
    name: "project.create",
    arguments: {
      slug: `gateway-mcp-http-smoke-${unique}`,
      title: `Gateway MCP HTTP Smoke ${unique}`,
      rootPath: `/tmp/gateway-mcp-http-smoke-${unique}`
    }
  });
  assertOk(projectResult.structuredContent, "project.create failed.");
  state.projectId = readNestedString(projectResult.structuredContent, ["data", "project", "id"]);

  const projectResolveResult = await client.callTool({
    name: "project.resolve",
    arguments: {
      rootPath: `/tmp/gateway-mcp-http-smoke-${unique}/src`
    }
  });
  assertOk(projectResolveResult.structuredContent, "project.resolve failed.");
  assert(
    readNestedString(projectResolveResult.structuredContent, ["data", "resolved", "id"]) === state.projectId,
    "project.resolve did not resolve the project by child rootPath."
  );

  const currentResult = await client.callTool({
    name: "project.set_current",
    arguments: {
      id: state.projectId
    }
  });
  assertOk(currentResult.structuredContent, "project.set_current failed.");

  const secondProjectResult = await secondClient.callTool({
    name: "project.create",
    arguments: {
      slug: `gateway-mcp-http-smoke-second-${unique}`,
      title: `Gateway MCP HTTP Smoke Second ${unique}`,
      rootPath: `/tmp/gateway-mcp-http-smoke-second-${unique}`
    }
  });
  assertOk(secondProjectResult.structuredContent, "second project.create failed.");
  state.secondProjectId = readNestedString(secondProjectResult.structuredContent, ["data", "project", "id"]);

  const secondCurrentResult = await secondClient.callTool({
    name: "project.set_current",
    arguments: {
      id: state.secondProjectId
    }
  });
  assertOk(secondCurrentResult.structuredContent, "second project.set_current failed.");

  const firstCurrentResult = await client.callTool({
    name: "project.current",
    arguments: {}
  });
  assertOk(firstCurrentResult.structuredContent, "first project.current failed.");
  assert(
    readNestedString(firstCurrentResult.structuredContent, ["data", "project", "id"]) === state.projectId,
    "first client current project was changed by the second client."
  );

  const secondCurrentCheckResult = await secondClient.callTool({
    name: "project.current",
    arguments: {}
  });
  assertOk(secondCurrentCheckResult.structuredContent, "second project.current failed.");
  assert(
    readNestedString(secondCurrentCheckResult.structuredContent, ["data", "project", "id"]) === state.secondProjectId,
    "second client current project did not stay client-scoped."
  );

  const memoryResult = await client.callTool({
    name: "memory.create",
    arguments: {
      project: state.projectId,
      type: "agent_rule",
      title: "Gateway MCP HTTP smoke rule",
      body: "Gateway should expose MCP tools directly over Streamable HTTP.",
      tags: ["smoke", "gateway-mcp-http"]
    }
  });
  assertOk(memoryResult.structuredContent, "memory.create failed.");

  const upsertCreateResult = await client.callTool({
    name: "memory.upsert",
    arguments: {
      project: state.projectId,
      type: "workflow_rule",
      title: "Gateway MCP HTTP smoke upsert",
      body: "First upsert call should create this record.",
      tags: ["smoke", "upsert"],
      match: "scope_type_title"
    }
  });
  assertOk(upsertCreateResult.structuredContent, "memory.upsert create failed.");
  assert(
    readNestedString(upsertCreateResult.structuredContent, ["data", "action"]) === "created",
    "memory.upsert did not report created on first call."
  );
  const upsertedItemId = readNestedString(upsertCreateResult.structuredContent, ["data", "item", "id"]);

  const upsertUpdateResult = await client.callTool({
    name: "memory.upsert",
    arguments: {
      project: state.projectId,
      type: "workflow_rule",
      title: "Gateway MCP HTTP smoke upsert",
      body: "Second upsert call should update this record.",
      tags: ["smoke", "upsert", "updated"],
      match: "scope_type_title"
    }
  });
  assertOk(upsertUpdateResult.structuredContent, "memory.upsert update failed.");
  assert(
    readNestedString(upsertUpdateResult.structuredContent, ["data", "action"]) === "updated",
    "memory.upsert did not report updated on second call."
  );
  assert(
    readNestedString(upsertUpdateResult.structuredContent, ["data", "item", "id"]) === upsertedItemId,
    "memory.upsert created a duplicate instead of updating the existing item."
  );

  const preflightByQueryResult = await client.callTool({
    name: "preflight.by_query",
    arguments: {
      project: state.projectId,
      query: "Gateway MCP HTTP smoke",
      limits: {
        items: 5,
        decisions: 5,
        artifacts: 5
      }
    }
  });
  assertOk(preflightByQueryResult.structuredContent, "preflight.by_query failed.");
  assert(
    readNestedString(preflightByQueryResult.structuredContent, ["data", "project", "id"]) === state.projectId,
    "preflight.by_query returned the wrong project."
  );
  assert(
    readNestedString(preflightByQueryResult.structuredContent, ["data", "query"]) === "Gateway MCP HTTP smoke",
    "preflight.by_query returned the wrong query."
  );

  const originalDecisionResult = await client.callTool({
    name: "decision.record",
    arguments: {
      project: state.projectId,
      title: "Gateway MCP HTTP smoke original decision",
      decision: "Original smoke decision.",
      rationale: "The supersede smoke test needs an active source decision.",
      tags: ["smoke", "decision"]
    }
  });
  assertOk(originalDecisionResult.structuredContent, "decision.record failed.");
  const originalDecisionId = readNestedString(originalDecisionResult.structuredContent, ["data", "decision", "id"]);

  const supersedeDecisionResult = await client.callTool({
    name: "decision.supersede",
    arguments: {
      supersedesId: originalDecisionId,
      title: "Gateway MCP HTTP smoke replacement decision",
      decision: "Replacement smoke decision.",
      rationale: "The gateway should provide an explicit decision supersede workflow.",
      tags: ["smoke", "decision", "supersede"]
    }
  });
  assertOk(supersedeDecisionResult.structuredContent, "decision.supersede failed.");
  assert(
    readNestedString(supersedeDecisionResult.structuredContent, ["data", "decision", "supersedesId"]) ===
      originalDecisionId,
    "decision.supersede did not link the replacement to the old decision."
  );
  assert(
    readNestedString(supersedeDecisionResult.structuredContent, ["data", "superseded", "status"]) === "superseded",
    "decision.supersede did not mark the old decision as superseded."
  );
  assert(
    readNestedString(supersedeDecisionResult.structuredContent, ["data", "link", "relation"]) === "supersedes",
    "decision.supersede did not create a supersedes link."
  );

  state.artifactPath = `gateway-smoke/AGENTS-${unique}.md`;
  const artifactContent = "# Gateway Smoke AGENTS\n\nUse preflight before editing files.\n";
  const artifactResult = await client.callTool({
    name: "artifact.put",
    arguments: {
      common: true,
      path: state.artifactPath,
      title: "Gateway smoke AGENTS template",
      description: "Smoke test artifact for gateway file storage.",
      contentType: "text/markdown; charset=utf-8",
      contentBase64: Buffer.from(artifactContent, "utf8").toString("base64"),
      tags: ["smoke", "agents-template"],
      overwrite: true
    }
  });
  assertOk(artifactResult.structuredContent, "artifact.put failed.");
  state.artifactId = readNestedString(artifactResult.structuredContent, ["data", "artifact", "id"]);

  const artifactSearchResult = await client.callTool({
    name: "artifact.search",
    arguments: {
      query: "Gateway Smoke AGENTS",
      includeCommon: true,
      limit: 5
    }
  });
  assertOk(artifactSearchResult.structuredContent, "artifact.search failed.");
  const artifactIds = readNestedArray(artifactSearchResult.structuredContent, ["data", "results"]).map((item) =>
    isRecord(item) ? item.id : undefined
  );
  assert(artifactIds.includes(state.artifactId), "artifact.search did not include smoke artifact.");

  const artifactGetResult = await client.callTool({
    name: "artifact.get",
    arguments: {
      id: state.artifactId,
      includeContent: true
    }
  });
  assertOk(artifactGetResult.structuredContent, "artifact.get failed.");
  assert(
    readNestedString(artifactGetResult.structuredContent, ["data", "artifact", "contentBase64"]) ===
      Buffer.from(artifactContent, "utf8").toString("base64"),
    "artifact.get did not return expected inline content."
  );

  const artifactMetadataResult = await client.callTool({
    name: "artifact.update_metadata",
    arguments: {
      id: state.artifactId,
      title: "Gateway smoke AGENTS template updated",
      description: "Updated smoke test artifact metadata.",
      tags: ["smoke", "agents-template", "metadata"]
    }
  });
  assertOk(artifactMetadataResult.structuredContent, "artifact.update_metadata failed.");
  assert(
    readNestedString(artifactMetadataResult.structuredContent, ["data", "artifact", "title"]) ===
      "Gateway smoke AGENTS template updated",
    "artifact.update_metadata did not update the artifact title."
  );

  const artifactListResult = await client.callTool({
    name: "artifact.list",
    arguments: {
      common: true,
      pathPrefix: "gateway-smoke",
      tags: ["metadata"],
      limit: 5
    }
  });
  assertOk(artifactListResult.structuredContent, "artifact.list failed.");
  const listedArtifactIds = readNestedArray(artifactListResult.structuredContent, ["data", "artifacts"]).map((item) =>
    isRecord(item) ? item.id : undefined
  );
  assert(listedArtifactIds.includes(state.artifactId), "artifact.list did not include active smoke artifact.");

  const downloadPath = readNestedString(artifactGetResult.structuredContent, ["data", "artifact", "downloadPath"]);
  const downloadResponse = await fetch(`${started.url}${downloadPath}`, {
    headers: {
      authorization: `Bearer ${token}`
    }
  });
  assert(downloadResponse.ok, `artifact download failed with ${downloadResponse.status}`);
  assert((await downloadResponse.text()) === artifactContent, "artifact download content mismatch.");

  const archiveArtifactResult = await client.callTool({
    name: "artifact.archive",
    arguments: {
      id: state.artifactId,
      reason: "Archive smoke artifact after validating download."
    }
  });
  assertOk(archiveArtifactResult.structuredContent, "artifact.archive failed.");
  assert(
    readNestedString(archiveArtifactResult.structuredContent, ["data", "artifact", "status"]) === "archived",
    "artifact.archive did not mark the artifact as archived."
  );

  const archivedSearchResult = await client.callTool({
    name: "artifact.search",
    arguments: {
      query: "Gateway smoke AGENTS template updated",
      includeCommon: true,
      includeArchived: true,
      limit: 5
    }
  });
  assertOk(archivedSearchResult.structuredContent, "artifact.search includeArchived failed.");
  const archivedArtifactIds = readNestedArray(archivedSearchResult.structuredContent, ["data", "results"]).map((item) =>
    isRecord(item) ? item.id : undefined
  );
  assert(archivedArtifactIds.includes(state.artifactId), "artifact.search includeArchived did not include archived artifact.");

  const activeSearchResult = await client.callTool({
    name: "artifact.search",
    arguments: {
      query: "Gateway smoke AGENTS template updated",
      includeCommon: true,
      limit: 5
    }
  });
  assertOk(activeSearchResult.structuredContent, "artifact.search active-only failed.");
  const activeArtifactIds = readNestedArray(activeSearchResult.structuredContent, ["data", "results"]).map((item) =>
    isRecord(item) ? item.id : undefined
  );
  assert(!activeArtifactIds.includes(state.artifactId), "artifact.search returned archived artifact by default.");

  const archivedListResult = await client.callTool({
    name: "artifact.list",
    arguments: {
      common: true,
      pathPrefix: "gateway-smoke",
      status: "archived",
      includeArchived: true,
      limit: 5
    }
  });
  assertOk(archivedListResult.structuredContent, "artifact.list archived failed.");
  const archivedListArtifactIds = readNestedArray(archivedListResult.structuredContent, ["data", "artifacts"]).map((item) =>
    isRecord(item) ? item.id : undefined
  );
  assert(archivedListArtifactIds.includes(state.artifactId), "artifact.list did not include archived smoke artifact.");

  const taskResult = await client.callTool({
    name: "task.create",
    arguments: {
      project: state.projectId,
      title: "Verify gateway MCP HTTP",
      scope: "Check direct MCP Streamable HTTP transport through the gateway.",
      acceptance: "Client can create project, memory, task, and run preflight.",
      priority: 1
    }
  });
  assertOk(taskResult.structuredContent, "task.create failed.");
  state.taskId = readNestedString(taskResult.structuredContent, ["data", "task", "id"]);

  const failedAttemptResult = await client.callTool({
    name: "failed_attempt.record",
    arguments: {
      project: state.projectId,
      title: "Gateway MCP HTTP smoke failed attempt",
      whatTried: "A smoke client tried an intentionally bad gateway workflow.",
      whyFailed: "The workflow was only a synthetic validation example.",
      doNotRepeat: "Do not treat synthetic smoke attempts as real project guidance.",
      betterNextApproach: "Use real failure details when recording production failed attempts.",
      relatedId: state.taskId,
      tags: ["smoke", "failed-attempt"]
    }
  });
  assertOk(failedAttemptResult.structuredContent, "failed_attempt.record failed.");
  assert(
    readNestedString(failedAttemptResult.structuredContent, ["data", "attempt", "type"]) === "failed_attempt",
    "failed_attempt.record did not create a failed_attempt item."
  );
  assert(
    readNestedString(failedAttemptResult.structuredContent, ["data", "link", "relation"]) === "warns_against",
    "failed_attempt.record did not create a warns_against link."
  );

  const preflightResult = await client.callTool({
    name: "preflight",
    arguments: {
      taskId: state.taskId
    }
  });
  assertOk(preflightResult.structuredContent, "preflight failed.");

  const handoffResult = await client.callTool({
    name: "handoff.create",
    arguments: {
      project: state.projectId,
      taskId: state.taskId,
      title: "Gateway MCP HTTP smoke handoff",
      workCompleted: ["Verified gateway MCP HTTP smoke workflow."],
      filesTouched: ["scripts/smoke-gateway-mcp-http.ts"],
      validation: ["npm run smoke:gateway:mcp-http"],
      nextSteps: ["Remove smoke data during cleanup."],
      tags: ["smoke", "handoff"]
    }
  });
  assertOk(handoffResult.structuredContent, "handoff.create failed.");
  assert(
    readNestedString(handoffResult.structuredContent, ["data", "handoff", "type"]) === "handoff",
    "handoff.create did not create a handoff memory item."
  );
  assert(
    readNestedString(handoffResult.structuredContent, ["data", "link", "relation"]) === "relates_to",
    "handoff.create did not link the handoff to the task."
  );

  console.log(`ok - gateway MCP HTTP workflow completed for ${state.taskId}`);
  console.log(`Gateway MCP HTTP smoke test passed using ${started.url}/mcp`);
} finally {
  await client.close();
  await secondClient.close();
  if (state.projectId) {
    await db("kv").whereIn("key", [`current_project_id:${clientId}`, `current_project_id:${secondClientId}`]).del();
    await db("projects").where({ id: state.projectId }).del();
  }
  if (state.secondProjectId) {
    await db("projects").where({ id: state.secondProjectId }).del();
  }
  if (state.artifactId) {
    await db("artifacts").where({ id: state.artifactId }).del();
  }
  if (state.artifactPath) {
    await rm(resolve(process.env.ARTIFACT_DIR ?? "artifacts", "common", state.artifactPath), { force: true });
  }
  await db("gateway_clients").where({ id: clientId }).del();
  await db("gateway_clients").where({ id: secondClientId }).del();
  await new Promise<void>((resolveServerClose) => started.server.close(() => resolveServerClose()));
  await service.close();
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertOk(value: unknown, message: string): void {
  if (!isRecord(value) || value.ok !== true) {
    throw new Error(`${message} Response: ${JSON.stringify(value)}`);
  }
}

function readNestedString(value: unknown, path: string[]): string {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) {
      throw new Error(`Expected object while reading ${path.join(".")}.`);
    }
    current = current[key];
  }

  if (typeof current !== "string") {
    throw new Error(`Expected string at ${path.join(".")}.`);
  }

  return current;
}

function readNestedArray(value: unknown, path: string[]): unknown[] {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) {
      throw new Error(`Expected object while reading ${path.join(".")}.`);
    }
    current = current[key];
  }

  if (!Array.isArray(current)) {
    throw new Error(`Expected array at ${path.join(".")}.`);
  }

  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
