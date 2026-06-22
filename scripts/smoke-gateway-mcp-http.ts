import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { startGatewayServer } from "../src/gateway/http-server.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import type { AppLogger } from "../src/shared/logging/logger.js";
import { createPgKnex } from "../src/shared/pg/knex.js";

const db = createPgKnex();
const service = new PgToolService(db);
const token = `gateway-mcp-http-smoke-token-${Date.now()}`;
const logRecords: Array<{ level: string; message: string; fields: Record<string, unknown> }> = [];
const testLogger = {
  info: (fields: unknown, message?: string) => pushLogRecord("info", fields, message),
  warn: (fields: unknown, message?: string) => pushLogRecord("warn", fields, message),
  error: (fields: unknown, message?: string) => pushLogRecord("error", fields, message),
  debug: (fields: unknown, message?: string) => pushLogRecord("debug", fields, message)
} as unknown as AppLogger;
const started = await startGatewayServer(service, {
  host: "127.0.0.1",
  port: 0,
  token,
  logger: testLogger
});
const clientId = `gateway-mcp-http-smoke-${Date.now()}`;
const secondClientId = `gateway-mcp-http-smoke-second-${Date.now()}`;
const claudeClientId = `gateway-mcp-http-smoke-claude-${Date.now()}`;
const endpoint = new URL(`${started.url}/mcp`);
endpoint.searchParams.set("client_id", clientId);
endpoint.searchParams.set("client_label", "Gateway MCP HTTP Smoke");
endpoint.searchParams.set("client_kind", "mcp-http");
const secondEndpoint = new URL(`${started.url}/mcp`);
secondEndpoint.searchParams.set("client_id", secondClientId);
secondEndpoint.searchParams.set("client_label", "Gateway MCP HTTP Smoke Second");
secondEndpoint.searchParams.set("client_kind", "mcp-http");
const claudeEndpoint = new URL(`${started.url}/mcp`);
claudeEndpoint.searchParams.set("client_id", claudeClientId);
claudeEndpoint.searchParams.set("client_label", "Gateway MCP HTTP Smoke Claude");
claudeEndpoint.searchParams.set("client_kind", "claude-code");

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
const claudeTransport = new StreamableHTTPClientTransport(claudeEndpoint, {
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
const claudeClient = new Client({
  name: "project-memory-gateway-mcp-http-smoke-claude",
  version: "0.1.0"
});

const state: {
  projectId?: string;
  secondProjectId?: string;
  taskId?: string;
  failedAttemptId?: string;
  artifactId?: string;
  artifactPath?: string;
  orphanArtifactId?: string;
  orphanArtifactPath?: string;
} = {};

try {
  await client.connect(transport);
  await secondClient.connect(secondTransport);
  await claudeClient.connect(claudeTransport);

  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name);
  assert(tools.tools.every((tool) => isRecord(tool.outputSchema)), "Not every gateway MCP tool listed an outputSchema.");
  const artifactReadTextTool = tools.tools.find((tool) => tool.name === "artifact.read_text");
  assert(isRecord(artifactReadTextTool?.outputSchema), "artifact.read_text did not list an outputSchema.");
  assert(JSON.stringify(artifactReadTextTool.outputSchema).includes("textInfo"), "artifact.read_text outputSchema missed textInfo.");
  const artifactPutTextTool = tools.tools.find((tool) => tool.name === "artifact.put_text");
  assert(isRecord(artifactPutTextTool?.outputSchema), "artifact.put_text did not list an outputSchema.");
  assert(JSON.stringify(artifactPutTextTool.outputSchema).includes("artifact"), "artifact.put_text outputSchema missed artifact.");
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
  assert(toolNames.includes("project.delete"), "project.delete tool was not listed.");
  assert(toolNames.includes("project.resolve"), "project.resolve tool was not listed.");
  assert(toolNames.includes("project.summary"), "project.summary tool was not listed.");
  assert(toolNames.includes("memory.upsert"), "memory.upsert tool was not listed.");
  assert(toolNames.includes("memory.hygiene_report"), "memory.hygiene_report tool was not listed.");
  assert(toolNames.includes("failed_attempt.record"), "failed_attempt.record tool was not listed.");
  assert(toolNames.includes("decision.supersede"), "decision.supersede tool was not listed.");
  assert(toolNames.includes("artifact.put_text"), "artifact.put_text tool was not listed.");
  assert(toolNames.includes("artifact.update_metadata"), "artifact.update_metadata tool was not listed.");
  assert(toolNames.includes("artifact.archive"), "artifact.archive tool was not listed.");
  assert(toolNames.includes("artifact.list"), "artifact.list tool was not listed.");
  assert(toolNames.includes("artifact.peek"), "artifact.peek tool was not listed.");
  assert(toolNames.includes("artifact.read_text"), "artifact.read_text tool was not listed.");
  assert(toolNames.includes("task.delete"), "task.delete tool was not listed.");
  assert(toolNames.includes("memory.search"), "memory.search tool was not listed.");
  assert(toolNames.includes("preflight"), "preflight tool was not listed.");
  assert(toolNames.includes("preflight.by_query"), "preflight.by_query tool was not listed.");
  assert(toolNames.includes("context.pack"), "context.pack tool was not listed.");
  assert(toolNames.includes("context.changed_since"), "context.changed_since tool was not listed.");
  assert(toolNames.includes("handoff.create"), "handoff.create tool was not listed.");
  assert(toolNames.includes("handoff.latest"), "handoff.latest tool was not listed.");
  assert(toolNames.includes("handoff.search"), "handoff.search tool was not listed.");
  console.log(`ok - gateway MCP HTTP listed ${toolNames.length} tools`);

  const claudeTools = await claudeClient.listTools();
  const claudeToolNames = claudeTools.tools.map((tool) => tool.name);
  assert(
    claudeToolNames.every((name) => /^[a-zA-Z0-9_-]{1,64}$/.test(name)),
    "Claude-safe MCP tool names did not match Claude's frontend regex."
  );
  assert(claudeToolNames.includes("gateway_status"), "Claude-safe gateway_status tool was not listed.");
  assert(claudeToolNames.includes("project_create"), "Claude-safe project_create tool was not listed.");
  assert(claudeToolNames.includes("project_delete"), "Claude-safe project_delete tool was not listed.");
  assert(claudeToolNames.includes("task_delete"), "Claude-safe task_delete tool was not listed.");
  assert(!claudeToolNames.includes("gateway.status"), "Claude-safe tool list still included dotted names.");
  const claudeStatusResult = await claudeClient.callTool({
    name: "gateway_status",
    arguments: {}
  });
  assertOk(claudeStatusResult.structuredContent, "gateway_status alias failed.");
  console.log("ok - gateway MCP HTTP listed Claude-safe tool aliases");

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
  const onboardingFlow = readNestedArray(aboutResult.structuredContent, ["data", "about", "onboardingFlow"]);
  assert(
    onboardingFlow.some((step) => String(step).includes("gateway.manuals(audience=\"onboarding\"")),
    "gateway.about did not include the onboarding manuals call."
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
  assert(
    manuals.some(
      (manual) =>
        isRecord(manual) &&
        manual.id === "onboarding" &&
        typeof manual.content === "string" &&
        manual.content.includes("Agent Onboarding")
    ),
    "gateway.manuals did not return onboarding Markdown content."
  );
  assert(
    manuals.some(
      (manual) =>
        isRecord(manual) &&
        manual.id === "conventions" &&
        typeof manual.content === "string" &&
        manual.content.includes("Collaboration Conventions")
    ),
    "gateway.manuals did not return collaboration conventions Markdown content."
  );

  const onboardingManualResult = await client.callTool({
    name: "gateway.manuals",
    arguments: {
      audience: "onboarding",
      includeContent: true
    }
  });
  assertOk(onboardingManualResult.structuredContent, "gateway.manuals onboarding failed.");

  const conventionsManualResult = await client.callTool({
    name: "gateway.manuals",
    arguments: {
      audience: "collaboration",
      includeContent: true
    }
  });
  assertOk(conventionsManualResult.structuredContent, "gateway.manuals collaboration failed.");

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
  const compactClientsResult = await client.callTool({
    name: "gateway.clients",
    arguments: { compact: true, limit: 2 }
  });
  assertOk(compactClientsResult.structuredContent, "compact gateway.clients failed.");
  const compactClient = readNestedArray(compactClientsResult.structuredContent, ["data", "clients"]).find(isRecord);
  assert(compactClient && !("metadata" in compactClient), "compact gateway.clients returned full metadata.");
  console.log("ok - gateway MCP HTTP status and clients");

  const unique = Date.now();
  const changedSinceCursor = new Date(Date.now() - 1000).toISOString();
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

  const projectSummaryResult = await client.callTool({
    name: "project.summary",
    arguments: {
      query: "gateway MCP HTTP smoke project state",
      limits: {
        tasks: 3,
        decisions: 3,
        faults: 3,
        handoffs: 2,
        artifacts: 3,
        memory: 3,
        events: 3
      }
    }
  });
  assertOk(projectSummaryResult.structuredContent, "project.summary failed.");
  assert(
    readNestedString(projectSummaryResult.structuredContent, ["data", "project", "id"]) === state.projectId,
    "project.summary did not use the current project."
  );
  assert(
    readNestedArray(projectSummaryResult.structuredContent, ["data", "nextCalls"]).some(
      (item) => isRecord(item) && item.tool === "context.pack"
    ),
    "project.summary did not return compact nextCalls."
  );

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

  const hygieneResult = await client.callTool({
    name: "memory.hygiene_report",
    arguments: {
      project: state.projectId,
      includeCommon: true,
      largeBodyChars: 500,
      staleDays: 1,
      limit: 5
    }
  });
  assertOk(hygieneResult.structuredContent, "memory.hygiene_report failed.");
  assert(
    typeof readNestedString(hygieneResult.structuredContent, ["data", "summary"]) === "string",
    "memory.hygiene_report did not return a summary."
  );
  assert(
    readNestedArray(hygieneResult.structuredContent, ["data", "findings", "largeRecords"]).every(
      (item) => isRecord(item) && !("body" in item)
    ),
    "memory.hygiene_report returned full memory bodies."
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
  const artifactContent = "# Gateway Smoke AGENTS\n\nUse preflight before editing files.\napi_key=smoke-secret\n";
  const artifactResult = await client.callTool({
    name: "artifact.put_text",
    arguments: {
      common: true,
      path: state.artifactPath,
      title: "Gateway smoke AGENTS template",
      description: "Smoke test artifact for gateway file storage.",
      contentType: "text/markdown; charset=utf-8",
      text: artifactContent,
      tags: ["smoke", "agents-template"],
      overwrite: true
    }
  });
  assertOk(artifactResult.structuredContent, "artifact.put_text failed.");
  state.artifactId = readNestedString(artifactResult.structuredContent, ["data", "artifact", "id"]);
  const artifactPutText = readNestedRecord(artifactResult.structuredContent, ["data", "artifact"]);
  assert(!("contentBase64" in artifactPutText), "artifact.put_text returned base64 content.");
  assertArtifactPutTextWasLogged(artifactContent);

  const artifactConflictResult = await client.callTool({
    name: "artifact.put_text",
    arguments: {
      common: true,
      path: state.artifactPath,
      title: "Gateway smoke duplicate AGENTS template",
      description: "Smoke test duplicate artifact for conflict handling.",
      contentType: "text/markdown; charset=utf-8",
      text: "# Duplicate\n",
      tags: ["smoke", "agents-template"]
    }
  });
  assertFailureCode(artifactConflictResult.structuredContent, "ARTIFACT_CONFLICT", "artifact.put_text conflict did not fail correctly.");
  assert(
    readNestedString(artifactConflictResult.structuredContent, ["error", "details", "existing", "id"]) ===
      state.artifactId,
    "artifact.put_text conflict did not include the existing artifact."
  );
  const suggestedArtifactConflictActions = readNestedArray(artifactConflictResult.structuredContent, [
    "error",
    "details",
    "suggestedActions"
  ]);
  assert(
    suggestedArtifactConflictActions.some((item) => isRecord(item) && item.action === "archive_then_put"),
    "artifact.put_text conflict did not suggest archive_then_put."
  );

  const artifactPutTextBinaryResult = await client.callTool({
    name: "artifact.put_text",
    arguments: {
      common: true,
      path: `gateway-smoke/not-text-${unique}.png`,
      contentType: "image/png",
      text: "not really an image"
    }
  });
  assertFailureCode(
    artifactPutTextBinaryResult.structuredContent,
    "VALIDATION_ERROR",
    "artifact.put_text accepted a non-text contentType."
  );

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

  const contextPackResult = await client.callTool({
    name: "context.pack",
    arguments: {
      query: "Gateway Smoke AGENTS",
      includeCommon: true,
      mode: "brief",
      tokenBudget: 1500
    }
  });
  assertOk(contextPackResult.structuredContent, "context.pack failed.");
  assert(
    readNestedString(contextPackResult.structuredContent, ["data", "budget", "strategy"]) === "compact-cards",
    "context.pack did not report compact-cards strategy."
  );
  assert(JSON.stringify(contextPackResult.structuredContent).includes("contentBase64") === false, "context.pack returned base64 content.");
  const contextPackArtifacts = readNestedArray(contextPackResult.structuredContent, ["data", "artifacts"]).map((item) =>
    isRecord(item) ? item.id : undefined
  );
  assert(contextPackArtifacts.includes(state.artifactId), "context.pack did not include smoke artifact metadata.");
  assert(
    readNestedArray(contextPackResult.structuredContent, ["data", "nextCalls"]).some(
      (item) => isRecord(item) && item.tool === "artifact.read_text"
    ),
    "context.pack did not suggest artifact.read_text next call for a text artifact."
  );
  const chatgptContextPackResult = await client.callTool({
    name: "context.pack",
    arguments: {
      query: "Gateway Smoke AGENTS",
      includeCommon: true,
      mode: "normal",
      profile: "chatgpt"
    }
  });
  assertOk(chatgptContextPackResult.structuredContent, "chatgpt context.pack failed.");
  assert(
    readNestedNumber(chatgptContextPackResult.structuredContent, ["data", "budget", "tokenBudget"]) === 2000,
    "context.pack profile=chatgpt did not use the smaller default token budget."
  );

  const artifactPeekResult = await client.callTool({
    name: "artifact.peek",
    arguments: {
      id: state.artifactId,
      maxBytes: 1024,
      excerptChars: 2000
    }
  });
  assertOk(artifactPeekResult.structuredContent, "artifact.peek failed.");
  const artifactPeek = readNestedRecord(artifactPeekResult.structuredContent, ["data", "artifact"]);
  assert(!("contentBase64" in artifactPeek), "artifact.peek returned base64 content.");
  assert(
    readNestedString(artifactPeekResult.structuredContent, ["data", "artifact", "preview", "excerpt"]).includes(
      "Use preflight before editing files."
    ),
    "artifact.peek did not return a text excerpt."
  );
  assert(
    readNestedArray(artifactPeekResult.structuredContent, ["data", "artifact", "preview", "outline"]).some(
      (item) => isRecord(item) && item.title === "Gateway Smoke AGENTS"
    ),
    "artifact.peek did not return a Markdown outline."
  );

  const artifactReadTextResult = await client.callTool({
    name: "artifact.read_text",
    arguments: {
      id: state.artifactId,
      maxChars: 2000
    }
  });
  assertOk(artifactReadTextResult.structuredContent, "artifact.read_text failed.");
  const artifactReadText = readNestedRecord(artifactReadTextResult.structuredContent, ["data", "artifact"]);
  assert(!("contentBase64" in artifactReadText), "artifact.read_text returned base64 content.");
  assert(
    readNestedString(artifactReadTextResult.structuredContent, ["data", "artifact", "text"]).includes(
      "Use preflight before editing files."
    ),
    "artifact.read_text did not return expected text."
  );
  assert(
    readNestedString(artifactReadTextResult.structuredContent, ["data", "artifact", "text"]).includes("[REDACTED]"),
    "artifact.read_text did not redact secret-like content."
  );
  assert(
    readNestedString(artifactReadTextResult.structuredContent, ["data", "artifact", "text"]).includes("smoke-secret") ===
      false,
    "artifact.read_text leaked secret-like content."
  );
  assert(
    readNestedRecord(artifactReadTextResult.structuredContent, ["data", "artifact", "textInfo"]).base64Included === false,
    "artifact.read_text textInfo did not mark base64 as excluded."
  );

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

  state.orphanArtifactPath = `gateway-smoke/orphan-${unique}.md`;
  const orphanArtifactResult = await client.callTool({
    name: "artifact.put_text",
    arguments: {
      common: true,
      path: state.orphanArtifactPath,
      title: "Gateway smoke orphan artifact",
      description: "Smoke test artifact for missing stored bytes handling.",
      contentType: "text/markdown; charset=utf-8",
      text: "# Orphan\n\nThis file is removed after metadata is written.\n",
      tags: ["smoke", "orphan"],
      overwrite: true
    }
  });
  assertOk(orphanArtifactResult.structuredContent, "orphan artifact.put_text failed.");
  state.orphanArtifactId = readNestedString(orphanArtifactResult.structuredContent, ["data", "artifact", "id"]);
  await rm(resolve(process.env.ARTIFACT_DIR ?? "artifacts", "common", state.orphanArtifactPath), { force: true });
  const orphanReadTextResult = await client.callTool({
    name: "artifact.read_text",
    arguments: {
      id: state.orphanArtifactId
    }
  });
  assertFailureCode(
    orphanReadTextResult.structuredContent,
    "ARTIFACT_BYTES_MISSING",
    "artifact.read_text did not return explicit missing-bytes error for orphan artifact."
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
  const compactArtifactListResult = await client.callTool({
    name: "artifact.list",
    arguments: {
      common: true,
      pathPrefix: "gateway-smoke",
      tags: ["metadata"],
      compact: true,
      limit: 5
    }
  });
  assertOk(compactArtifactListResult.structuredContent, "compact artifact.list failed.");
  const compactArtifact = readNestedArray(compactArtifactListResult.structuredContent, ["data", "artifacts"]).find(
    (item) => isRecord(item) && item.id === state.artifactId
  );
  assert(isRecord(compactArtifact), "compact artifact.list did not include active smoke artifact.");
  assert(compactArtifact && !("sha256" in compactArtifact), "compact artifact.list returned full artifact metadata.");

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

  const deleteTaskCreateResult = await client.callTool({
    name: "task.create",
    arguments: {
      project: state.projectId,
      title: "Delete gateway MCP HTTP smoke task",
      scope: "Temporary task used only to verify task.delete.",
      acceptance: "task.delete removes the task by id.",
      priority: 99
    }
  });
  assertOk(deleteTaskCreateResult.structuredContent, "temporary task.create for task.delete failed.");
  const deleteTaskId = readNestedString(deleteTaskCreateResult.structuredContent, ["data", "task", "id"]);
  const deleteTaskResult = await client.callTool({
    name: "task.delete",
    arguments: {
      id: deleteTaskId,
      reason: "Smoke cleanup for task.delete."
    }
  });
  assertOk(deleteTaskResult.structuredContent, "task.delete failed.");
  assert(
    readNestedString(deleteTaskResult.structuredContent, ["data", "deletedTask", "id"]) === deleteTaskId,
    "task.delete returned the wrong deleted task."
  );

  const failedAttemptResult = await client.callTool({
    name: "failed_attempt.record",
    arguments: {
      project: state.projectId,
      title: "Verify gateway MCP HTTP smoke failed attempt",
      whatTried: "A smoke client tried an intentionally bad gateway workflow.",
      whyFailed: "The workflow was only a synthetic validation example.",
      doNotRepeat: "Do not treat synthetic smoke attempts as real project guidance.",
      betterNextApproach: "Use real failure details when recording production failed attempts.",
      relatedId: state.taskId,
      tags: ["smoke", "failed-attempt"]
    }
  });
  assertOk(failedAttemptResult.structuredContent, "failed_attempt.record failed.");
  state.failedAttemptId = readNestedString(failedAttemptResult.structuredContent, ["data", "attempt", "id"]);
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
  const knownFaultIds = readNestedArray(preflightResult.structuredContent, ["data", "knownFaults"]).map((item) =>
    isRecord(item) ? item.id : undefined
  );
  assert(knownFaultIds.includes(state.failedAttemptId), "preflight did not include the known fault.");

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
  const handoffId = readNestedString(handoffResult.structuredContent, ["data", "handoff", "id"]);

  const latestHandoffResult = await client.callTool({
    name: "handoff.latest",
    arguments: {
      project: state.projectId,
      limit: 1
    }
  });
  assertOk(latestHandoffResult.structuredContent, "handoff.latest failed.");
  assert(
    readNestedArray(latestHandoffResult.structuredContent, ["data", "handoffs"]).some(
      (item) => isRecord(item) && item.id === handoffId && !("body" in item)
    ),
    "handoff.latest did not return compact latest handoff."
  );

  const searchHandoffResult = await client.callTool({
    name: "handoff.search",
    arguments: {
      project: state.projectId,
      query: "gateway MCP HTTP smoke handoff",
      includeContent: true,
      limit: 5
    }
  });
  assertOk(searchHandoffResult.structuredContent, "handoff.search failed.");
  assert(
    readNestedArray(searchHandoffResult.structuredContent, ["data", "handoffs"]).some(
      (item) =>
        isRecord(item) &&
        item.id === handoffId &&
        typeof item.body === "string" &&
        item.body.includes("Verified gateway MCP HTTP smoke workflow.")
    ),
    "handoff.search did not return full handoff content when requested."
  );

  const changedSinceResult = await client.callTool({
    name: "context.changed_since",
    arguments: {
      project: state.projectId,
      since: changedSinceCursor,
      limit: 10
    }
  });
  assertOk(changedSinceResult.structuredContent, "context.changed_since failed.");
  assert(
    typeof readNestedString(changedSinceResult.structuredContent, ["data", "nextCursor"]) === "string",
    "context.changed_since did not return nextCursor."
  );
  assert(
    readNestedArray(changedSinceResult.structuredContent, ["data", "changes", "handoffs"]).some(
      (item) => isRecord(item) && item.id === handoffId && !("body" in item)
    ),
    "context.changed_since did not return compact changed handoff."
  );

  const projectDeleteBlockedResult = await client.callTool({
    name: "project.delete",
    arguments: {
      id: state.projectId
    }
  });
  assertFailureCode(
    projectDeleteBlockedResult.structuredContent,
    "PROJECT_NOT_EMPTY",
    "project.delete without cascade did not fail for a non-empty project."
  );

  if (state.secondProjectId) {
    const secondProjectDeleteResult = await client.callTool({
      name: "project.delete",
      arguments: {
        id: state.secondProjectId,
        cascade: true,
        reason: "Smoke cleanup for secondary project."
      }
    });
    assertOk(secondProjectDeleteResult.structuredContent, "project.delete cascade failed for secondary project.");
    state.secondProjectId = undefined;
  }

  const projectDeleteResult = await client.callTool({
    name: "project.delete",
    arguments: {
      id: state.projectId,
      cascade: true,
      reason: "Smoke cleanup for primary project."
    }
  });
  assertOk(projectDeleteResult.structuredContent, "project.delete cascade failed for primary project.");
  assert(
    readNestedString(projectDeleteResult.structuredContent, ["data", "deletedProject", "id"]) === state.projectId,
    "project.delete returned the wrong deleted project."
  );
  state.projectId = undefined;
  console.log("ok - gateway MCP HTTP pruned smoke projects through tools");

  console.log(`ok - gateway MCP HTTP workflow completed for ${state.taskId}`);
  console.log(`Gateway MCP HTTP smoke test passed using ${started.url}/mcp`);
} finally {
  await client.close();
  await secondClient.close();
  await claudeClient.close();
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
  if (state.orphanArtifactId) {
    await db("artifacts").where({ id: state.orphanArtifactId }).del();
  }
  if (state.artifactPath) {
    await rm(resolve(process.env.ARTIFACT_DIR ?? "artifacts", "common", state.artifactPath), { force: true });
  }
  if (state.orphanArtifactPath) {
    await rm(resolve(process.env.ARTIFACT_DIR ?? "artifacts", "common", state.orphanArtifactPath), { force: true });
  }
  await db("gateway_clients").where({ id: clientId }).del();
  await db("gateway_clients").where({ id: secondClientId }).del();
  await started.stop();
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

function assertFailureCode(value: unknown, code: string, message: string): void {
  if (!isRecord(value) || value.ok !== false || !isRecord(value.error) || value.error.code !== code) {
    throw new Error(`${message} Response: ${JSON.stringify(value)}`);
  }
}

function assertArtifactPutTextWasLogged(expectedText: string): void {
  const record = logRecords.find(
    (item) =>
      item.message === "gateway request completed" &&
      item.fields.mcpMethod === "tools/call" &&
      item.fields.mcpTool === "artifact.put_text"
  );
  assert(record, "artifact.put_text request was not present in gateway completed request logs.");
  const requestBody = readNestedRecord(record.fields, ["requestBody"]);
  const argumentsBody = readNestedRecord(requestBody, ["params", "arguments"]);
  assert(typeof argumentsBody.text === "string", "artifact.put_text log did not include sanitized text argument.");
  assert(argumentsBody.text.includes("Use preflight before editing files."), "artifact.put_text log missed text content.");
  assert(argumentsBody.text.includes("[REDACTED]"), "artifact.put_text log did not redact secret-like text content.");
  assert(!argumentsBody.text.includes("smoke-secret"), "artifact.put_text log leaked secret-like text content.");
  assert(argumentsBody.text !== expectedText, "artifact.put_text log kept unredacted text argument.");
  assert(!JSON.stringify(record.fields).includes("contentBase64"), "artifact.put_text log unexpectedly included contentBase64.");
}

function pushLogRecord(level: string, fields: unknown, message?: string): void {
  logRecords.push({
    level,
    message: typeof message === "string" ? message : "",
    fields: isRecord(fields) ? fields : {}
  });
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

function readNestedNumber(value: unknown, path: string[]): number {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) {
      throw new Error(`Expected object while reading ${path.join(".")}.`);
    }
    current = current[key];
  }

  if (typeof current !== "number") {
    throw new Error(`Expected number at ${path.join(".")}.`);
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

function readNestedRecord(value: unknown, path: string[]): Record<string, unknown> {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) {
      throw new Error(`Expected object while reading ${path.join(".")}.`);
    }
    current = current[key];
  }

  if (!isRecord(current)) {
    throw new Error(`Expected object at ${path.join(".")}.`);
  }

  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
