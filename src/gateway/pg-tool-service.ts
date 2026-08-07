import type { Knex } from "knex";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod/v4";
import { nowIso } from "../shared/dates.js";
import { AppError } from "../shared/errors.js";
import { commonItemPrefix, createProjectId, projectKeyFromId } from "../shared/ids/id.service.js";
import { fail, ok, type ToolResponse } from "../shared/mcp/tool-response.js";
import { defaultGatewayOutputSchema, gatewayToolCanonicalName, gatewayToolSpecs } from "./tool-definitions.js";
import { GATEWAY_EVENT_TOPIC, gatewayEvents } from "./event-bus.js";
import {
  decryptGitToken,
  encryptGitToken,
  fetchGitlabPipelineStatus,
  tokenHint,
  type GitHttpFetch
} from "./git-credentials.js";

type Row = Record<string, unknown>;

type GraphNode = {
  id: string;
  kind: string;
  title: string;
  status: string | null;
  createdAt: string | null;
};

type GraphEdge = {
  from: string;
  to: string;
  relation: string;
};

const taskClaimRoles = ["backend", "frontend", "test", "docs", "review", "devops", "coordination", "other"] as const;
const defaultTaskClaimLeaseSeconds = 60 * 60;

export interface GatewayRequestContext {
  clientId?: string;
  clientLabel?: string;
  metadata?: Row;
  // Threaded from the session cookie (if any) so project-membership
  // filtering (D-MEMORY-007 / T-MEMORY-029) can tell a role=member session
  // apart from an admin session, a static-token/OAuth/anonymous caller, none
  // of which are ever membership-filtered. Absent for every non-session auth
  // source.
  sessionUserId?: string;
  sessionRole?: string;
}

export interface ArtifactDownload {
  artifact: ReturnType<typeof artifactOut>;
  absolutePath: string;
}

interface NormalizedGatewayRequestContext {
  clientId: string;
  clientLabel: string;
  metadata: Row;
  sessionUserId: string | null;
  sessionRole: string | null;
}

const manualSpecs = [
  {
    id: "developer",
    audience: "developer",
    aliases: ["user", "manual"],
    title: "Project Memory MCP Developer Manual",
    description: "Purpose, setup, safe usage, artifact workflows, guardrails, and gateway operations.",
    path: "docs/DEVELOPER_MANUAL.md"
  },
  {
    id: "onboarding",
    audience: "onboarding",
    aliases: ["start", "first-run", "quickstart"],
    title: "Project Memory MCP Agent Onboarding",
    description: "First-run tool chain for agents connecting to a shared pmem gateway.",
    path: "docs/AGENT_ONBOARDING.md"
  },
  {
    id: "agent",
    audience: "agent",
    aliases: ["workflow"],
    title: "Project Memory MCP Agent Guide",
    description: "Operational rules for agents: when to use pmem, tool chains, preflight, artifacts, and clarification triggers.",
    path: "docs/AGENT_GUIDE.md"
  },
  {
    id: "conventions",
    audience: "conventions",
    aliases: ["collaboration"],
    title: "Project Memory MCP Collaboration Conventions",
    description:
      "Shared storage-surface mapping and collaboration rules for ChatGPT, Codex, and other agents using pmem together.",
    path: "docs/PROJECT_MEMORY_COLLABORATION_CONVENTIONS.md"
  }
] as const;

const anonymousClientPrefix = "anonymous:";
const defaultAnonymousClientTtlSeconds = 24 * 60 * 60;
// Stable gateway_clients id for the shared static MCP_TOKEN (T-MEMORY-029).
// Exported so http-server.ts's requestContext() can assign the same id to
// every static-token request instead of a fresh anonymous id per request.
export const staticTokenClientId = "static:mcp-token";

export class PgToolService {
  // T-MEMORY-044: injectable HTTP client for git.pipeline_status's outbound
  // GitLab REST calls -- defaults to the real global `fetch`, but a smoke
  // test can pass a fake here instead of this constructor reaching a real
  // GitLab instance over the network (the task's own acceptance criteria:
  // "the smoke test should NOT make real network calls").
  constructor(
    private readonly db: Knex,
    private readonly gitHttpFetch: GitHttpFetch = fetch
  ) {}

  listTools() {
    return gatewayToolSpecs.map(({ name, description, outputSchema }) => ({
      name,
      description,
      outputSchema: z.toJSONSchema(outputSchema ?? defaultGatewayOutputSchema)
    }));
  }

  async call(
    toolName: string,
    input: unknown,
    context: GatewayRequestContext = {}
  ): Promise<ToolResponse<unknown>> {
    const canonicalToolName = gatewayToolCanonicalName(toolName);
    const spec = gatewayToolSpecs.find((tool) => tool.name === canonicalToolName);
    if (!spec) {
      return fail(new AppError("VALIDATION_ERROR", `Tool ${toolName} is not registered.`));
    }

    try {
      const requestContext = normalizeContext(context);
      const parsed = spec.schema.parse(input ?? {}) as Row;
      await this.touchClient(requestContext, { cleanupAnonymous: canonicalToolName !== "gateway.client_prune" });
      switch (canonicalToolName) {
        case "gateway.about":
          return ok("Project Memory overview loaded.", { about: this.gatewayAbout() });
        case "gateway.version":
          return ok("Gateway version loaded.", { version: await this.gatewayVersion() });
        case "gateway.diagnostics":
          return ok("Gateway diagnostics loaded.", { diagnostics: await this.gatewayDiagnostics() });
        case "gateway.backup_manifest":
          return ok("Gateway backup manifest loaded.", { manifest: await this.gatewayBackupManifest() });
        case "gateway.manuals": {
          const manuals = await this.gatewayManuals(parsed);
          return ok("Project Memory manuals loaded.", {
            manuals,
            efficiencyHints: manualEfficiencyHints(parsed, manuals)
          });
        }
        case "gateway.status":
          return ok("Gateway status loaded.", { status: await this.gatewayStatus() });
        case "gateway.clients":
          return ok("Gateway clients listed.", { clients: await this.listClients(parsed) });
        case "gateway.client_get":
          return ok("Gateway client loaded.", { client: await this.getClient(parsed) });
        case "gateway.client_forget":
          return ok("Gateway client forgotten.", await this.forgetClient(parsed));
        case "gateway.client_prune":
          return ok("Gateway clients pruned.", await this.pruneClients(parsed));
        case "project.create":
          return ok("Project created.", { project: await this.createProject(parsed, requestContext) });
        case "project.list":
          return ok("Projects listed.", { projects: await this.listProjects(parsed, requestContext) });
        case "project.get":
          return ok("Project loaded.", { project: await this.getProject(parsed, requestContext) });
        case "project.delete":
          return ok("Project deleted.", await this.deleteProject(parsed));
        case "project.resolve":
          return ok("Project candidates resolved.", await this.resolveProjectCandidates(parsed, requestContext));
        case "project.summary":
          return ok("Project summary loaded.", await this.projectSummary(parsed, requestContext));
        case "project.set_current":
          return ok("Current project set.", { currentProject: await this.setCurrentProject(parsed, requestContext) });
        case "project.current":
          return ok("Current project loaded.", { project: await this.currentProject(requestContext) });
        case "memory.create":
          return ok("Memory item created.", { item: await this.createMemory(parsed, requestContext) });
        case "memory.upsert": {
          const result = await this.upsertMemory(parsed, requestContext);
          return ok(`Memory item ${result.action}.`, result);
        }
        case "failed_attempt.record":
          return ok("Failed attempt recorded.", await this.recordFailedAttempt(parsed, requestContext));
        case "memory.get":
          return ok("Memory item loaded.", { item: await this.getMemory(String(parsed.id)) });
        case "memory.search":
          return ok("Memory searched.", { results: await this.searchMemory(parsed, requestContext) });
        case "memory.update":
          return ok("Memory item updated.", { item: await this.updateMemory(parsed, requestContext) });
        case "memory.archive":
          return ok("Memory item archived.", await this.archiveMemory(parsed, requestContext));
        case "memory.delete":
          return ok("Memory item deleted.", await this.deleteMemory(parsed, requestContext));
        case "memory.hygiene_report":
          return ok("Memory hygiene report loaded.", await this.memoryHygieneReport(parsed, requestContext));
        case "artifact.put":
          return ok("Artifact stored.", {
            artifact: await this.putArtifact(parsed, requestContext),
            efficiencyHints: artifactWriteEfficiencyHints("artifact.put")
          });
        case "artifact.put_text":
          return ok("Text artifact stored.", {
            artifact: await this.putTextArtifact(parsed, requestContext),
            efficiencyHints: artifactWriteEfficiencyHints("artifact.put_text")
          });
        case "artifact.search":
          return ok("Artifacts searched.", { results: await this.searchArtifacts(parsed, requestContext) });
        case "artifact.list":
          return ok("Artifacts listed.", { artifacts: await this.listArtifacts(parsed, requestContext) });
        case "artifact.get": {
          const artifact = await this.getArtifact(parsed, requestContext);
          return ok("Artifact loaded.", {
            artifact,
            efficiencyHints: artifactGetEfficiencyHints(parsed, artifact)
          });
        }
        case "artifact.peek": {
          const artifact = await this.peekArtifact(parsed, requestContext);
          return ok("Artifact preview loaded.", {
            artifact,
            efficiencyHints: artifactPeekEfficiencyHints(artifact)
          });
        }
        case "artifact.read_text": {
          const artifact = await this.readTextArtifact(parsed, requestContext);
          return ok("Artifact text loaded.", {
            artifact,
            efficiencyHints: artifactReadTextEfficiencyHints(artifact)
          });
        }
        case "artifact.update_metadata":
          return ok("Artifact metadata updated.", { artifact: await this.updateArtifactMetadata(parsed, requestContext) });
        case "artifact.archive":
          return ok("Artifact archived.", await this.archiveArtifact(parsed, requestContext));
        case "artifact.delete":
          return ok("Artifact deleted.", await this.deleteArtifact(parsed, requestContext));
        case "task.create":
          return ok("Task created.", { task: await this.createTask(parsed, requestContext) });
        case "task.list":
          return ok("Tasks listed.", { tasks: await this.listTasks(parsed, requestContext) });
        case "task.get":
          return ok("Task loaded.", { task: await this.getTask(String(parsed.id)) });
        case "task.delete":
          return ok("Task deleted.", await this.deleteTask(parsed, requestContext));
        case "task.claim":
          return ok("Task claimed.", await this.claimTask(parsed, requestContext));
        case "task.claim_heartbeat":
          return ok("Task claim heartbeat recorded.", { claim: await this.heartbeatTaskClaim(parsed, requestContext) });
        case "task.claim_complete":
          return ok("Task claim completed.", await this.completeTaskClaim(parsed, requestContext));
        case "task.release":
          return ok("Task claim released.", await this.releaseTaskClaim(parsed, requestContext));
        case "task.claims":
          return ok("Task claims loaded.", { claims: await this.listTaskClaims(parsed) });
        case "task.complete":
          return ok("Task completed.", await this.completeTask(parsed, requestContext));
        case "task.add_note":
          return ok("Task note added.", await this.addTaskNote(parsed, requestContext));
        case "task.next":
          return ok("Next task loaded.", { task: await this.nextTask(parsed, requestContext) });
        case "task.update_status":
          return ok("Task status updated.", { task: await this.updateTaskStatus(parsed, requestContext) });
        case "decision.record":
          return ok("Decision recorded.", { decision: await this.recordDecision(parsed, requestContext) });
        case "decision.supersede":
          return ok("Decision superseded.", await this.supersedeDecision(parsed, requestContext));
        case "decision.archive":
          return ok("Decision archived.", await this.archiveDecision(parsed, requestContext));
        case "decision.delete":
          return ok("Decision deleted.", await this.deleteDecision(parsed, requestContext));
        case "decision.list":
          return ok("Decisions listed.", { decisions: await this.listDecisions(parsed, requestContext) });
        case "decision.get":
          return ok("Decision loaded.", { decision: await this.getDecision(String(parsed.id)) });
        case "event.record":
          return ok("Event recorded.", { event: await this.recordEvent(parsed, requestContext) });
        case "event.list":
          return ok("Events listed.", { events: await this.listEvents(parsed, requestContext) });
        case "event.delete":
          return ok("Event deleted.", await this.deleteEvent(parsed));
        case "link.create":
          return ok("Link created.", { link: await this.createLink(parsed, requestContext) });
        case "link.list":
          return ok("Links listed.", { links: await this.listLinks(parsed) });
        case "link.delete":
          return ok("Link deleted.", await this.deleteLink(parsed, requestContext));
        case "preflight":
          return ok("Preflight context loaded.", await this.preflight(parsed, requestContext));
        case "preflight.by_query":
          return ok("Preflight query context loaded.", await this.preflightByQuery(parsed, requestContext));
        case "context.pack":
          return ok("Compact context pack loaded.", await this.contextPack(parsed, requestContext));
        case "context.changed_since":
          return ok("Changed context loaded.", await this.contextChangedSince(parsed, requestContext));
        case "handoff.create":
          return ok("Handoff created.", await this.createHandoff(parsed, requestContext));
        case "handoff.latest":
          return ok("Latest handoffs loaded.", { handoffs: await this.latestHandoffs(parsed, requestContext) });
        case "handoff.search":
          return ok("Handoffs searched.", { handoffs: await this.searchHandoffs(parsed, requestContext) });
        case "git.credential_create":
          return ok("Git credential stored.", await this.createGitCredential(parsed, requestContext));
        case "git.credential_list":
          return ok("Git credentials listed.", { credentials: await this.listGitCredentials(requestContext) });
        case "git.credential_delete":
          return ok("Git credential deleted.", await this.deleteGitCredential(parsed, requestContext));
        case "git.pipeline_status":
          return ok("Pipeline status loaded.", await this.gitPipelineStatus(parsed, requestContext));
        default:
          return fail(new AppError("VALIDATION_ERROR", `Tool ${toolName} is not implemented.`));
      }
    } catch (error) {
      return fail(error);
    }
  }

  async graphqlPage(pageName: string, input: unknown, context: GatewayRequestContext = {}): Promise<Row> {
    const requestContext = normalizeContext(context);
    await this.touchClient(requestContext, { cleanupAnonymous: true });
    const parsed = (input ?? {}) as Row;
    switch (pageName) {
      case "projects":
        return this.projectsPage(parsed, requestContext);
      case "gatewayClients":
        return this.gatewayClientsPage(parsed);
      case "memoryItems":
        return this.memoryItemsPage(parsed, requestContext);
      case "memorySearch":
        return this.memorySearchPage(parsed, requestContext);
      case "tasks":
        return this.tasksPage(parsed, requestContext);
      case "decisions":
        return this.decisionsPage(parsed, requestContext);
      case "artifacts":
        return this.artifactsPage(parsed, requestContext);
      case "artifactSearch":
        return this.artifactSearchPage(parsed, requestContext);
      case "events":
        return this.eventsPage(parsed, requestContext);
      case "links":
        return this.linksPage(parsed, requestContext);
      default:
        throw new AppError("VALIDATION_ERROR", `GraphQL page ${pageName} is not registered.`);
    }
  }

  async graphqlRecord(id: string, context: GatewayRequestContext = {}): Promise<Row> {
    const requestContext = normalizeContext(context);
    await this.touchClient(requestContext, { cleanupAnonymous: true });
    return this.recordLookup(String(id));
  }

  async graphqlProjectGraph(input: unknown, context: GatewayRequestContext = {}): Promise<Row> {
    const requestContext = normalizeContext(context);
    await this.touchClient(requestContext, { cleanupAnonymous: true });
    return this.projectGraph((input ?? {}) as Row, requestContext);
  }

  async close(): Promise<void> {
    await this.db.destroy();
  }

  async artifactDownload(id: string): Promise<ArtifactDownload> {
    const row = await this.artifactRowById(id);
    const absolutePath = artifactAbsolutePath(String(row.storage_path));
    ensureArtifactBytesExist(row, absolutePath);
    return {
      artifact: artifactOut(row),
      absolutePath
    };
  }

  private gatewayAbout() {
    return {
      name: "Project Memory",
      shortName: "pmem",
      summary:
        "Project Memory is a shared MCP memory gateway for coding agents. It keeps project knowledge, common reusable rules, tasks, decisions, events, links, and preflight context in one PostgreSQL-backed place so multiple developers and agents can collaborate without losing context.",
      useCases: [
        "Find reusable project and common knowledge before starting work.",
        "Run preflight on a task to collect scope, decisions, related memory, and known failed attempts.",
        "Record decisions, tasks, events, and memory items so future agents do not repeat context gathering.",
        "Inspect which agents or developers are connected to the shared gateway."
      ],
      firstCalls: [
        {
          tool: "gateway.manuals",
          reason:
            "Load manual metadata first. Use includeContent=true only when the caller wants the .md files inline."
        },
        {
          tool: "gateway.manuals",
          input: { audience: "conventions", includeContent: true },
          reason:
            "Load collaboration conventions when ChatGPT, Codex, or other agents share context through pmem."
        },
        {
          tool: "gateway.status",
          reason: "Confirm that the agent is connected to the shared PostgreSQL gateway."
        },
        {
          tool: "gateway.version",
          reason: "Confirm package version, storage mode, and exposed tool count."
        },
        {
          tool: "gateway.clients",
          input: { limit: 10, compact: true },
          reason: "Diagnostic only: see recently connected agents and developers without loading full metadata."
        },
        {
          tool: "project.resolve",
          reason: "Resolve project scope from repository path, slug, title, or remote URL before writing memory."
        },
        {
          tool: "project.current",
          reason: "Confirm the per-client current project used by tools with optional project arguments."
        },
        {
          tool: "preflight.by_query",
          reason: "Load ad-hoc project context, decisions, known faults, artifacts, and recent events before a task exists."
        }
      ],
      onboardingFlow: [
        "gateway.about",
        "gateway.status",
        "gateway.version",
        "gateway.manuals(audience=\"onboarding\", includeContent=true)",
        "project.resolve",
        "project.current or project.set_current",
        "preflight.by_query for ad-hoc work, or task.next -> task.get -> preflight for recorded tasks",
        "artifact.search or artifact.list before creating local AGENTS.md/templates",
        "task.update_status/status events and record decisions/faults/handoffs after meaningful work"
      ],
      operatingModel: {
        commonLayer:
          "Common memory is reusable knowledge shared across projects, such as workflow rules, templates, conventions, and implementation patterns.",
        projectLayer:
          "Project memory belongs to a concrete project and should override common knowledge when there is a conflict.",
        decisions:
          "Decisions are first-class records with rationale, consequences, status, and supersession semantics.",
        events: "Events are append-only timeline records used for audit history and agent handoff context."
      },
      manuals: {
        tool: "gateway.manuals",
        recommendedCalls: [
          {
            audience: "developer",
            includeContent: true,
            reason: "Return the user/developer manual as Markdown."
          },
          {
            audience: "agent",
            includeContent: true,
            reason: "Return the agent operating guide as Markdown."
          },
          {
            audience: "all",
            includeContent: true,
            reason: "Return every bundled Markdown manual."
          }
        ],
        bundledFiles: manualSpecs.map((manual) => ({
          id: manual.id,
          audience: manual.audience,
          title: manual.title,
          path: manual.path,
          contentType: "text/markdown; charset=utf-8"
        }))
      },
      recommendedAgentFlow: [
        "Call gateway.about if the agent has not used pmem before.",
        "Call gateway.manuals(audience=\"onboarding\", includeContent=true) for the first-run tool chain.",
        "Call gateway.manuals with includeContent=true when the developer or agent needs the full bundled Markdown manuals.",
        "Call gateway.status to confirm shared gateway mode.",
        "Call project.resolve, then project.current or project.set_current to identify the active project.",
        "Call context.pack(profile=\"chatgpt\", mode=\"brief\"|\"normal\") or preflight.by_query with the task topic when no task exists yet.",
        "Call task.next or task.get when working from a recorded task.",
        "Call preflight before editing files.",
        "Call artifact.search before artifact.list; use compact=true for navigation and small artifact.peek excerpts before reading full text.",
        "Call artifact.read_text and artifact.put_text for Markdown/text; use base64 artifact.get/artifact.put only for exact bytes or binary files.",
        "After large artifact/manual reads, compact the chat before implementation; clear context when switching projects.",
        "Record decisions, failed attempts, events, and useful memory after meaningful work."
      ],
      tokenDiscipline: {
        rule: "Use PMem as a lazy index first, not as a document dump.",
        workflow: "compact first -> select exact record/artifact -> read full content only by id/path -> compact after heavy reads",
        avoid: [
          "broad artifact.list calls with high limits",
          "large artifact.peek excerpts before selecting a file",
          "artifact.read_text for large Markdown unless full text is required",
          "gateway.clients/gateway.diagnostics during normal coding flow"
        ]
      },
      artifactStorage: {
        status: "available",
        intent:
          "Store reusable files such as AGENTS.md templates on the gateway under project-oriented paths so agents can search and download them.",
        tools: ["artifact.put_text", "artifact.put", "artifact.search", "artifact.peek", "artifact.read_text", "artifact.get"]
      },
      connectionSnippets: connectionSnippets()
    };
  }

  private async gatewayManuals(input: Row) {
    const audience = typeof input.audience === "string" ? input.audience : "all";
    const includeContent = input.includeContent === true;
    const selected = manualSpecs.filter((manual) => {
      if (audience === "all") {
        return true;
      }
      return manual.audience === audience || manual.aliases.some((alias) => alias === audience);
    });

    return Promise.all(
      selected.map(async (manual) => {
        const output: Row = {
          id: manual.id,
          audience: manual.audience,
          aliases: [...manual.aliases],
          title: manual.title,
          description: manual.description,
          path: manual.path,
          contentType: "text/markdown; charset=utf-8",
          retrieval: {
            preferredTool: "gateway.manuals",
            preferredInput: {
              audience: manual.audience,
              includeContent: true
            },
            packagePath: manual.path
          }
        };
        if (includeContent) {
          output.content = await readBundledManual(manual.path);
        }
        return output;
      })
    );
  }

  private async gatewayVersion() {
    const packageMetadata = await readPackageMetadata();
    return {
      name: "Project Memory",
      shortName: "pmem",
      packageName: packageMetadata.name,
      packageVersion: packageMetadata.version,
      mode: "gateway",
      storage: "postgresql",
      tools: this.listTools().length,
      node: {
        version: process.version
      },
      runtime: {
        processName: process.env.PM2_NAME ?? "pm3m-gateway"
      }
    };
  }

  private async gatewayDiagnostics() {
    const [version, readiness, status, migrations] = await Promise.all([
      this.gatewayVersion(),
      this.readiness(),
      this.gatewayStatus(),
      this.migrationStatus()
    ]);

    return {
      version,
      readiness,
      status,
      migrations,
      runtime: {
        bind: process.env.BIND ?? "127.0.0.1",
        port: Number(process.env.PORT ?? 8765),
        apiEndpoint: process.env.API_ENDPOINT ?? null,
        nodeEnv: process.env.NODE_ENV ?? null
      },
      artifacts: {
        dir: process.env.ARTIFACT_DIR ?? "artifacts",
        maxBytes: Number(process.env.ARTIFACT_MAX_BYTES ?? 10 * 1024 * 1024)
      },
      logging: {
        level: process.env.LOG_LEVEL ?? "info",
        dir: process.env.LOG_DIR ?? ".agent",
        pretty: process.env.LOG_PRETTY ?? "false",
        includeTime: process.env.LOG_INCLUDE_TIME ?? "true"
      },
      clients: {
        anonymousTtlSeconds: anonymousClientTtlSeconds()
      },
      security: {
        bearerAuth: Boolean(process.env.MCP_TOKEN)
      }
    };
  }

  private async gatewayBackupManifest() {
    const [version, migrations, artifacts] = await Promise.all([
      this.gatewayVersion(),
      this.migrationStatus(),
      this.artifactBackupStats()
    ]);

    const tables = [
      "projects",
      "items",
      "tasks",
      "task_claims",
      "decisions",
      "links",
      "events",
      "artifacts",
      "kv",
      "gateway_clients",
      "sync_conflicts",
      "knex_migrations",
      "knex_migrations_lock"
    ];
    const tableCounts = Object.fromEntries(
      await Promise.all(tables.map(async (table) => [table, await this.safeCountRows(table)] as const))
    );
    const artifactDir = path.resolve(process.env.ARTIFACT_DIR ?? "artifacts");

    return {
      generatedAt: nowIso(),
      version,
      database: {
        engine: "postgresql",
        host: process.env.POSTGRES_HOST ?? "127.0.0.1",
        port: Number(process.env.POSTGRES_PORT ?? 5432),
        database: process.env.POSTGRES_DB ?? "project_memory",
        user: process.env.POSTGRES_USER ?? "project_memory",
        ssl: process.env.POSTGRES_SSL === "true" || process.env.POSTGRES_SSL === "require",
        backupRequired: true,
        tables,
        tableCounts
      },
      artifacts: {
        backupRequired: true,
        dir: artifactDir,
        exists: existsSync(artifactDir),
        count: artifacts.count,
        totalBytes: artifacts.totalBytes,
        maxBytes: Number(process.env.ARTIFACT_MAX_BYTES ?? 10 * 1024 * 1024)
      },
      migrations,
      excludes: [
        "MCP_TOKEN",
        "POSTGRES_PASSWORD",
        "Authorization headers",
        "PM2 runtime logs unless required by operator policy"
      ],
      notes: [
        "Back up PostgreSQL and ARTIFACT_DIR together to keep artifact metadata and bytes consistent.",
        "This tool reports backup scope only; it does not perform a backup."
      ]
    };
  }

  private async migrationStatus() {
    const [completed, pending] = await this.db.migrate.list({
      directory: path.resolve(packageRoot(), "migrations", "pg"),
      tableName: "knex_migrations"
    });

    return {
      completed: completed.map((migration: unknown) => migrationField(migration, "name")),
      pending: pending.map((migration: unknown) => migrationField(migration, "file"))
    };
  }

  async readiness() {
    const requiredTables = [
      "projects",
      "items",
      "tasks",
      "decisions",
      "links",
      "events",
      "artifacts",
      "kv",
      "gateway_clients",
      "sync_conflicts"
    ];
    await this.db.raw("select 1");
    const rows = await this.db("information_schema.tables")
      .select("table_name")
      .where({ table_schema: "public" })
      .whereIn("table_name", requiredTables);
    const present = new Set(rows.map((row) => String(row.table_name)));
    const missingTables = requiredTables.filter((table) => !present.has(table));

    return {
      ok: missingTables.length === 0,
      database: "postgresql",
      missingTables
    };
  }

  private async gatewayStatus() {
    const [projects, items, tasks, decisions, events, artifacts, clients] = await Promise.all([
      this.countRows("projects"),
      this.countRows("items"),
      this.countRows("tasks"),
      this.countRows("decisions"),
      this.countRows("events"),
      this.countRows("artifacts"),
      this.countRows("gateway_clients")
    ]);

    return {
      mode: "gateway",
      storage: "postgresql",
      tools: this.listTools().length,
      records: {
        projects,
        items,
        tasks,
        decisions,
        events,
        artifacts
      },
      clients
    };
  }

  private async listClients(input: Row) {
    let query = this.db("gateway_clients").select("*").orderBy("updated_at", "desc");
    if (typeof input.anonymous === "boolean") {
      query = input.anonymous
        ? query.where("id", "like", `${anonymousClientPrefix}%`)
        : query.where("id", "not like", `${anonymousClientPrefix}%`);
    }
    if (typeof input.staleOlderThanSeconds === "number") {
      query = query.andWhere("last_seen_at", "<", cutoffFromSeconds(input.staleOlderThanSeconds));
    }
    const rows = await query.limit(Number(input.limit ?? 10));
    return input.compact === true ? rows.map(compactClient) : rows.map(clientOut);
  }

  private async gatewayClientsPage(input: Row) {
    const base = this.db("gateway_clients");
    if (typeof input.anonymous === "boolean") {
      if (input.anonymous) {
        base.where("id", "like", `${anonymousClientPrefix}%`);
      } else {
        base.where("id", "not like", `${anonymousClientPrefix}%`);
      }
    }
    if (typeof input.staleOlderThanSeconds === "number") {
      base.andWhere("last_seen_at", "<", cutoffFromSeconds(input.staleOlderThanSeconds));
    }
    return this.pageRows(base, input, (query) => query.select("*").orderBy("updated_at", "desc"), clientOut);
  }

  private async getClient(input: Row) {
    const row = await this.clientRow(String(input.id));
    return {
      ...clientOut(row),
      currentProjectId: await this.getKv(currentProjectKey(String(row.id)))
    };
  }

  private async forgetClient(input: Row) {
    const id = String(input.id);
    const row = await this.clientRow(id);
    await this.db.transaction(async (trx) => {
      await trx("kv").where({ key: currentProjectKey(id) }).del();
      await trx("gateway_clients").where({ id }).del();
    });
    return {
      client: clientOut(row),
      forgotten: true,
      removedCurrentProjectKey: true
    };
  }

  private async pruneClients(input: Row) {
    const anonymousOnly = input.anonymousOnly !== false;
    const olderThanSeconds =
      typeof input.olderThanSeconds === "number" ? Number(input.olderThanSeconds) : anonymousClientTtlSeconds();
    const dryRun = input.dryRun !== false;
    const limit = Number(input.limit ?? 100);
    let query = this.db("gateway_clients")
      .select("*")
      .where("last_seen_at", "<", cutoffFromSeconds(olderThanSeconds))
      .orderBy("last_seen_at");
    if (anonymousOnly) {
      query = query.andWhere("id", "like", `${anonymousClientPrefix}%`);
    }
    const rows = await query.limit(limit);
    const clientIds = rows.map((row) => String(row.id));
    if (!dryRun && clientIds.length > 0) {
      await this.db.transaction(async (trx) => {
        await trx("kv").whereIn("key", clientIds.map(currentProjectKey)).del();
        await trx("gateway_clients").whereIn("id", clientIds).del();
      });
    }
    return {
      dryRun,
      anonymousOnly,
      olderThanSeconds,
      matched: rows.length,
      pruned: dryRun ? 0 : rows.length,
      clients: rows.map(clientOut)
    };
  }

  private async clientRow(id: string): Promise<Row> {
    const row = await this.db("gateway_clients").where({ id }).first();
    if (!row) {
      throw new AppError("NOT_FOUND", `Gateway client ${id} does not exist.`, { id });
    }
    return row;
  }

  // T-MEMORY-044: git host credentials + the pipeline-status proxy. All
  // four resolve owner identity from context.sessionUserId ONLY -- a
  // browser session, same "session-based only" answer T-MEMORY-042 gave for
  // WS subscriptions. Static token, OAuth, and anonymous callers never
  // populate sessionUserId (normalizeContext() below), so every one of
  // these throws requireSession()'s clear UNAUTHORIZED error for them
  // rather than silently operating on nobody's (or the wrong person's)
  // credentials. Resolving ownership for an OAuth-connected agent is the
  // task record's own flagged-open question (which human does a given
  // OAuth session act on behalf of) -- explicitly out of scope for this
  // pass, documented here and in docs/AUTH.md rather than half-solved.
  private requireSessionUserId(context: NormalizedGatewayRequestContext): string {
    if (!context.sessionUserId) {
      throw new AppError(
        "UNAUTHORIZED",
        "Git credentials require a logged-in session (no static token, OAuth connector, or anonymous caller can use them)."
      );
    }
    return context.sessionUserId;
  }

  private async createGitCredential(input: Row, context: NormalizedGatewayRequestContext) {
    const ownerUserId = this.requireSessionUserId(context);
    const now = nowIso();
    const row = {
      id: randomUUID(),
      owner_user_id: ownerUserId,
      host: String(input.host),
      label: String(input.label),
      token_enc: encryptGitToken(String(input.token)),
      created_at: now,
      updated_at: now,
      last_used_at: null
    };
    await this.db("git_credentials").insert(row);
    await this.recordEventForProject(null, {
      type: "git_credential.created",
      title: `Git credential added: ${row.host} (${row.label})`,
      related_id: row.id
    }, context);
    return gitCredentialOut(row);
  }

  private async listGitCredentials(context: NormalizedGatewayRequestContext) {
    const ownerUserId = this.requireSessionUserId(context);
    const rows = await this.db("git_credentials")
      .where({ owner_user_id: ownerUserId })
      .orderBy("created_at", "desc");
    return rows.map((row) => gitCredentialOut(row, { includeHint: true }));
  }

  private async deleteGitCredential(input: Row, context: NormalizedGatewayRequestContext) {
    const ownerUserId = this.requireSessionUserId(context);
    const id = String(input.id);
    // Ownership is enforced in the WHERE clause, not checked-then-deleted --
    // a credential belonging to a different user is indistinguishable from
    // one that doesn't exist at all, same not-found-not-forbidden
    // convention used elsewhere in this codebase (assertProjectMember, the
    // /auth/login single "Invalid email or password" message).
    const deletedCount = await this.db("git_credentials")
      .where({ id, owner_user_id: ownerUserId })
      .del();
    if (deletedCount === 0) {
      throw new AppError("GIT_CREDENTIAL_NOT_FOUND", `Git credential ${id} does not exist.`, { id });
    }
    await this.recordEventForProject(null, {
      type: "git_credential.deleted",
      title: `Git credential deleted: ${id}`,
      related_id: id
    }, context);
    return { deleted: true as const };
  }

  private async gitPipelineStatus(input: Row, context: NormalizedGatewayRequestContext) {
    const ownerUserId = this.requireSessionUserId(context);
    const host = String(input.host);
    const project = String(input.project);
    const ref = typeof input.ref === "string" && input.ref.length > 0 ? input.ref : undefined;

    // Most recently created credential wins when more than one row exists
    // for this (owner, host) pair (e.g. mid-rotation) -- see the schema
    // comment in migrations/pg/012_git_credentials.cjs.
    const credentialRow = await this.db("git_credentials")
      .where({ owner_user_id: ownerUserId, host })
      .orderBy("created_at", "desc")
      .first();
    if (!credentialRow) {
      throw new AppError(
        "GIT_CREDENTIAL_REQUIRED",
        `No credential stored for host ${host}, add one in your profile first.`,
        { host }
      );
    }

    const token = decryptGitToken(String(credentialRow.token_enc));
    const result = await fetchGitlabPipelineStatus({
      host,
      project,
      ref,
      token,
      httpFetch: this.gitHttpFetch
    });
    await this.db("git_credentials").where({ id: credentialRow.id }).update({ last_used_at: nowIso() });
    return {
      status: result.status,
      ref: result.ref,
      sha: result.sha,
      webUrl: result.webUrl,
      jobs: result.jobs
    };
  }

  private async createProject(input: Row, context: NormalizedGatewayRequestContext) {
    const now = nowIso();
    const baseId = createProjectId(String(input.slug));
    const id = await this.uniqueProjectId(baseId);
    const row = {
      id,
      slug: String(input.slug),
      title: String(input.title),
      description: stringOrNull(input.description),
      status: "active",
      root_path: stringOrNull(input.rootPath),
      ...writeActorFields(context),
      created_at: now,
      updated_at: now
    };

    await this.db("projects").insert(row);
    await this.recordEventForProject(id, {
      type: "project.created",
      title: `Project created: ${row.title}`,
      related_id: id
    }, context);
    return projectOut(row);
  }

  private async listProjects(input: Row, context?: NormalizedGatewayRequestContext) {
    let query = this.db("projects").select("*").orderBy("slug");
    if (input.status) {
      query = query.where("status", String(input.status));
    }
    query = this.applyProjectMembershipFilter(query, context);
    return (await query).map(input.compact === true ? compactProject : projectOut);
  }

  private async projectsPage(input: Row, context?: NormalizedGatewayRequestContext) {
    const base = this.db("projects");
    if (input.status) {
      base.where("status", String(input.status));
    }
    this.applyProjectMembershipFilter(base, context);
    return this.pageRows(base, input, (query) => query.select("*").orderBy("slug"), projectOut);
  }

  private async getProject(input: Row, context?: NormalizedGatewayRequestContext) {
    const row = input.id
      ? await this.db("projects").where({ id: String(input.id) }).first()
      : await this.db("projects").where({ slug: String(input.slug) }).first();
    if (!row) {
      throw new AppError("PROJECT_NOT_FOUND", "Project does not exist.", { ...input });
    }
    await this.assertProjectMember(String(row.id), context);
    return projectOut(row);
  }

  // Centralized project-membership gate (D-MEMORY-007 decision 3): only a
  // role=member session is ever filtered. Admin sessions and every
  // non-session auth source (static token, OAuth, anonymous/none) bypass
  // this entirely and see every project, unchanged from pre-T-MEMORY-029
  // behavior. A member without a project_members row gets the same
  // PROJECT_NOT_FOUND a nonexistent project would produce -- existence is
  // never leaked, matching this codebase's other don't-distinguish-why
  // conventions (see auth.ts login()).
  private async assertProjectMember(projectId: string, context?: NormalizedGatewayRequestContext): Promise<void> {
    if (!context || context.sessionRole !== "member" || !context.sessionUserId) {
      return;
    }
    if (!(await this.isMemberOfProject(projectId, context.sessionUserId))) {
      throw new AppError("PROJECT_NOT_FOUND", "Project does not exist.");
    }
  }

  // Shared single-row membership query, used by both assertProjectMember
  // above (REST/MCP/GraphQL request path) and isProjectVisibleToSession below
  // (WS subscription event filtering, T-MEMORY-042) -- one query, two
  // call sites, instead of duplicating the project_members lookup.
  private async isMemberOfProject(projectId: string, userId: string): Promise<boolean> {
    const membership = await this.db("project_members").where({ project_id: projectId, user_id: userId }).first();
    return Boolean(membership);
  }

  // Query-builder counterpart of assertProjectMember for list/search
  // endpoints that scan many projects (project.list, project.resolve)
  // instead of resolving one specific id/slug.
  private applyProjectMembershipFilter<T extends Knex.QueryBuilder>(
    query: T,
    context?: NormalizedGatewayRequestContext
  ): T {
    if (context?.sessionRole === "member" && context.sessionUserId) {
      query.whereIn("id", this.db("project_members").select("project_id").where({ user_id: context.sessionUserId }));
    }
    return query;
  }

  // T-MEMORY-042: mirrors assertProjectMember's exact bypass rules, but as a
  // boolean predicate rather than a throw -- used by the WS subscription
  // resolver (graphql.ts's filteredGatewayEvents) to decide whether a given
  // published event envelope is visible to one open connection's session
  // identity. role=admin always passes; a common-scope event
  // (projectId === null) always passes for anyone; role=member is checked
  // against project_members exactly like assertProjectMember. Subscriptions
  // are session-only (see http-server.ts's WS upgrade handling), so the
  // caller is always a real session identity, never a static-token/OAuth/
  // anonymous context.
  async isProjectVisibleToSession(
    projectId: string | null,
    session: { role: string; userId: string }
  ): Promise<boolean> {
    if (session.role !== "member" || projectId === null) {
      return true;
    }
    return this.isMemberOfProject(projectId, session.userId);
  }

  private async deleteProject(input: Row) {
    const project = await this.getProject(input);
    const counts = await this.projectDeleteCounts(project.id);
    const dependentRows = counts.tasks + counts.items + counts.decisions + counts.links + counts.events + counts.artifacts;
    const cascade = input.cascade === true;
    if (dependentRows > 0 && !cascade) {
      throw new AppError("PROJECT_NOT_EMPTY", "Project has dependent records. Re-run with cascade=true to delete it.", {
        project,
        counts
      });
    }

    const artifactRows = await this.db("artifacts").select("storage_path").where({ project_id: project.id });
    let currentProjectKeys = 0;
    await this.db.transaction(async (trx) => {
      const deletedKeys = await trx("kv")
        .where({ value: project.id })
        .where((builder) => {
          builder.where({ key: "current_project_id" }).orWhere("key", "like", "current_project_id:%");
        })
        .del();
      currentProjectKeys = Number(deletedKeys);
      await trx("projects").where({ id: project.id }).del();
    });

    for (const artifact of artifactRows) {
      await rm(artifactAbsolutePath(String(artifact.storage_path)), { force: true });
    }

    return {
      deletedProject: project,
      cascade,
      counts: {
        ...counts,
        currentProjectKeys
      }
    };
  }

  private async resolveProjectCandidates(input: Row, context?: NormalizedGatewayRequestContext) {
    const rows = await this.applyProjectMembershipFilter(
      this.db("projects").select("*").where({ status: "active" }),
      context
    );
    const candidates = rows
      .map((row) => scoreProjectCandidate(row, input))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.project.slug.localeCompare(right.project.slug))
      .slice(0, Number(input.limit ?? 10));
    const top = candidates[0];
    const second = candidates[1];
    const resolved = top && (!second || top.score > second.score) ? top.project : null;

    return {
      resolved,
      ambiguous: Boolean(top && second && top.score === second.score),
      candidates
    };
  }

  private async projectSummary(input: Row, context: NormalizedGatewayRequestContext) {
    const project = await this.resolveProject(input.project, context);
    const includeCommon = input.includeCommon !== false;
    const limits = projectSummaryLimits((input.limits ?? {}) as Row);
    // Only apply an FTS filter to the memory/artifacts/knownFaults sections
    // when the caller explicitly asked for one. Synthesizing a query from
    // the project's own title/slug/description and running it through a
    // mandatory tsquery match (searchMemory had no query-less mode; project
    // title/description rarely lexically overlaps with stored records) made
    // these sections come back empty even when counts showed real content —
    // see I-MEMORY-022 step 1. The synthesized string is still useful as a
    // topic hint for the query field and nextCalls' context.pack suggestion.
    const explicitQuery = typeof input.query === "string" && input.query.trim() ? input.query : undefined;
    const query = explicitQuery ?? [project.title, project.slug, project.description].filter(Boolean).join(" ");

    const [openTasks, decisions, knownFaults, handoffs, artifacts, memory, recentEvents, counts] = await Promise.all([
      this.listOpenProjectTasks(project.id, limits.tasks),
      this.listDecisions({
        project: project.id,
        includeCommon,
        status: "active",
        limit: limits.decisions
      }),
      this.searchMemory({
        query: explicitQuery,
        project: project.id,
        includeCommon,
        type: "failed_attempt",
        status: "active",
        limit: limits.faults
      }),
      this.listRecentItemsByType("handoff", project.id, includeCommon, limits.handoffs),
      this.searchArtifacts({
        query: explicitQuery,
        project: project.id,
        includeCommon,
        limit: limits.artifacts
      }),
      this.searchMemory({
        query: explicitQuery,
        project: project.id,
        includeCommon,
        status: "active",
        limit: limits.memory
      }),
      this.listEvents({
        project: project.id,
        limit: limits.events
      }),
      this.projectSummaryCounts(project.id)
    ]);

    const summary = {
      summary:
        "Compact project state. Use nextCalls to fetch full records or artifact previews only when a compact card is insufficient.",
      budget: {
        strategy: "compact-project-card",
        fullBodiesIncluded: false,
        base64Included: false,
        limits
      },
      project: compactProject(project),
      query,
      includeCommon,
      counts,
      openTasks: openTasks.map(compactTask),
      handoffs: handoffs.map(compactMemoryRecord),
      decisions: decisions.map(compactDecisionRecord),
      knownFaults: knownFaults.map(compactSearchRecord),
      artifacts: artifacts.map(compactArtifactRecord),
      memory: memory.map(compactSearchRecord),
      recentEvents: recentEvents.map(compactEventRecord),
      nextCalls: projectSummaryNextCalls({ project, query, openTasks, knownFaults, artifacts, decisions })
    };

    return {
      ...summary,
      budget: {
        ...summary.budget,
        estimatedChars: JSON.stringify(summary).length
      },
      efficiencyHints: compactContextEfficiencyHints("project.summary", JSON.stringify(summary).length)
    };
  }

  private async listOpenProjectTasks(projectId: string, limit: number): Promise<Row[]> {
    const rows = await this.taskSelectWithActiveClaimCount(this.db("tasks"))
      .where("project_id", projectId)
      .whereIn("status", ["doing", "todo", "blocked"])
      .orderByRaw("case status when 'doing' then 0 when 'todo' then 1 when 'blocked' then 2 else 3 end")
      .orderBy("priority")
      .orderBy("created_at")
      .limit(limit);
    return rows.map(taskOut);
  }

  private async projectSummaryCounts(projectId: string) {
    const [tasks, openTasks, items, decisions, artifacts, events] = await Promise.all([
      this.countQueryRows(this.db("tasks").where("project_id", projectId)),
      this.countQueryRows(this.db("tasks").where("project_id", projectId).whereIn("status", ["doing", "todo", "blocked"])),
      this.countQueryRows(this.db("items").where("project_id", projectId)),
      this.countQueryRows(this.db("decisions").where("project_id", projectId)),
      this.countQueryRows(this.db("artifacts").where("project_id", projectId)),
      this.countQueryRows(this.db("events").where("project_id", projectId))
    ]);
    return {
      tasks,
      openTasks,
      items,
      decisions,
      artifacts,
      events
    };
  }

  private async projectDeleteCounts(projectId: string) {
    const [tasks, taskClaims, items, decisions, links, events, artifacts] = await Promise.all([
      this.countQueryRows(this.db("tasks").where("project_id", projectId)),
      this.countQueryRows(this.db("task_claims").where("project_id", projectId)),
      this.countQueryRows(this.db("items").where("project_id", projectId)),
      this.countQueryRows(this.db("decisions").where("project_id", projectId)),
      this.countQueryRows(this.db("links").where("project_id", projectId)),
      this.countQueryRows(this.db("events").where("project_id", projectId)),
      this.countQueryRows(this.db("artifacts").where("project_id", projectId))
    ]);
    return {
      tasks,
      taskClaims,
      items,
      decisions,
      links,
      events,
      artifacts
    };
  }

  private async countQueryRows(query: Knex.QueryBuilder): Promise<number> {
    const row = (await query.count({ count: "*" }).first()) as Row | undefined;
    return Number(row?.count ?? 0);
  }

  private async pageRows<T>(
    baseQuery: Knex.QueryBuilder,
    input: Row,
    applyListShape: (query: Knex.QueryBuilder) => Knex.QueryBuilder,
    mapRow: (row: Row) => T
  ) {
    const page = paginationInput(input.pagination);
    const totalCount = await this.countQueryRows(baseQuery.clone());
    const rows = (await applyListShape(baseQuery.clone()).limit(page.limit).offset(page.offset)) as Row[];
    return {
      items: rows.map(mapRow),
      pageInfo: {
        limit: page.limit,
        offset: page.offset,
        totalCount,
        hasNextPage: page.offset + rows.length < totalCount,
        hasPreviousPage: page.offset > 0
      }
    };
  }

  private taskSelectWithActiveClaimCount(query: Knex.QueryBuilder): Knex.QueryBuilder {
    return query.select("tasks.*").select(
      this.db.raw(
        "(select count(*)::int from task_claims where task_claims.task_id = tasks.id and task_claims.status = 'active' and task_claims.lease_expires_at > now()) as active_claim_count"
      )
    );
  }

  private async recordLookup(id: string): Promise<Row> {
    for (const table of recordLookupTables(id)) {
      const row = await this.db(table).where({ id }).first();
      if (!row) {
        continue;
      }
      return recordLookupOut(table, row);
    }
    throw new AppError("NOT_FOUND", `Record ${id} does not exist.`, { id });
  }

  private async deleteLinksForRecord(id: string, db: Knex | Knex.Transaction = this.db): Promise<number> {
    return Number(
      await db("links")
        .where((builder) => builder.where("from_id", id).orWhere("to_id", id))
        .del()
    );
  }

  private async setCurrentProject(input: Row, context: NormalizedGatewayRequestContext) {
    const project = await this.getProject(input, context);
    await this.setKv(currentProjectKey(context.clientId), project.id);
    return project;
  }

  private async currentProject(context?: NormalizedGatewayRequestContext) {
    const currentProjectId = context
      ? (await this.getKv(currentProjectKey(context.clientId))) ?? (await this.getKv("current_project_id"))
      : await this.getKv("current_project_id");
    if (!currentProjectId) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "Current project is not configured.");
    }
    return this.getProject({ id: currentProjectId }, context);
  }

  private async resolveProject(project?: unknown, context?: NormalizedGatewayRequestContext) {
    if (typeof project === "string" && project.length > 0) {
      return project.startsWith("P-")
        ? this.getProject({ id: project }, context)
        : this.getProject({ slug: project }, context);
    }
    return this.currentProject(context);
  }

  private async createMemory(input: Row, context: NormalizedGatewayRequestContext) {
    const common = input.common === true || input.project === null;
    const project = common ? null : await this.resolveProject(input.project, context);
    const prefix = project ? `I-${projectKeyFromId(project.id)}` : commonItemPrefix(String(input.type));
    const now = nowIso();
    const row = {
      id: typeof input.id === "string" ? input.id : await this.nextId("items", prefix),
      project_id: project?.id ?? null,
      type: String(input.type),
      title: String(input.title),
      body: String(input.body),
      status: typeof input.status === "string" ? input.status : "active",
      tags: jsonStringArray(input.tags),
      summary: stringOrNull(input.summary),
      ...writeActorFields(context),
      created_at: now,
      updated_at: now
    };

    await this.db("items").insert(row);
    await this.recordEventForProject(row.project_id, {
      type: "item.created",
      title: `Memory item created: ${row.title}`,
      related_id: row.id
    }, context);
    const linkage = await this.applyRecordLinkage(row.id, row.project_id, input.tags, input.links, context);
    return { ...itemOut(row), ...linkage };
  }

  private async upsertMemory(input: Row, context: NormalizedGatewayRequestContext) {
    const existing = await this.findExistingMemoryForUpsert(input, context);
    if (!existing) {
      return {
        action: "created",
        item: await this.createMemory(input, context)
      };
    }

    const patch = {
      title: String(input.title),
      body: String(input.body),
      status: typeof input.status === "string" ? input.status : existing.status,
      tags: Array.isArray(input.tags) ? jsonStringArray(input.tags) : existing.tags,
      updated_by: context.clientId,
      source_instance_id: context.clientId,
      updated_at: nowIso(),
      version: Number(existing.version ?? 1) + 1
    };
    const [row] = await this.db("items").where({ id: String(existing.id) }).update(patch).returning("*");
    await this.recordEventForProject(row.project_id, {
      type: "item.updated",
      title: `Memory item upserted: ${row.title}`,
      related_id: row.id
    }, context);
    return {
      action: "updated",
      item: itemOut(row)
    };
  }

  private async findExistingMemoryForUpsert(
    input: Row,
    context: NormalizedGatewayRequestContext
  ): Promise<Row | undefined> {
    const match = typeof input.match === "string" ? input.match : undefined;
    if ((match === "id" || !match) && typeof input.id === "string") {
      const byId = await this.db("items").where({ id: input.id }).first();
      if (byId || match === "id") {
        return byId;
      }
    }

    const common = input.common === true || input.project === null;
    const project = common ? null : await this.resolveProject(input.project, context);
    return this.db("items")
      .where({ type: String(input.type), title: String(input.title) })
      .andWhere((builder) => {
        if (project) {
          builder.where("project_id", project.id);
        } else {
          builder.whereNull("project_id");
        }
      })
      .first();
  }

  private async recordFailedAttempt(input: Row, context: NormalizedGatewayRequestContext) {
    const tags = Array.from(new Set(["failed_attempt", ...stringArray(input.tags)]));
    const upsert = await this.upsertMemory(
      {
        id: input.id,
        project: input.project,
        common: input.common,
        type: "failed_attempt",
        title: input.title,
        body: failedAttemptBody(input),
        status: "active",
        tags,
        match: input.match ?? "scope_type_title"
      },
      context
    );
    const item = upsert.item as ReturnType<typeof itemOut>;
    const event = await this.recordEventForProject(item.projectId, {
      type: "attempt.failed",
      title: `Failed attempt recorded: ${item.title}`,
      body: item.body,
      related_id: item.id
    }, context);
    const link = input.relatedId
      ? await this.createWarnsAgainstLink(item.id, String(input.relatedId), item.projectId, context)
      : null;

    return {
      action: upsert.action,
      attempt: item,
      event,
      link
    };
  }

  private async createWarnsAgainstLink(
    fromId: string,
    toId: string,
    projectId: string | null,
    context: NormalizedGatewayRequestContext
  ) {
    await this.assertRecordExists(toId);
    const existing = await this.db("links")
      .where({ from_id: fromId, to_id: toId, relation: "warns_against" })
      .first();
    if (existing) {
      return linkOut(existing);
    }

    const row = {
      id: await this.nextId("links", projectId ? `L-${projectKeyFromId(projectId)}` : "L-COMMON"),
      project_id: projectId,
      from_id: fromId,
      to_id: toId,
      relation: "warns_against",
      created_by: context.clientId,
      source_instance_id: context.clientId,
      created_at: nowIso()
    };
    await this.db("links").insert(row);
    await this.recordEventForProject(projectId, {
      type: "link.created",
      title: `Link created: ${fromId} warns_against ${toId}`,
      related_id: row.id
    }, context);
    return linkOut(row);
  }

  private async getMemory(id: string) {
    const row = await this.db("items").where({ id }).first();
    if (!row) {
      throw new AppError("ITEM_NOT_FOUND", `Memory item ${id} does not exist.`, { id });
    }
    return itemOut(row);
  }

  private async memoryItemsPage(input: Row, context?: NormalizedGatewayRequestContext) {
    const commonOnly = input.common === true || input.project === null;
    const includeCommon = commonOnly ? true : input.includeCommon !== false;
    const project = commonOnly
      ? null
      : input.project
        ? await this.resolveProject(input.project, context)
        : await this.tryCurrentProject(context);
    if (!project && !includeCommon) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "Memory item list requires a project or includeCommon=true.");
    }

    const base = this.db("items");
    base.andWhere((builder) => {
      if (project) {
        builder.orWhere("project_id", project.id);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });
    if (input.type) {
      base.andWhere("type", String(input.type));
    }
    if (input.status) {
      base.andWhere("status", String(input.status));
    }
    if (Array.isArray(input.tags) && input.tags.length > 0) {
      base.andWhereRaw("tags @> ?::jsonb", [JSON.stringify(stringArray(input.tags))]);
    }

    return this.pageRows(
      base,
      input,
      (query) =>
        query
          .select("*")
          .orderByRaw("case when project_id is null then 1 else 0 end asc")
          .orderBy("updated_at", "desc"),
      itemOut
    );
  }

  private async searchMemory(input: Row, context?: NormalizedGatewayRequestContext) {
    const includeCommon = input.includeCommon !== false;
    const project = input.project ? await this.resolveProject(input.project, context) : await this.tryCurrentProject(context);
    if (!project && !includeCommon) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "Search requires a project or includeCommon=true.");
    }

    // query is optional here (unlike the public memory.search MCP tool,
    // which still requires it at the schema level) so internal callers like
    // project.summary can browse "recent active records for this project"
    // without inventing a query and running it through a mandatory FTS
    // filter that has no reason to match — see I-MEMORY-022 step 1.
    const queryText = typeof input.query === "string" && input.query.trim() ? input.query : null;
    let query = this.db("items").select("id", "project_id", "type", "title", "body", "status", "tags", "summary");
    if (queryText) {
      query = query
        .select(this.db.raw(`${combinedRankSql("items")} as rank`, [queryText, queryText, queryText]))
        .select(this.db.raw(`${kwicHeadlineSql()} as headline`, [queryText, queryText, queryText]))
        .whereRaw("search_vector @@ (plainto_tsquery('simple', ?) || plainto_tsquery('english', ?) || plainto_tsquery('russian', ?))", [queryText, queryText, queryText]);
    }

    query = query.andWhere((builder) => {
      if (project) {
        builder.orWhere("project_id", project.id);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });

    if (input.type) {
      query = query.andWhere("type", String(input.type));
    }
    if (input.status) {
      query = query.andWhere("status", String(input.status));
    }

    const rows = await query
      .orderByRaw("case when project_id is null then 1 else 0 end asc")
      .orderBy(queryText ? "rank" : "created_at", "desc")
      .limit(Number(input.limit ?? 10));
    return rows.map(searchOut);
  }

  private async memorySearchPage(input: Row, context?: NormalizedGatewayRequestContext) {
    const includeCommon = input.includeCommon !== false;
    const project = input.project ? await this.resolveProject(input.project, context) : await this.tryCurrentProject(context);
    if (!project && !includeCommon) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "Search requires a project or includeCommon=true.");
    }

    const queryText = String(input.query);
    const base = this.db("items").whereRaw("search_vector @@ (plainto_tsquery('simple', ?) || plainto_tsquery('english', ?) || plainto_tsquery('russian', ?))", [queryText, queryText, queryText]);
    base.andWhere((builder) => {
      if (project) {
        builder.orWhere("project_id", project.id);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });
    if (input.type) {
      base.andWhere("type", String(input.type));
    }
    if (input.status) {
      base.andWhere("status", String(input.status));
    }

    return this.pageRows(
      base,
      input,
      (query) =>
        query
          .select(
            "id",
            "project_id",
            "type",
            "title",
            "body",
            "status",
            "tags",
            "summary",
            this.db.raw(`${combinedRankSql("items")} as rank`, [queryText, queryText, queryText]),
            this.db.raw(`${kwicHeadlineSql()} as headline`, [queryText, queryText, queryText])
          )
          .orderByRaw("case when project_id is null then 1 else 0 end asc")
          .orderBy("rank", "desc"),
      searchOut
    );
  }

  private async updateMemory(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.db("items").where({ id }).first();
    if (!current) {
      throw new AppError("ITEM_NOT_FOUND", `Memory item ${id} does not exist.`, { id });
    }

    const patch = {
      title: typeof input.title === "string" ? input.title : current.title,
      body: typeof input.body === "string" ? input.body : current.body,
      status: typeof input.status === "string" ? input.status : current.status,
      tags: Array.isArray(input.tags) ? jsonStringArray(input.tags) : current.tags,
      summary: typeof input.summary === "string" ? input.summary : current.summary,
      updated_by: context.clientId,
      source_instance_id: context.clientId,
      updated_at: nowIso(),
      version: Number(current.version ?? 1) + 1
    };
    const [row] = await this.db("items").where({ id }).update(patch).returning("*");
    await this.recordEventForProject(row.project_id, {
      type: "item.updated",
      title: `Memory item updated: ${row.title}`,
      related_id: row.id
    }, context);
    return itemOut(row);
  }

  private async archiveMemory(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.db("items").where({ id }).first();
    if (!current) {
      throw new AppError("ITEM_NOT_FOUND", `Memory item ${id} does not exist.`, { id });
    }
    if (String(current.status) === "archived") {
      return {
        action: "already_archived",
        memory: itemOut(current),
        event: null
      };
    }

    const [row] = await this.db("items")
      .where({ id })
      .update({
        status: "archived",
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: nowIso(),
        version: Number(current.version ?? 1) + 1
      })
      .returning("*");
    const event = await this.recordEventForProject(stringOrNull(row.project_id), {
      type: "item.archived",
      title: `Memory item archived: ${String(row.title)}`,
      body: stringOrNull(input.reason),
      related_id: row.id
    }, context);
    return {
      action: "archived",
      memory: itemOut(row),
      event
    };
  }

  private async deleteMemory(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.db("items").where({ id }).first();
    if (!current) {
      throw new AppError("ITEM_NOT_FOUND", `Memory item ${id} does not exist.`, { id });
    }

    let deletedLinks = 0;
    await this.db.transaction(async (trx) => {
      deletedLinks = await this.deleteLinksForRecord(id, trx);
      await trx("items").where({ id }).del();
    });
    const event = await this.recordEventForProject(stringOrNull(current.project_id), {
      type: "item.deleted",
      title: `Memory item deleted: ${String(current.title)}`,
      body: stringOrNull(input.reason),
      related_id: id
    }, context);
    return {
      deletedMemory: itemOut(current),
      deletedLinks,
      event
    };
  }

  private async memoryHygieneReport(input: Row, context: NormalizedGatewayRequestContext) {
    const commonOnly = input.project === null;
    const project = commonOnly
      ? null
      : input.project
        ? await this.resolveProject(input.project, context)
        : await this.tryCurrentProject(context);
    const includeCommon = commonOnly ? true : input.includeCommon !== false;
    if (!project && !includeCommon) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "memory.hygiene_report requires a project or includeCommon=true.");
    }

    const limit = Number(input.limit ?? 20);
    const largeBodyChars = Number(input.largeBodyChars ?? 4000);
    const staleDays = Number(input.staleDays ?? 90);
    const staleBefore = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000).toISOString();
    const rows = await this.memoryHygieneRows(project?.id ?? null, includeCommon);
    const duplicateGroups = memoryDuplicateGroups(rows, limit);
    const largeRecords = rows
      .filter((row) => Number(row.bodyChars ?? 0) >= largeBodyChars)
      .sort((left, right) => Number(right.bodyChars ?? 0) - Number(left.bodyChars ?? 0))
      .slice(0, limit)
      .map(hygieneItemOut);
    const staleRecords = rows
      .filter((row) => String(row.updatedAt) < staleBefore)
      .sort((left, right) => String(left.updatedAt).localeCompare(String(right.updatedAt)))
      .slice(0, limit)
      .map(hygieneItemOut);

    return {
      summary:
        "Read-only memory hygiene report. Review suggested records before updating, archiving, or consolidating anything.",
      project: project ? compactProject(project) : null,
      includeCommon,
      thresholds: {
        largeBodyChars,
        staleDays,
        staleBefore
      },
      scanned: {
        activeItems: rows.length
      },
      findings: {
        largeRecords,
        staleRecords,
        duplicateTitleGroups: duplicateGroups
      },
      counts: {
        largeRecords: largeRecords.length,
        staleRecords: staleRecords.length,
        duplicateTitleGroups: duplicateGroups.length
      },
      nextCalls: hygieneNextCalls([...largeRecords, ...staleRecords], duplicateGroups)
    };
  }

  private async memoryHygieneRows(projectId: string | null, includeCommon: boolean): Promise<Row[]> {
    let query = this.db("items")
      .select("id", "project_id", "type", "title", "status", "tags", "created_at", "updated_at")
      .select(this.db.raw("char_length(body) as body_chars"))
      .where("status", "active");
    query = query.andWhere((builder) => {
      if (projectId) {
        builder.orWhere("project_id", projectId);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });
    const rows = await query.orderBy("updated_at", "desc").limit(2000);
    return rows.map((row) => ({
      id: String(row.id),
      projectId: stringOrNull(row.project_id),
      scope: row.project_id ? "project" : "common",
      type: String(row.type),
      title: String(row.title),
      status: String(row.status),
      tags: stringArray(row.tags),
      bodyChars: Number(row.body_chars ?? 0),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }));
  }

  private async putArtifact(input: Row, context: NormalizedGatewayRequestContext) {
    return this.storeArtifact(input, context, decodeBase64(String(input.contentBase64)), {
      contentType: typeof input.contentType === "string" ? input.contentType : undefined,
      conflictTool: "artifact.put"
    });
  }

  private async putTextArtifact(input: Row, context: NormalizedGatewayRequestContext) {
    const text = String(input.text ?? "");
    const artifactPath = normalizeArtifactPath(String(input.path));
    const contentType = typeof input.contentType === "string" ? input.contentType : inferTextContentType(artifactPath);
    if (!isTextArtifact(contentType, artifactPath)) {
      throw new AppError("VALIDATION_ERROR", "artifact.put_text requires a text-compatible contentType.", {
        path: artifactPath,
        contentType
      });
    }
    return this.storeArtifact(input, context, Buffer.from(text, "utf8"), {
      contentType,
      conflictTool: "artifact.put_text"
    });
  }

  private async storeArtifact(
    input: Row,
    context: NormalizedGatewayRequestContext,
    content: Buffer,
    options: { contentType?: string; conflictTool: "artifact.put" | "artifact.put_text" }
  ) {
    const common = input.common === true || input.project === null;
    const project = common ? null : await this.resolveProject(input.project, context);
    const artifactPath = normalizeArtifactPath(String(input.path));
    const maxBytes = Number(process.env.ARTIFACT_MAX_BYTES ?? 10 * 1024 * 1024);
    if (content.byteLength > maxBytes) {
      throw new AppError("VALIDATION_ERROR", `Artifact exceeds ARTIFACT_MAX_BYTES (${maxBytes}).`, {
        sizeBytes: content.byteLength,
        maxBytes
      });
    }

    const existing = await this.db("artifacts")
      .where({ project_id: project?.id ?? null, path: artifactPath })
      .first();
    if (existing && input.overwrite !== true) {
      throw new AppError("ARTIFACT_CONFLICT", "Artifact already exists. Choose overwrite, a versioned path, or archive the existing artifact first.", {
        existing: artifactOut(existing),
        requested: {
          scope: project ? "project" : "common",
          projectId: project?.id ?? null,
          path: artifactPath,
          title: typeof input.title === "string" ? input.title : path.posix.basename(artifactPath),
          contentType: typeof input.contentType === "string" ? input.contentType : inferContentType(artifactPath),
          sizeBytes: content.byteLength,
          sha256: createHash("sha256").update(content).digest("hex")
        },
        suggestedActions: [
          {
            action: "keep_existing",
            description: "Do not upload. Use artifact.get or the existing downloadPath."
          },
          {
            action: "overwrite",
            description: `Call ${options.conflictTool} again with overwrite=true only after the user confirms replacement.`
          },
          {
            action: "versioned_path",
            description: `Call ${options.conflictTool} with a new path such as templates/name-v2.md or templates/name-YYYY-MM-DD.md.`
          },
          {
            action: "archive_then_put",
            description: `Call artifact.archive for the existing artifact, then ${options.conflictTool} with the original path.`
          }
        ]
      });
    }

    const now = nowIso();
    const id = existing?.id ? String(existing.id) : String(input.id ?? (await this.nextId("artifacts", `A-${project ? projectKeyFromId(project.id) : "COMMON"}`)));
    const title = typeof input.title === "string" ? input.title : path.posix.basename(artifactPath);
    const contentType = options.contentType ?? inferContentType(artifactPath);
    const storagePath = artifactStoragePath(project?.slug ?? null, artifactPath);
    const absolutePath = artifactAbsolutePath(storagePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);

    const row = {
      id,
      project_id: project?.id ?? null,
      path: artifactPath,
      title,
      description: stringOrNull(input.description),
      content_type: contentType,
      size_bytes: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
      storage_path: storagePath,
      status: existing?.status ?? "active",
      archived_at: existing?.archived_at ?? null,
      archived_by: existing?.archived_by ?? null,
      archive_reason: existing?.archive_reason ?? null,
      tags: jsonStringArray(input.tags),
      created_by: existing?.created_by ?? context.clientId,
      updated_by: context.clientId,
      source_instance_id: context.clientId,
      version: Number(existing?.version ?? 0) + 1,
      created_at: existing?.created_at ?? now,
      updated_at: now
    };

    if (existing) {
      await this.db("artifacts").where({ id }).update(row);
    } else {
      await this.db("artifacts").insert(row);
    }

    await this.recordEventForProject(
      project?.id ?? null,
      {
        type: existing ? "artifact.updated" : "artifact.created",
        title: existing ? `Artifact updated: ${artifactPath}` : `Artifact created: ${artifactPath}`,
        body: `Stored ${content.byteLength} bytes as ${contentType}.`,
        related_id: id
      },
      context
    );

    return artifactOut(row);
  }

  private async searchArtifacts(input: Row, context?: NormalizedGatewayRequestContext) {
    const includeCommon = input.includeCommon !== false;
    const project = input.project ? await this.resolveProject(input.project, context) : await this.tryCurrentProject(context);
    if (!project && !includeCommon) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "Artifact search requires a project or includeCommon=true.");
    }

    let query = this.db("artifacts").select("*");
    const queryText = typeof input.query === "string" ? input.query : null;
    if (queryText) {
      query = query
        .select(this.db.raw(`${combinedRankSql("artifacts")} as rank`, [queryText, queryText, queryText]))
        .whereRaw("search_vector @@ (plainto_tsquery('simple', ?) || plainto_tsquery('english', ?) || plainto_tsquery('russian', ?))", [queryText, queryText, queryText]);
    }

    query = query.andWhere((builder) => {
      if (project) {
        builder.orWhere("project_id", project.id);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });

    if (Array.isArray(input.tags) && input.tags.length > 0) {
      query = query.andWhereRaw("tags @> ?::jsonb", [JSON.stringify(stringArray(input.tags))]);
    }
    if (input.status) {
      query = query.andWhere("status", String(input.status));
    } else if (input.includeArchived !== true) {
      query = query.andWhere("status", "active");
    }

    const rows = await query
      .orderByRaw("case when project_id is null then 1 else 0 end asc")
      .orderBy(queryText ? "rank" : "created_at", "desc")
      .limit(Number(input.limit ?? 10));
    const artifacts = rows.map(artifactSearchOut);
    return input.compact === true ? artifacts.map(compactArtifactSearchRecord) : artifacts;
  }

  private async artifactSearchPage(input: Row, context?: NormalizedGatewayRequestContext) {
    const includeCommon = input.includeCommon !== false;
    const project = input.project ? await this.resolveProject(input.project, context) : await this.tryCurrentProject(context);
    if (!project && !includeCommon) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "Artifact search requires a project or includeCommon=true.");
    }

    const queryText = typeof input.query === "string" ? input.query : null;
    const base = this.db("artifacts");
    if (queryText) {
      base.whereRaw("search_vector @@ (plainto_tsquery('simple', ?) || plainto_tsquery('english', ?) || plainto_tsquery('russian', ?))", [queryText, queryText, queryText]);
    }
    base.andWhere((builder) => {
      if (project) {
        builder.orWhere("project_id", project.id);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });
    if (Array.isArray(input.tags) && input.tags.length > 0) {
      base.andWhereRaw("tags @> ?::jsonb", [JSON.stringify(stringArray(input.tags))]);
    }
    if (input.status) {
      base.andWhere("status", String(input.status));
    } else if (input.includeArchived !== true) {
      base.andWhere("status", "active");
    }

    return this.pageRows(
      base,
      input,
      (query) => {
        query.select("*");
        if (queryText) {
          query.select(this.db.raw(`${combinedRankSql("artifacts")} as rank`, [queryText, queryText, queryText]));
        }
        query.orderByRaw("case when project_id is null then 1 else 0 end asc");
        return query.orderBy(queryText ? "rank" : "created_at", "desc");
      },
      artifactSearchOut
    );
  }

  private async listArtifacts(input: Row, context?: NormalizedGatewayRequestContext) {
    const commonOnly = input.common === true || input.project === null;
    const includeCommon = commonOnly ? true : input.includeCommon !== false;
    const project = commonOnly
      ? null
      : input.project
        ? await this.resolveProject(input.project, context)
        : await this.tryCurrentProject(context);
    if (!project && !includeCommon) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "Artifact list requires a project or includeCommon=true.");
    }

    let query = this.db("artifacts").select("*");
    query = query.andWhere((builder) => {
      if (project) {
        builder.orWhere("project_id", project.id);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });

    if (typeof input.pathPrefix === "string") {
      const prefix = normalizeArtifactPath(input.pathPrefix);
      query = query.andWhere("path", "like", `${prefix}%`);
    }
    if (Array.isArray(input.tags) && input.tags.length > 0) {
      query = query.andWhereRaw("tags @> ?::jsonb", [JSON.stringify(stringArray(input.tags))]);
    }
    if (input.status) {
      query = query.andWhere("status", String(input.status));
    } else if (input.includeArchived !== true) {
      query = query.andWhere("status", "active");
    }

    const rows = await query
      .orderByRaw("case when project_id is null then 1 else 0 end asc")
      .orderBy("path", "asc")
      .limit(Number(input.limit ?? 20));
    const artifacts = rows.map(artifactOut);
    return input.compact === true ? artifacts.map(compactArtifactRecord) : artifacts;
  }

  private async artifactsPage(input: Row, context?: NormalizedGatewayRequestContext) {
    const commonOnly = input.common === true || input.project === null;
    const includeCommon = commonOnly ? true : input.includeCommon !== false;
    const project = commonOnly
      ? null
      : input.project
        ? await this.resolveProject(input.project, context)
        : await this.tryCurrentProject(context);
    if (!project && !includeCommon) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "Artifact list requires a project or includeCommon=true.");
    }

    const base = this.db("artifacts");
    base.andWhere((builder) => {
      if (project) {
        builder.orWhere("project_id", project.id);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });
    if (typeof input.pathPrefix === "string") {
      const prefix = normalizeArtifactPath(input.pathPrefix);
      base.andWhere("path", "like", `${prefix}%`);
    }
    if (Array.isArray(input.tags) && input.tags.length > 0) {
      base.andWhereRaw("tags @> ?::jsonb", [JSON.stringify(stringArray(input.tags))]);
    }
    if (input.status) {
      base.andWhere("status", String(input.status));
    } else if (input.includeArchived !== true) {
      base.andWhere("status", "active");
    }

    return this.pageRows(
      base,
      input,
      (query) => query.select("*").orderByRaw("case when project_id is null then 1 else 0 end asc").orderBy("path", "asc"),
      artifactOut
    );
  }

  private async getArtifact(input: Row, context?: NormalizedGatewayRequestContext) {
    const row = input.id ? await this.artifactRowById(String(input.id)) : await this.artifactRowByPath(input, context);
    const output = artifactOut(row);
    if (input.includeContent === true) {
      const maxBytes = Number(input.maxBytes ?? 1024 * 1024);
      const sizeBytes = Number(row.size_bytes ?? 0);
      if (sizeBytes > maxBytes) {
        throw new AppError("VALIDATION_ERROR", `Artifact is too large for inline content. Use downloadPath instead.`, {
          sizeBytes,
          maxBytes,
          downloadPath: output.downloadPath
        });
      }
      const content = await readArtifactBytes(row);
      return {
        ...output,
        contentBase64: content.toString("base64")
      };
    }
    return output;
  }

  private async peekArtifact(input: Row, context?: NormalizedGatewayRequestContext) {
    const row = input.id ? await this.artifactRowById(String(input.id)) : await this.artifactRowByPath(input, context);
    const output = artifactOut(row);
    const contentType = String(row.content_type);
    const artifactPath = String(row.path);
    const isText = isTextArtifact(contentType, artifactPath);
    const isMarkdown = isMarkdownArtifact(contentType, artifactPath);
    const sizeBytes = Number(row.size_bytes ?? 0);
    const maxBytes = Math.min(Number(input.maxBytes ?? 16 * 1024), sizeBytes);
    const excerptChars = Number(input.excerptChars ?? 1000);
    const outlineLimit = Number(input.outlineLimit ?? 20);

    if (!isText || maxBytes <= 0) {
      return {
        ...output,
        preview: {
          isText,
          isMarkdown,
          truncated: false,
          excerpt: null,
          outline: [],
          note: "Binary or non-text artifact. Use downloadPath when bytes are needed."
        }
      };
    }

    const buffer = await readArtifactPrefixForRow(row, maxBytes);
    const text = buffer.toString("utf8");
    const truncated = sizeBytes > buffer.byteLength || text.length > excerptChars;
    const excerpt = text.slice(0, excerptChars);
    return {
      ...output,
      preview: {
        isText,
        isMarkdown,
        truncated,
        readBytes: buffer.byteLength,
        maxBytes,
        excerpt,
        outline: isMarkdown ? markdownOutline(text, outlineLimit) : []
      }
    };
  }

  private async readTextArtifact(input: Row, context?: NormalizedGatewayRequestContext) {
    const row = input.id ? await this.artifactRowById(String(input.id)) : await this.artifactRowByPath(input, context);
    const output = artifactOut(row);
    const contentType = String(row.content_type);
    const artifactPath = String(row.path);
    const isText = isTextArtifact(contentType, artifactPath);
    const isMarkdown = isMarkdownArtifact(contentType, artifactPath);
    if (!isText) {
      throw new AppError("VALIDATION_ERROR", "Artifact is not a text artifact. Use downloadPath for binary bytes.", {
        contentType,
        path: artifactPath,
        downloadPath: output.downloadPath
      });
    }

    const sizeBytes = Number(row.size_bytes ?? 0);
    const maxBytes = Math.min(Number(input.maxBytes ?? 128 * 1024), sizeBytes);
    const maxChars = Number(input.maxChars ?? 20_000);
    const maxLines = Number(input.maxLines ?? 500);
    const outlineLimit = Number(input.outlineLimit ?? 40);
    const buffer =
      maxBytes > 0 ? await readArtifactPrefixForRow(row, maxBytes) : Buffer.alloc(0);
    const decoded = buffer.toString("utf8");
    const limited = limitText(decoded, maxChars, maxLines);
    const redaction = input.redactSecrets === false ? { text: limited.text, redactions: 0 } : redactSensitiveText(limited.text);
    const truncatedByBytes = sizeBytes > buffer.byteLength;
    const truncated = truncatedByBytes || limited.truncatedByChars || limited.truncatedByLines;

    return {
      ...output,
      text: redaction.text,
      textInfo: {
        isText,
        isMarkdown,
        encoding: "utf8",
        readBytes: buffer.byteLength,
        maxBytes,
        maxChars,
        maxLines,
        truncated,
        truncatedByBytes,
        truncatedByChars: limited.truncatedByChars,
        truncatedByLines: limited.truncatedByLines,
        redacted: redaction.redactions > 0,
        redactions: redaction.redactions,
        base64Included: false
      },
      outline: isMarkdown ? markdownOutline(redaction.text, outlineLimit) : []
    };
  }

  private async updateArtifactMetadata(input: Row, context: NormalizedGatewayRequestContext) {
    const current = input.id ? await this.artifactRowById(String(input.id)) : await this.artifactRowByPath(input, context);
    const [row] = await this.db("artifacts")
      .where({ id: String(current.id) })
      .update({
        title: typeof input.title === "string" ? input.title : current.title,
        description:
          input.description === null
            ? null
            : typeof input.description === "string"
              ? input.description
              : current.description,
        tags: Array.isArray(input.tags) ? jsonStringArray(input.tags) : current.tags,
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: nowIso(),
        version: Number(current.version ?? 1) + 1
      })
      .returning("*");
    await this.recordEventForProject(stringOrNull(row.project_id), {
      type: "artifact.metadata_updated",
      title: `Artifact metadata updated: ${String(row.path)}`,
      related_id: row.id
    }, context);
    return artifactOut(row);
  }

  private async archiveArtifact(input: Row, context: NormalizedGatewayRequestContext) {
    const current = input.id ? await this.artifactRowById(String(input.id)) : await this.artifactRowByPath(input, context);
    if (String(current.status) === "archived") {
      return {
        action: "already_archived",
        artifact: artifactOut(current),
        event: null
      };
    }

    const now = nowIso();
    const [row] = await this.db("artifacts")
      .where({ id: String(current.id) })
      .update({
        status: "archived",
        archived_at: now,
        archived_by: context.clientId,
        archive_reason: stringOrNull(input.reason),
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: now,
        version: Number(current.version ?? 1) + 1
      })
      .returning("*");
    const event = await this.recordEventForProject(stringOrNull(row.project_id), {
      type: "artifact.archived",
      title: `Artifact archived: ${String(row.path)}`,
      body: stringOrNull(input.reason),
      related_id: row.id
    }, context);

    return {
      action: "archived",
      artifact: artifactOut(row),
      event
    };
  }

  private async deleteArtifact(input: Row, context: NormalizedGatewayRequestContext) {
    const current = input.id ? await this.artifactRowById(String(input.id)) : await this.artifactRowByPath(input, context);
    const id = String(current.id);
    let deletedLinks = 0;
    await this.db.transaction(async (trx) => {
      deletedLinks = await this.deleteLinksForRecord(id, trx);
      await trx("artifacts").where({ id }).del();
    });
    await rm(artifactAbsolutePath(String(current.storage_path)), { force: true });
    const event = await this.recordEventForProject(stringOrNull(current.project_id), {
      type: "artifact.deleted",
      title: `Artifact deleted: ${String(current.path)}`,
      body: stringOrNull(input.reason),
      related_id: id
    }, context);
    return {
      deletedArtifact: artifactOut(current),
      deletedLinks,
      event
    };
  }

  private async artifactRowById(id: string): Promise<Row> {
    const row = await this.db("artifacts").where({ id }).first();
    if (!row) {
      throw new AppError("ARTIFACT_NOT_FOUND", `Artifact ${id} does not exist.`, { id });
    }
    return row;
  }

  private async artifactRowByPath(input: Row, context?: NormalizedGatewayRequestContext): Promise<Row> {
    const common = input.project === null;
    const project = common ? null : await this.resolveProject(input.project, context);
    const artifactPath = normalizeArtifactPath(String(input.path));
    const row = await this.db("artifacts").where({ project_id: project?.id ?? null, path: artifactPath }).first();
    if (!row) {
      throw new AppError("ARTIFACT_NOT_FOUND", `Artifact ${artifactPath} does not exist.`, {
        project: project?.id ?? null,
        path: artifactPath
      });
    }
    return row;
  }

  private async createTask(input: Row, context: NormalizedGatewayRequestContext) {
    const project = await this.resolveProject(input.project, context);
    const now = nowIso();
    const row = {
      id: await this.nextId("tasks", `T-${projectKeyFromId(project.id)}`),
      project_id: project.id,
      title: String(input.title),
      status: "todo",
      milestone: stringOrNull(input.milestone),
      priority: input.priority ?? 100,
      scope: stringOrNull(input.scope),
      acceptance: stringOrNull(input.acceptance),
      allowed_files: jsonStringArray(input.allowedFiles),
      forbidden_files: jsonStringArray(input.forbiddenFiles),
      depends_on: jsonStringArray(input.dependsOn),
      notes: stringOrNull(input.notes),
      ...writeActorFields(context),
      created_at: now,
      updated_at: now
    };
    await this.db("tasks").insert(row);
    await this.recordEventForProject(project.id, {
      type: "task.created",
      title: `Task created: ${row.title}`,
      related_id: row.id
    }, context);
    return taskOut(row);
  }

  private async listTasks(input: Row, context?: NormalizedGatewayRequestContext) {
    const project = await this.resolveProject(input.project, context);
    let query = this.taskSelectWithActiveClaimCount(this.db("tasks")).where("project_id", project.id);
    if (input.status) {
      query = query.andWhere("status", String(input.status));
    }
    if (input.milestone) {
      query = query.andWhere("milestone", String(input.milestone));
    }
    const tasks = (await query.orderBy("priority").orderBy("created_at").limit(Number(input.limit ?? 20))).map(taskOut);
    return input.compact === true ? tasks.map(compactTask) : tasks;
  }

  private async tasksPage(input: Row, context?: NormalizedGatewayRequestContext) {
    const project = await this.resolveProject(input.project, context);
    const base = this.db("tasks").where("project_id", project.id);
    if (input.status) {
      base.andWhere("status", String(input.status));
    }
    if (input.milestone) {
      base.andWhere("milestone", String(input.milestone));
    }
    return this.pageRows(base, input, (query) => this.taskSelectWithActiveClaimCount(query).orderBy("priority").orderBy("created_at"), taskOut);
  }

  private async getTask(id: string) {
    const row = await this.taskSelectWithActiveClaimCount(this.db("tasks")).where({ id }).first();
    if (!row) {
      throw new AppError("TASK_NOT_FOUND", `Task ${id} does not exist.`, { id });
    }
    return taskOut(row);
  }

  private async deleteTask(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.db("tasks").where({ id }).first();
    if (!current) {
      throw new AppError("TASK_NOT_FOUND", `Task ${id} does not exist.`, { id });
    }
    let deletedLinks = 0;
    await this.db.transaction(async (trx) => {
      deletedLinks = await this.deleteLinksForRecord(id, trx);
      await trx("tasks").where({ id }).del();
    });
    const event = await this.recordEventForProject(String(current.project_id), {
      type: "task.deleted",
      title: `Task deleted: ${String(current.title)}`,
      body: stringOrNull(input.reason),
      related_id: id
    }, context);
    return {
      deletedTask: taskOut(current),
      deletedLinks,
      event
    };
  }

  private async nextTask(input: Row, context?: NormalizedGatewayRequestContext) {
    const project = await this.resolveProject(input.project, context);
    const row = await this.taskSelectWithActiveClaimCount(this.db("tasks"))
      .where({ project_id: project.id, status: "todo" })
      .orderBy("priority")
      .orderBy("created_at")
      .first();
    return row ? taskOut(row) : null;
  }

  private async updateTaskStatus(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.db("tasks").where({ id }).first();
    if (!current) {
      throw new AppError("TASK_NOT_FOUND", `Task ${id} does not exist.`, { id });
    }
    if (String(input.status) === "done") {
      return (await this.completeTask(
        {
          id,
          acceptanceEvidence: stringOrNull(input.note) ?? undefined,
          force: input.force,
          reason: input.reason
        },
        context
      )).task;
    }
    const note = stringOrNull(input.note);
    const notes = note ? (current.notes ? `${current.notes}\n\n${note}` : note) : current.notes;
    const [row] = await this.db("tasks")
      .where({ id })
      .update({
        status: String(input.status),
        notes,
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: nowIso(),
        version: Number(current.version ?? 1) + 1
      })
      .returning("*");
    await this.recordEventForProject(row.project_id, {
      type: eventTypeForStatus(String(input.status)),
      title: `Task status changed: ${row.title}`,
      body: note,
      related_id: row.id
    }, context);
    return taskOut(row);
  }

  private async claimTask(input: Row, context: NormalizedGatewayRequestContext) {
    const taskId = String(input.taskId);
    const task = await this.taskRow(taskId);
    if (["done", "cancelled"].includes(String(task.status))) {
      throw new AppError("VALIDATION_ERROR", `Task ${taskId} cannot be claimed because it is ${String(task.status)}.`, {
        taskId,
        status: task.status
      });
    }

    await this.expireTaskClaims(taskId);
    const now = nowIso();
    const leaseExpiresAt = taskClaimLeaseExpiresAt(input.leaseSeconds);
    const row = {
      id: await this.nextId("task_claims", `TC-${projectKeyFromId(String(task.project_id))}`),
      task_id: taskId,
      project_id: String(task.project_id),
      client_id: context.clientId,
      client_label: context.clientLabel,
      client_kind: typeof context.metadata.kind === "string" ? context.metadata.kind : null,
      role: taskClaimRole(input.role),
      scope: stringOrNull(input.scope),
      status: "active",
      lease_expires_at: leaseExpiresAt,
      heartbeat_at: now,
      note: stringOrNull(input.note),
      ...writeActorFields(context),
      created_at: now,
      updated_at: now
    };

    await this.db.transaction(async (trx) => {
      await trx("task_claims").insert(row);
      if (String(task.status) === "todo") {
        await trx("tasks").where({ id: taskId }).update({
          status: "doing",
          updated_by: context.clientId,
          source_instance_id: context.clientId,
          updated_at: now,
          version: Number(task.version ?? 1) + 1
        });
      }
    });

    const event = await this.recordEventForProject(String(task.project_id), {
      type: "task.claimed",
      title: `Task claimed: ${String(task.title)}`,
      body: taskClaimEventBody(row),
      related_id: taskId
    }, context);
    return {
      claim: taskClaimOut(row),
      task: await this.getTask(taskId),
      event
    };
  }

  private async heartbeatTaskClaim(input: Row, context: NormalizedGatewayRequestContext) {
    const claim = await this.activeTaskClaim(String(input.claimId));
    const now = nowIso();
    const [row] = await this.db("task_claims")
      .where({ id: claim.id })
      .update({
        lease_expires_at: taskClaimLeaseExpiresAt(input.leaseSeconds),
        heartbeat_at: now,
        note: appendText(stringOrNull(claim.note), stringOrNull(input.note)),
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: now,
        version: Number(claim.version ?? 1) + 1
      })
      .returning("*");
    return taskClaimOut(row);
  }

  private async completeTaskClaim(input: Row, context: NormalizedGatewayRequestContext) {
    return this.finishTaskClaim(input, "completed", "task.claim_completed", "Task claim completed", context);
  }

  private async releaseTaskClaim(input: Row, context: NormalizedGatewayRequestContext) {
    return this.finishTaskClaim(input, "released", "task.claim_released", "Task claim released", context);
  }

  private async finishTaskClaim(
    input: Row,
    status: "completed" | "released",
    eventType: string,
    eventTitle: string,
    context: NormalizedGatewayRequestContext
  ) {
    const claim = await this.activeTaskClaim(String(input.claimId));
    const now = nowIso();
    const [row] = await this.db("task_claims")
      .where({ id: claim.id })
      .update({
        status,
        note: appendText(stringOrNull(claim.note), stringOrNull(input.note)),
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: now,
        version: Number(claim.version ?? 1) + 1
      })
      .returning("*");
    const task = await this.getTask(String(row.task_id));
    const event = await this.recordEventForProject(String(row.project_id), {
      type: eventType,
      title: `${eventTitle}: ${String(row.id)}`,
      body: taskClaimEventBody(row),
      related_id: String(row.task_id)
    }, context);
    return {
      claim: taskClaimOut(row),
      task,
      event
    };
  }

  private async listTaskClaims(input: Row) {
    const taskId = String(input.taskId);
    await this.assertTaskExists(taskId);
    await this.expireTaskClaims(taskId);
    let query = this.db("task_claims").select("*").where({ task_id: taskId });
    if (input.includeInactive !== true) {
      query = query.andWhere({ status: "active" }).andWhere("lease_expires_at", ">", nowIso());
    }
    const rows = await query
      .orderByRaw("case status when 'active' then 0 when 'completed' then 1 when 'released' then 2 when 'expired' then 3 else 4 end")
      .orderBy("updated_at", "desc");
    return rows.map(taskClaimOut);
  }

  private async completeTask(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.taskRow(id);
    let completedClaim: Row | null = null;

    if (input.claimId) {
      completedClaim = (await this.completeTaskClaim({ claimId: input.claimId, note: input.acceptanceEvidence }, context)).claim;
    }

    await this.expireTaskClaims(id);
    const activeClaims = await this.activeTaskClaims(id);
    const force = input.force === true;
    if (activeClaims.length > 0 && !force) {
      throw new AppError(
        "TASK_HAS_ACTIVE_CLAIMS",
        `Task ${id} still has ${activeClaims.length} active claim(s). Complete/release claims first, or use force=true with a reason.`,
        { taskId: id, activeClaims: activeClaims.map(taskClaimOut) }
      );
    }
    const reason = stringOrNull(input.reason);
    const evidence = stringOrNull(input.acceptanceEvidence);
    if (activeClaims.length > 0 && force && !reason && !evidence) {
      throw new AppError("VALIDATION_ERROR", "Forced task completion requires reason or acceptanceEvidence.", { taskId: id });
    }

    const now = nowIso();
    let cancelledClaims = 0;
    if (activeClaims.length > 0 && force) {
      cancelledClaims = Number(
        await this.db("task_claims")
          .where({ task_id: id, status: "active" })
          .andWhere("lease_expires_at", ">", now)
          .update({
            status: "cancelled",
            note: appendText(null, `Cancelled by forced task completion.${reason ? ` Reason: ${reason}` : ""}`),
            updated_by: context.clientId,
            source_instance_id: context.clientId,
            updated_at: now
          })
      );
    }

    const note = [evidence ? `Acceptance evidence: ${evidence}` : null, reason ? `Completion reason: ${reason}` : null]
      .filter((value): value is string => Boolean(value))
      .join("\n");
    const [row] = await this.db("tasks")
      .where({ id })
      .update({
        status: "done",
        notes: appendText(stringOrNull(current.notes), note || null),
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: now,
        version: Number(current.version ?? 1) + 1
      })
      .returning("*");
    const event = await this.recordEventForProject(String(row.project_id), {
      type: "task.completed",
      title: `Task completed: ${String(row.title)}`,
      body: [
        evidence,
        reason,
        cancelledClaims > 0 ? `Cancelled active claims: ${cancelledClaims}` : null
      ]
        .filter((value): value is string => Boolean(value))
        .join("\n"),
      related_id: id
    }, context);
    return {
      task: await this.getTask(id),
      completedClaim,
      event
    };
  }

  private async addTaskNote(input: Row, context: NormalizedGatewayRequestContext) {
    const task = await this.getTask(String(input.taskId));
    const type = typeof input.type === "string" ? input.type : "coordination_note";
    const item = await this.createMemory({
      project: task.projectId,
      type,
      title: stringOrNull(input.title) ?? `${taskNoteTypeTitle(type)}: ${task.title}`,
      body: String(input.body),
      tags: ["task-note", type, ...stringArray(input.tags)]
    }, context);
    const link = await this.createLink({
      project: task.projectId,
      fromId: item.id,
      toId: task.id,
      relation: stringOrNull(input.relation) ?? taskNoteDefaultRelation(type)
    }, context);
    const event = await this.recordEventForProject(task.projectId, {
      type: "task.note_added",
      title: `Task note added: ${task.title}`,
      body: `${item.id} ${link.relation} ${task.id}`,
      related_id: item.id
    }, context);
    return { item, link, event };
  }

  private async assertTaskExists(id: string): Promise<void> {
    await this.taskRow(id);
  }

  private async taskRow(id: string): Promise<Row> {
    const row = await this.db("tasks").where({ id }).first();
    if (!row) {
      throw new AppError("TASK_NOT_FOUND", `Task ${id} does not exist.`, { id });
    }
    return row;
  }

  private async taskClaimRow(id: string): Promise<Row> {
    const row = await this.db("task_claims").where({ id }).first();
    if (!row) {
      throw new AppError("TASK_CLAIM_NOT_FOUND", `Task claim ${id} does not exist.`, { id });
    }
    return row;
  }

  private async activeTaskClaim(id: string): Promise<Row> {
    const row = await this.taskClaimRow(id);
    await this.expireTaskClaims(String(row.task_id));
    const current = await this.taskClaimRow(id);
    if (String(current.status) !== "active" || new Date(String(current.lease_expires_at)).getTime() <= Date.now()) {
      throw new AppError("TASK_CLAIM_NOT_ACTIVE", `Task claim ${id} is not active.`, {
        id,
        status: taskClaimEffectiveStatus(current)
      });
    }
    return current;
  }

  private async activeTaskClaims(taskId: string): Promise<Row[]> {
    return await this.db("task_claims")
      .select("*")
      .where({ task_id: taskId, status: "active" })
      .andWhere("lease_expires_at", ">", nowIso())
      .orderBy("updated_at", "desc");
  }

  private async expireTaskClaims(taskId?: string): Promise<number> {
    const query = this.db("task_claims")
      .where({ status: "active" })
      .andWhere("lease_expires_at", "<=", nowIso());
    if (taskId) {
      query.andWhere({ task_id: taskId });
    }
    return Number(
      await query.update({
        status: "expired",
        updated_at: nowIso()
      })
    );
  }

  private async recordDecision(input: Row, context: NormalizedGatewayRequestContext) {
    const project = input.project === null ? null : await this.resolveProject(input.project, context);
    const now = nowIso();
    const row = {
      id: await this.nextId("decisions", project ? `D-${projectKeyFromId(project.id)}` : "D-COMMON"),
      project_id: project?.id ?? null,
      title: String(input.title),
      status: typeof input.status === "string" ? input.status : "active",
      context: stringOrNull(input.context),
      decision: String(input.decision),
      rationale: stringOrNull(input.rationale),
      consequences: stringOrNull(input.consequences),
      tags: jsonStringArray(input.tags),
      supersedes_id: stringOrNull(input.supersedesId),
      summary: stringOrNull(input.summary),
      ...writeActorFields(context),
      created_at: now,
      updated_at: now
    };
    await this.db("decisions").insert(row);
    if (row.supersedes_id) {
      await this.db("decisions").where({ id: row.supersedes_id }).update({ status: "superseded", updated_at: nowIso() });
    }
    await this.recordEventForProject(row.project_id, {
      type: "decision.recorded",
      title: `Decision recorded: ${row.title}`,
      related_id: row.id
    }, context);
    const linkage = await this.applyRecordLinkage(row.id, row.project_id, input.tags, input.links, context);
    return { ...decisionOut(row), ...linkage };
  }

  private async supersedeDecision(input: Row, context: NormalizedGatewayRequestContext) {
    const oldRow = await this.db("decisions").where({ id: String(input.supersedesId) }).first();
    if (!oldRow) {
      throw new AppError("DECISION_NOT_FOUND", `Decision ${String(input.supersedesId)} does not exist.`, {
        id: input.supersedesId
      });
    }

    const projectId = await this.resolveDecisionProjectId(input, oldRow, context);
    if (projectId !== stringOrNull(oldRow.project_id)) {
      throw new AppError("VALIDATION_ERROR", "Replacement decision must stay in the same project/common scope.", {
        oldDecisionId: oldRow.id,
        oldProjectId: stringOrNull(oldRow.project_id),
        replacementProjectId: projectId
      });
    }

    const now = nowIso();
    const row = {
      id: await this.nextId("decisions", projectId ? `D-${projectKeyFromId(projectId)}` : "D-COMMON"),
      project_id: projectId,
      title: String(input.title),
      status: typeof input.status === "string" ? input.status : "active",
      context: stringOrNull(input.context),
      decision: String(input.decision),
      rationale: stringOrNull(input.rationale),
      consequences: stringOrNull(input.consequences),
      tags: jsonStringArray(input.tags),
      supersedes_id: String(input.supersedesId),
      summary: stringOrNull(input.summary),
      ...writeActorFields(context),
      created_at: now,
      updated_at: now
    };

    await this.db("decisions").insert(row);
    const [superseded] = await this.db("decisions")
      .where({ id: String(oldRow.id) })
      .update({
        status: "superseded",
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: now,
        version: Number(oldRow.version ?? 1) + 1
      })
      .returning("*");
    const link = await this.createSupersedesLink(String(row.id), String(oldRow.id), projectId, context);
    const event = await this.recordEventForProject(projectId, {
      type: "decision.superseded",
      title: `Decision superseded: ${String(oldRow.title)}`,
      body: `${String(row.id)} supersedes ${String(oldRow.id)}.`,
      related_id: row.id
    }, context);

    return {
      decision: decisionOut(row),
      superseded: decisionOut(superseded),
      link,
      event
    };
  }

  private async resolveDecisionProjectId(
    input: Row,
    oldRow: Row,
    context: NormalizedGatewayRequestContext
  ): Promise<string | null> {
    if (input.project === undefined) {
      return stringOrNull(oldRow.project_id);
    }
    if (input.project === null) {
      return null;
    }
    return (await this.resolveProject(input.project, context)).id;
  }

  private async createSupersedesLink(
    fromId: string,
    toId: string,
    projectId: string | null,
    context: NormalizedGatewayRequestContext
  ) {
    const row = {
      id: await this.nextId("links", projectId ? `L-${projectKeyFromId(projectId)}` : "L-COMMON"),
      project_id: projectId,
      from_id: fromId,
      to_id: toId,
      relation: "supersedes",
      created_by: context.clientId,
      source_instance_id: context.clientId,
      created_at: nowIso()
    };
    await this.db("links").insert(row);
    await this.recordEventForProject(projectId, {
      type: "link.created",
      title: `Link created: ${fromId} supersedes ${toId}`,
      related_id: row.id
    }, context);
    return linkOut(row);
  }

  private async listDecisions(input: Row, context?: NormalizedGatewayRequestContext) {
    const includeCommon = input.includeCommon !== false;
    const project = input.project ? await this.resolveProject(input.project, context) : await this.tryCurrentProject(context);
    let query = this.db("decisions").select("*");
    query = query.where((builder) => {
      if (project) {
        builder.orWhere("project_id", project.id);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });
    if (input.status) {
      query = query.andWhere("status", String(input.status));
    }
    const rows = await query.orderByRaw("case when project_id is null then 1 else 0 end asc").orderBy("created_at", "desc").limit(Number(input.limit ?? 20));
    return rows.map(decisionOut);
  }

  private async decisionsPage(input: Row, context?: NormalizedGatewayRequestContext) {
    const includeCommon = input.includeCommon !== false;
    const project = input.project ? await this.resolveProject(input.project, context) : await this.tryCurrentProject(context);
    const base = this.db("decisions");
    base.where((builder) => {
      if (project) {
        builder.orWhere("project_id", project.id);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });
    if (input.status) {
      base.andWhere("status", String(input.status));
    }
    return this.pageRows(
      base,
      input,
      (query) => query.select("*").orderByRaw("case when project_id is null then 1 else 0 end asc").orderBy("created_at", "desc"),
      decisionOut
    );
  }

  private async getDecision(id: string) {
    const row = await this.db("decisions").where({ id }).first();
    if (!row) {
      throw new AppError("DECISION_NOT_FOUND", `Decision ${id} does not exist.`, { id });
    }
    return decisionOut(row);
  }

  private async archiveDecision(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.db("decisions").where({ id }).first();
    if (!current) {
      throw new AppError("DECISION_NOT_FOUND", `Decision ${id} does not exist.`, { id });
    }
    if (String(current.status) === "archived") {
      return {
        action: "already_archived",
        decision: decisionOut(current),
        event: null
      };
    }

    const [row] = await this.db("decisions")
      .where({ id })
      .update({
        status: "archived",
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: nowIso(),
        version: Number(current.version ?? 1) + 1
      })
      .returning("*");
    const event = await this.recordEventForProject(stringOrNull(row.project_id), {
      type: "decision.archived",
      title: `Decision archived: ${String(row.title)}`,
      body: stringOrNull(input.reason),
      related_id: row.id
    }, context);
    return {
      action: "archived",
      decision: decisionOut(row),
      event
    };
  }

  private async deleteDecision(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.db("decisions").where({ id }).first();
    if (!current) {
      throw new AppError("DECISION_NOT_FOUND", `Decision ${id} does not exist.`, { id });
    }

    let deletedLinks = 0;
    await this.db.transaction(async (trx) => {
      await trx("decisions").where({ supersedes_id: id }).update({
        supersedes_id: null,
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: nowIso()
      });
      deletedLinks = await this.deleteLinksForRecord(id, trx);
      await trx("decisions").where({ id }).del();
    });
    const event = await this.recordEventForProject(stringOrNull(current.project_id), {
      type: "decision.deleted",
      title: `Decision deleted: ${String(current.title)}`,
      body: stringOrNull(input.reason),
      related_id: id
    }, context);
    return {
      deletedDecision: decisionOut(current),
      deletedLinks,
      event
    };
  }

  private async recordEvent(input: Row, context: NormalizedGatewayRequestContext) {
    const project = input.project === null ? null : await this.resolveProject(input.project, context);
    return this.recordEventForProject(project?.id ?? null, {
      type: String(input.type),
      title: asNullableString(input.title),
      body: asNullableString(input.body),
      related_id: asNullableString(input.relatedId)
    }, context);
  }

  private async listEvents(input: Row, context?: NormalizedGatewayRequestContext) {
    let query = this.db("events").select("*");
    if (input.project !== undefined) {
      if (input.project === null) {
        query = query.whereNull("project_id");
      } else {
        const project = await this.resolveProject(input.project, context);
        query = query.where("project_id", project.id);
      }
    }
    if (input.relatedId) {
      query = query.andWhere("related_id", String(input.relatedId));
    }
    return (await query.orderBy("created_at", "desc").limit(Number(input.limit ?? 20))).map(eventOut);
  }

  private async eventsPage(input: Row, context?: NormalizedGatewayRequestContext) {
    const base = this.db("events");
    if (input.project !== undefined) {
      if (input.project === null) {
        base.whereNull("project_id");
      } else {
        const project = await this.resolveProject(input.project, context);
        base.where("project_id", project.id);
      }
    }
    if (input.relatedId) {
      base.andWhere("related_id", String(input.relatedId));
    }
    return this.pageRows(base, input, (query) => query.select("*").orderBy("created_at", "desc"), eventOut);
  }

  private async deleteEvent(input: Row) {
    const id = String(input.id);
    const current = await this.db("events").where({ id }).first();
    if (!current) {
      throw new AppError("NOT_FOUND", `Event ${id} does not exist.`, { id });
    }
    await this.db("events").where({ id }).del();
    return {
      deletedEvent: eventOut(current)
    };
  }

  private async createLink(input: Row, context: NormalizedGatewayRequestContext) {
    await this.assertRecordExists(String(input.fromId));
    await this.assertRecordExists(String(input.toId));
    const project = input.project === null ? null : await this.resolveProject(input.project, context);
    const row = {
      id: await this.nextId("links", project ? `L-${projectKeyFromId(project.id)}` : "L-COMMON"),
      project_id: project?.id ?? null,
      from_id: String(input.fromId),
      to_id: String(input.toId),
      relation: String(input.relation),
      created_by: context.clientId,
      source_instance_id: context.clientId,
      created_at: nowIso()
    };
    await this.db("links").insert(row);
    await this.recordEventForProject(row.project_id, {
      type: "link.created",
      title: `Link created: ${row.from_id} ${row.relation} ${row.to_id}`,
      related_id: row.id
    }, context);
    return linkOut(row);
  }

  // Shared by memory.create and decision.record (I-MEMORY-022 step 2): if the
  // caller passes explicit links, create them atomically with the new record
  // so the graph doesn't stay sparse. Otherwise, when tags were given, run a
  // cheap tag-overlap query and return candidates as a non-blocking hint —
  // never throws, since this is best-effort assistance, not validation.
  private async applyRecordLinkage(
    fromId: string,
    projectId: string | null,
    tags: unknown,
    links: unknown,
    context: NormalizedGatewayRequestContext
  ): Promise<{ linksCreated?: unknown[]; relatedCandidates?: unknown[] }> {
    const linkEntries = Array.isArray(links) ? links : [];
    if (linkEntries.length > 0) {
      const linksCreated: unknown[] = [];
      for (const entry of linkEntries) {
        const candidate = entry as Row;
        const toId = typeof candidate?.toId === "string" ? candidate.toId : null;
        const relation = typeof candidate?.relation === "string" ? candidate.relation : null;
        if (!toId || !relation) {
          continue;
        }
        await this.assertRecordExists(toId);
        const row = {
          id: await this.nextId("links", projectId ? `L-${projectKeyFromId(projectId)}` : "L-COMMON"),
          project_id: projectId,
          from_id: fromId,
          to_id: toId,
          relation,
          created_by: context.clientId,
          source_instance_id: context.clientId,
          created_at: nowIso()
        };
        await this.db("links").insert(row);
        await this.recordEventForProject(projectId, {
          type: "link.created",
          title: `Link created: ${fromId} ${relation} ${toId}`,
          related_id: row.id
        }, context);
        linksCreated.push(linkOut(row));
      }
      return linksCreated.length > 0 ? { linksCreated } : {};
    }

    const tagList = stringArray(tags);
    if (tagList.length === 0) {
      return {};
    }
    const relatedCandidates = await this.findRelatedByTags(fromId, projectId, tagList);
    return relatedCandidates.length > 0 ? { relatedCandidates } : {};
  }

  private async findRelatedByTags(
    excludeId: string,
    projectId: string | null,
    tags: string[]
  ): Promise<Array<{ id: string; type: string; title: string }>> {
    const scope = (query: Knex.QueryBuilder) =>
      projectId === null ? query.whereNull("project_id") : query.where("project_id", projectId);

    // Postgres' jsonb "?|" (any key exists) operator collides with knex's own
    // "?" placeholder parsing, so the overlap check is expressed via
    // jsonb_array_elements_text + ANY(?::text[]) instead, which needs only
    // one real bind parameter.
    const tagOverlap = "EXISTS (SELECT 1 FROM jsonb_array_elements_text(tags) AS t(tag) WHERE t.tag = ANY(?::text[]))";
    const items = await scope(this.db("items").select("id", "type", "title", "created_at"))
      .whereRaw(tagOverlap, [tags])
      .andWhere("id", "!=", excludeId);
    const decisions = await scope(this.db("decisions").select("id", "title", "created_at"))
      .whereRaw(tagOverlap, [tags])
      .andWhere("id", "!=", excludeId);

    return [
      ...items.map((row: Row) => ({ id: String(row.id), type: String(row.type), title: String(row.title), createdAt: String(row.created_at) })),
      ...decisions.map((row: Row) => ({ id: String(row.id), type: "decision", title: String(row.title), createdAt: String(row.created_at) }))
    ]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 3)
      .map(({ id, type, title }) => ({ id, type, title }));
  }

  private async listLinks(input: Row) {
    const direction = input.direction ?? "both";
    let query = this.db("links").select("*");
    if (direction === "from") {
      query = query.where("from_id", String(input.id));
    } else if (direction === "to") {
      query = query.where("to_id", String(input.id));
    } else {
      query = query.where((builder) => builder.where("from_id", String(input.id)).orWhere("to_id", String(input.id)));
    }
    if (input.relation) {
      query = query.andWhere("relation", String(input.relation));
    }
    return (await query.orderBy("created_at", "desc").limit(Number(input.limit ?? 50))).map(linkOut);
  }

  private async deleteLink(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.db("links").where({ id }).first();
    if (!current) {
      throw new AppError("LINK_NOT_FOUND", `Link ${id} does not exist.`, { id });
    }
    await this.db("links").where({ id }).del();
    const event = await this.recordEventForProject(stringOrNull(current.project_id), {
      type: "link.deleted",
      title: `Link deleted: ${String(current.from_id)} ${String(current.relation)} ${String(current.to_id)}`,
      body: stringOrNull(input.reason),
      related_id: id
    }, context);
    return {
      deletedLink: linkOut(current),
      event
    };
  }

  private async linksPage(input: Row, context?: NormalizedGatewayRequestContext) {
    const base = this.db("links");
    if (input.id) {
      const direction = input.direction ?? "both";
      if (direction === "from") {
        base.where("from_id", String(input.id));
      } else if (direction === "to") {
        base.where("to_id", String(input.id));
      } else {
        base.where((builder) => builder.where("from_id", String(input.id)).orWhere("to_id", String(input.id)));
      }
    } else {
      const commonOnly = input.common === true || input.project === null;
      const includeCommon = commonOnly ? true : input.includeCommon !== false;
      const project = commonOnly
        ? null
        : input.project
          ? await this.resolveProject(input.project, context)
          : await this.tryCurrentProject(context);
      if (!project && !includeCommon) {
        throw new AppError("CURRENT_PROJECT_NOT_SET", "Link list requires an id, a project, or includeCommon=true.");
      }

      base.andWhere((builder) => {
        if (project) {
          builder.orWhere("project_id", project.id);
        }
        if (includeCommon) {
          builder.orWhereNull("project_id");
        }
      });
    }

    if (input.relation) {
      base.andWhere("relation", String(input.relation));
    }

    return this.pageRows(
      base,
      input,
      (query) =>
        query
          .select("*")
          .orderByRaw("case when project_id is null then 1 else 0 end asc")
          .orderBy("created_at", "desc"),
      linkOut
    );
  }

  private async projectGraph(input: Row, context?: NormalizedGatewayRequestContext) {
    const projectId = typeof input.projectId === "string" ? input.projectId.trim() : "";
    if (!projectId) {
      throw new AppError("VALIDATION_ERROR", "projectGraph requires projectId.", { input });
    }

    const project = await this.resolveProject(projectId, context);
    const depth = boundedInteger(input.depth, 2, 1, 5);
    // Events are operational bookkeeping (created/updated/status-changed), not
    // curated knowledge edges — I-MEMORY-022 measured them at ~80% of graph
    // nodes on real data, drowning out the handful of real semantic links
    // (supersedes, blocks, etc.). They belong on a timeline, not this graph.
    const maxPerType = boundedInteger(input.maxPerType, 60, 5, 500);
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, GraphEdge>();

    const addNode = (node: GraphNode) => {
      nodes.set(node.id, node);
    };
    const addEdge = (edge: GraphEdge) => {
      if (!edge.from || !edge.to || !edge.relation) {
        return;
      }
      edges.set(`${edge.from}\0${edge.to}\0${edge.relation}`, edge);
    };

    addNode(graphNodeOut("PROJECT", project));

    const [items, tasks, decisions, artifacts] = await Promise.all([
      this.db("items")
        .select("id", "title", "status", "type", "project_id", "created_at")
        .where({ project_id: project.id })
        .orderBy("updated_at", "desc")
        .limit(maxPerType),
      this.db("tasks")
        .select("id", "title", "status", "project_id", "depends_on", "created_at")
        .where({ project_id: project.id })
        .orderBy("updated_at", "desc")
        .limit(maxPerType),
      this.db("decisions")
        .select("id", "title", "status", "project_id", "supersedes_id", "created_at")
        .where({ project_id: project.id })
        .orderBy("updated_at", "desc")
        .limit(maxPerType),
      this.db("artifacts")
        .select("id", "title", "status", "project_id", "path", "created_at")
        .where({ project_id: project.id })
        .orderBy("updated_at", "desc")
        .limit(maxPerType)
    ]);

    for (const row of items) {
      addNode(graphNodeOut("MEMORY", row));
    }
    for (const row of tasks) {
      addNode(graphNodeOut("TASK", row));
      for (const dependencyId of stringArray(row.depends_on)) {
        addEdge({ from: dependencyId, to: String(row.id), relation: "blocks" });
      }
    }
    for (const row of decisions) {
      addNode(graphNodeOut("DECISION", row));
      const supersedesId = stringOrNull(row.supersedes_id);
      if (supersedesId) {
        addEdge({ from: String(row.id), to: supersedesId, relation: "supersedes" });
      }
    }
    for (const row of artifacts) {
      addNode(graphNodeOut("ARTIFACT", row));
    }

    for (let level = 1; level <= depth; level += 1) {
      const linkRows = await this.projectGraphLinkRows(project.id, Array.from(nodes.keys()));
      for (const link of linkRows) {
        addEdge({
          from: String(link.from_id),
          to: String(link.to_id),
          relation: String(link.relation)
        });
      }

      const missingEndpointIds = this.missingGraphEndpointIds(edges, nodes);
      if (level >= depth || missingEndpointIds.length === 0) {
        break;
      }

      const expandedNodes = await this.graphNodesByIds(missingEndpointIds);
      if (expandedNodes.length === 0) {
        break;
      }
      for (const node of expandedNodes) {
        addNode(node);
      }
    }

    return {
      nodes: Array.from(nodes.values()).sort((left, right) => graphNodeSortKey(left).localeCompare(graphNodeSortKey(right))),
      edges: Array.from(edges.values())
        .filter((edge) => nodes.has(edge.from) && nodes.has(edge.to))
        .sort((left, right) => graphEdgeSortKey(left).localeCompare(graphEdgeSortKey(right)))
    };
  }

  private async projectGraphLinkRows(projectId: string, ids: string[]): Promise<Row[]> {
    return await this.db("links")
      .select("id", "project_id", "from_id", "to_id", "relation")
      .where((builder) => {
        builder.where("project_id", projectId);
        if (ids.length > 0) {
          builder.orWhereIn("from_id", ids).orWhereIn("to_id", ids);
        }
      })
      .orderBy("created_at", "desc");
  }

  private missingGraphEndpointIds(edges: Map<string, GraphEdge>, nodes: Map<string, GraphNode>): string[] {
    const ids = new Set<string>();
    for (const edge of edges.values()) {
      if (!nodes.has(edge.from)) {
        ids.add(edge.from);
      }
      if (!nodes.has(edge.to)) {
        ids.add(edge.to);
      }
    }
    return Array.from(ids).sort();
  }

  private async graphNodesByIds(ids: string[]): Promise<GraphNode[]> {
    const uniqueIds = Array.from(new Set(ids.filter((id) => id.length > 0)));
    if (uniqueIds.length === 0) {
      return [];
    }

    // Events are deliberately excluded here too — see the comment in
    // projectGraph. Without this, a link that happened to reference an event
    // id could reintroduce event nodes through BFS expansion.
    const [projects, items, tasks, decisions, artifacts] = await Promise.all([
      this.db("projects").select("id", "slug", "title", "status", "created_at").whereIn("id", uniqueIds),
      this.db("items").select("id", "title", "status", "type", "project_id", "created_at").whereIn("id", uniqueIds),
      this.db("tasks").select("id", "title", "status", "project_id", "created_at").whereIn("id", uniqueIds),
      this.db("decisions").select("id", "title", "status", "project_id", "created_at").whereIn("id", uniqueIds),
      this.db("artifacts").select("id", "title", "status", "project_id", "path", "created_at").whereIn("id", uniqueIds)
    ]);

    return [
      ...projects.map((row) => graphNodeOut("PROJECT", row)),
      ...items.map((row) => graphNodeOut("MEMORY", row)),
      ...tasks.map((row) => graphNodeOut("TASK", row)),
      ...decisions.map((row) => graphNodeOut("DECISION", row)),
      ...artifacts.map((row) => graphNodeOut("ARTIFACT", row))
    ];
  }

  private async preflight(input: Row, context?: NormalizedGatewayRequestContext) {
    const task = await this.getTask(String(input.taskId));
    const project = await this.getProject({ id: task.projectId }, context);
    const query = [task.title, task.scope, task.acceptance].filter(Boolean).join(" ") || "task";
    const faultQuery = String(task.title || query);
    const limits = (input.limits ?? {}) as Row;
    const failedAttempts = await this.searchMemory({
      query: faultQuery,
      project: project.id,
      includeCommon: input.includeCommon !== false,
      type: "failed_attempt",
      status: "active",
      limit: limits.failedAttempts ?? 5
    });
    return {
      project,
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        scope: task.scope,
        acceptance: task.acceptance,
        allowedFiles: task.allowedFiles,
        forbiddenFiles: task.forbiddenFiles,
        dependsOn: task.dependsOn
      },
      relevantDecisions: await this.listDecisions({
        project: project.id,
        includeCommon: input.includeCommon !== false,
        status: "active",
        limit: limits.decisions ?? 10
      }),
      commonRules: await this.searchMemory({
        query: "preflight task scope acceptance diffs failed attempts",
        project: project.id,
        includeCommon: true,
        status: "active",
        limit: limits.items ?? 10
      }),
      relatedItems: await this.searchMemory({
        query,
        project: project.id,
        includeCommon: input.includeCommon !== false,
        status: "active",
        limit: limits.items ?? 10
      }),
      failedAttempts,
      knownFaults: failedAttempts,
      recentEvents: await this.listEvents({
        project: project.id,
        limit: limits.events ?? 10
      }),
      summary:
        "Use this shared gateway context before editing files. Treat knownFaults as stop-signals before repeating an approach."
    };
  }

  private async preflightByQuery(input: Row, context?: NormalizedGatewayRequestContext) {
    const includeCommon = input.includeCommon !== false;
    const project = input.project ? await this.resolveProject(input.project, context) : await this.tryCurrentProject(context);
    if (!project && !includeCommon) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "preflight.by_query requires a project or includeCommon=true.");
    }
    const query = String(input.query);
    const limits = (input.limits ?? {}) as Row;
    const failedAttempts = await this.searchMemory({
      query,
      project: project?.id,
      includeCommon,
      type: "failed_attempt",
      status: "active",
      limit: limits.failedAttempts ?? 5
    });

    return {
      project: project ?? null,
      query,
      relevantDecisions: await this.listDecisions({
        project: project?.id,
        includeCommon,
        status: "active",
        limit: limits.decisions ?? 10
      }),
      commonRules: await this.searchMemory({
        query: "preflight task scope acceptance diffs failed attempts",
        project: project?.id,
        includeCommon: true,
        status: "active",
        limit: limits.items ?? 10
      }),
      relatedItems: await this.searchMemory({
        query,
        project: project?.id,
        includeCommon,
        status: "active",
        limit: limits.items ?? 10
      }),
      failedAttempts,
      knownFaults: failedAttempts,
      artifacts: await this.searchArtifacts({
        query,
        project: project?.id,
        includeCommon,
        limit: limits.artifacts ?? 5
      }),
      recentEvents: project
        ? await this.listEvents({ project: project.id, limit: limits.events ?? 10 })
        : await this.listEvents({ project: null, limit: limits.events ?? 10 }),
      summary:
        "Use this shared query context before creating a task or editing files. Treat knownFaults as stop-signals before repeating an approach.",
      efficiencyHints: compactContextEfficiencyHints("preflight.by_query")
    };
  }

  private async contextPack(input: Row, context: NormalizedGatewayRequestContext) {
    const mode = typeof input.mode === "string" ? input.mode : "normal";
    const profile = typeof input.profile === "string" ? input.profile : "general";
    const tokenBudget = Number(input.tokenBudget ?? defaultTokenBudget(mode, profile));
    const limits = contextPackLimits(mode, (input.limits ?? {}) as Row);
    const includeCommon = input.includeCommon !== false;

    const source = input.taskId
      ? await this.preflight({ taskId: input.taskId, includeCommon, limits })
      : await this.preflightByQuery(
          {
            query: input.query,
            project: input.project,
            includeCommon,
            limits
          },
          context
        );

    const project = (source.project ?? null) as ReturnType<typeof projectOut> | null;
    const task = "task" in source ? (source.task as Row) : null;
    const query = task
      ? [task.title, task.scope, task.acceptance].filter(Boolean).join(" ")
      : String((source as Row).query ?? input.query ?? "");
    const projectId = project?.id ?? null;
    const artifacts =
      "artifacts" in source
        ? ((source as Row).artifacts as Row[])
        : await this.searchArtifacts({
            query,
            project: projectId ?? undefined,
            includeCommon,
            limit: limits.artifacts
          });
    const handoffs = await this.listRecentItemsByType("handoff", projectId, includeCommon, limits.handoffs);

    const pack: Row = {
      summary:
        "Compact start-of-work context. Read mustRead stop-signals first; use nextCalls to fetch full records or artifact previews only when needed.",
      budget: {
        mode,
        profile,
        tokenBudget,
        strategy: "compact-cards",
        fullBodiesIncluded: false,
        base64Included: false,
        limits
      },
      project: project ? compactProject(project) : null,
      task: task ? compactTask(task) : null,
      query,
      mustRead: mustReadPointers((source.knownFaults ?? []) as Row[]),
      handoffs: handoffs.map(compactMemoryRecord),
      decisions: ((source.relevantDecisions ?? []) as Row[]).map(compactDecisionRecord),
      knownFaults: ((source.knownFaults ?? []) as Row[]).map(compactSearchRecord),
      memory: ((source.relatedItems ?? []) as Row[]).map(compactSearchRecord),
      artifacts: (artifacts ?? []).map(compactArtifactRecord),
      recentEvents: ((source.recentEvents ?? []) as Row[]).map(compactEventRecord),
      nextCalls: contextPackNextCalls({
        decisions: (source.relevantDecisions ?? []) as Row[],
        faults: (source.knownFaults ?? []) as Row[],
        artifacts: artifacts ?? [],
        task
      })
    };

    return {
      ...pack,
      budget: {
        ...(pack.budget as Row),
        estimatedChars: JSON.stringify(pack).length
      },
      efficiencyHints: compactContextEfficiencyHints("context.pack", JSON.stringify(pack).length)
    };
  }

  private async contextChangedSince(input: Row, context: NormalizedGatewayRequestContext) {
    const since = parseSinceCursor(input.since);
    const nextCursor = nowIso();
    const commonOnly = input.project === null;
    const project = commonOnly
      ? null
      : input.project
        ? await this.resolveProject(input.project, context)
        : await this.currentProject(context);
    const includeCommon = commonOnly ? true : input.includeCommon !== false;
    const limit = Number(input.limit ?? 20);

    const [tasks, memory, handoffs, decisions, artifacts, events] = await Promise.all([
      project ? this.listChangedTasks(project.id, since, limit) : Promise.resolve([]),
      this.listChangedItems(project?.id ?? null, includeCommon, since, limit),
      this.listChangedItems(project?.id ?? null, includeCommon, since, limit, "handoff"),
      this.listChangedDecisions(project?.id ?? null, includeCommon, since, limit),
      this.listChangedArtifacts(project?.id ?? null, includeCommon, since, limit),
      this.listChangedEvents(project?.id ?? null, includeCommon, since, limit)
    ]);

    const changes = {
      tasks: tasks.map(compactTask),
      memory: memory.map(compactMemoryRecord),
      handoffs: handoffs.map(compactMemoryRecord),
      decisions: decisions.map(compactDecisionRecord),
      artifacts: artifacts.map(compactArtifactRecord),
      events: events.map(compactEventRecord)
    };

    return {
      summary:
        "Compact incremental context refresh. Store nextCursor and pass it as since on the next refresh.",
      since,
      nextCursor,
      project: project ? compactProject(project) : null,
      includeCommon,
      counts: {
        tasks: changes.tasks.length,
        memory: changes.memory.length,
        handoffs: changes.handoffs.length,
        decisions: changes.decisions.length,
        artifacts: changes.artifacts.length,
        events: changes.events.length
      },
      changes,
      nextCalls: changedSinceNextCalls({ project, memory, handoffs, decisions, artifacts }),
      efficiencyHints: compactContextEfficiencyHints("context.changed_since")
    };
  }

  private async listChangedTasks(projectId: string, since: string, limit: number): Promise<Row[]> {
    const rows = await this.db("tasks")
      .select("*")
      .where("project_id", projectId)
      .andWhere("updated_at", ">", since)
      .orderBy("updated_at", "desc")
      .limit(limit);
    return rows.map(taskOut);
  }

  private async listChangedItems(projectId: string | null, includeCommon: boolean, since: string, limit: number, type?: string) {
    let query = this.db("items").select("*").andWhere("updated_at", ">", since);
    query = query.andWhere((builder) => {
      if (projectId) {
        builder.orWhere("project_id", projectId);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });
    if (type) {
      query = query.andWhere("type", type);
    } else {
      query = query.andWhereNot("type", "handoff");
    }
    const rows = await query.orderBy("updated_at", "desc").limit(limit);
    return rows.map(itemOut);
  }

  private async listChangedDecisions(projectId: string | null, includeCommon: boolean, since: string, limit: number) {
    let query = this.db("decisions").select("*").andWhere("updated_at", ">", since);
    query = query.andWhere((builder) => {
      if (projectId) {
        builder.orWhere("project_id", projectId);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });
    const rows = await query.orderBy("updated_at", "desc").limit(limit);
    return rows.map(decisionOut);
  }

  private async listChangedArtifacts(projectId: string | null, includeCommon: boolean, since: string, limit: number) {
    let query = this.db("artifacts").select("*").andWhere("updated_at", ">", since);
    query = query.andWhere((builder) => {
      if (projectId) {
        builder.orWhere("project_id", projectId);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });
    const rows = await query.orderBy("updated_at", "desc").limit(limit);
    return rows.map(artifactOut);
  }

  private async listChangedEvents(projectId: string | null, includeCommon: boolean, since: string, limit: number) {
    let query = this.db("events").select("*").andWhere("created_at", ">", since);
    query = query.andWhere((builder) => {
      if (projectId) {
        builder.orWhere("project_id", projectId);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });
    const rows = await query.orderBy("created_at", "desc").limit(limit);
    return rows.map(eventOut);
  }

  private async listRecentItemsByType(
    type: string,
    projectId: string | null,
    includeCommon: boolean,
    limit: number
  ): Promise<Row[]> {
    let query = this.db("items").select("*").where({ type, status: "active" });
    query = query.andWhere((builder) => {
      if (projectId) {
        builder.orWhere("project_id", projectId);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });
    return (await query.orderBy("updated_at", "desc").limit(limit)).map(itemOut);
  }

  private async createHandoff(input: Row, context: NormalizedGatewayRequestContext) {
    const tags = Array.from(new Set(["handoff", ...stringArray(input.tags)]));
    const item = await this.createMemory(
      {
        project: input.project,
        type: "handoff",
        title: input.title,
        body: handoffBody(input),
        status: "active",
        tags
      },
      context
    );
    const event = await this.recordEventForProject(item.projectId, {
      type: "handoff.created",
      title: `Handoff created: ${item.title}`,
      body: item.body,
      related_id: item.id
    }, context);
    const link = input.taskId
      ? await this.createHandoffTaskLink(item.id, String(input.taskId), item.projectId, context)
      : null;

    return {
      handoff: item,
      event,
      link
    };
  }

  private async latestHandoffs(input: Row, context: NormalizedGatewayRequestContext) {
    const commonOnly = input.project === null;
    const project = commonOnly
      ? null
      : input.project
        ? await this.resolveProject(input.project, context)
        : await this.tryCurrentProject(context);
    const includeCommon = commonOnly ? true : input.includeCommon !== false;
    if (!project && !includeCommon) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "handoff.latest requires a project or includeCommon=true.");
    }
    const rows = await this.listRecentItemsByType("handoff", project?.id ?? null, includeCommon, Number(input.limit ?? 3));
    return rows.map((row) => handoffOut(row, input.includeContent === true));
  }

  private async searchHandoffs(input: Row, context: NormalizedGatewayRequestContext) {
    const rows = await this.searchMemory(
      {
        query: input.query,
        project: input.project,
        includeCommon: input.includeCommon !== false,
        type: "handoff",
        status: "active",
        limit: input.limit ?? 10
      },
      context
    );
    if (input.includeContent === true) {
      const fullRows = await Promise.all(rows.map((row) => this.getMemory(String(row.id))));
      return fullRows.map((row) => handoffOut(row as Row, true));
    }
    return rows.map((row) => handoffOut(row as Row, false));
  }

  private async createHandoffTaskLink(
    fromId: string,
    toId: string,
    projectId: string | null,
    context: NormalizedGatewayRequestContext
  ) {
    await this.assertRecordExists(toId);
    const row = {
      id: await this.nextId("links", projectId ? `L-${projectKeyFromId(projectId)}` : "L-COMMON"),
      project_id: projectId,
      from_id: fromId,
      to_id: toId,
      relation: "relates_to",
      created_by: context.clientId,
      source_instance_id: context.clientId,
      created_at: nowIso()
    };
    await this.db("links").insert(row);
    await this.recordEventForProject(projectId, {
      type: "link.created",
      title: `Link created: ${fromId} relates_to ${toId}`,
      related_id: row.id
    }, context);
    return linkOut(row);
  }

  private async recordEventForProject(
    projectId: string | null,
    input: Row,
    context: NormalizedGatewayRequestContext
  ) {
    const row = {
      id: await this.nextId("events", `E-${projectId ? projectKeyFromId(projectId) : "COMMON"}`),
      project_id: projectId,
      type: input.type,
      title: input.title ?? null,
      body: input.body ?? null,
      related_id: input.related_id ?? null,
      created_by: context.clientId,
      source_instance_id: context.clientId,
      created_at: nowIso()
    };
    await this.db("events").insert(row);
    const out = eventOut(row);
    // T-MEMORY-042: this is the single choke point every mutation across
    // every domain already passes through -- publishing here, once, covers
    // PMemUI's live-update feed for the whole gateway with no other call
    // site needing to change. EventEmitter.emit() (which publish() wraps)
    // runs subscriber callbacks synchronously and rethrows synchronously if
    // one throws -- guarded here because a live-update side effect must
    // never fail the mutation it's attached to.
    try {
      void gatewayEvents.publish(GATEWAY_EVENT_TOPIC, { event: String(row.type), payload: out });
    } catch {
      // Best-effort notification; the event row itself is already committed.
    }
    return out;
  }

  // T-MEMORY-029 / D-MEMORY-007: migrate the shared static MCP_TOKEN into a
  // real admin-scoped credential row, owned by whichever admin was created
  // first (the bootstrap/instance owner), if any admin exists yet. Called
  // once at gateway startup (see src/gateway.ts) whenever MCP_TOKEN is
  // configured -- idempotent and safe on every restart, same
  // insert-then-merge-on-conflict shape as touchClient() above, except it
  // deliberately does NOT touch last_seen_at: that field stays driven only
  // by real request traffic (touchClient's own merge never includes
  // scope/owner_user_id, so the two upserts never fight over the same
  // columns).
  async ensureStaticTokenCredential(): Promise<void> {
    const now = nowIso();
    const owner = await this.db("users").select("id").where({ role: "admin" }).orderBy("created_at", "asc").first();
    await this.db("gateway_clients")
      .insert({
        id: staticTokenClientId,
        label: "static-token",
        scope: "admin",
        owner_user_id: owner?.id ?? null,
        metadata: JSON.stringify({ kind: "static-token", migrated: true }),
        created_at: now,
        updated_at: now
      })
      .onConflict("id")
      .merge({
        scope: "admin",
        owner_user_id: owner?.id ?? null,
        updated_at: now
      });
  }

  private async touchClient(
    context: NormalizedGatewayRequestContext,
    options: { cleanupAnonymous?: boolean } = {}
  ): Promise<void> {
    const now = nowIso();
    if (options.cleanupAnonymous !== false) {
      await this.cleanupExpiredAnonymousClients();
    }
    await this.db("gateway_clients")
      .insert({
        id: context.clientId,
        label: context.clientLabel,
        last_seen_at: now,
        metadata: JSON.stringify(context.metadata),
        created_at: now,
        updated_at: now
      })
      .onConflict("id")
      .merge({
        label: context.clientLabel,
        last_seen_at: now,
        metadata: JSON.stringify(context.metadata),
        updated_at: now
      });
  }

  private async cleanupExpiredAnonymousClients(): Promise<void> {
    const ttlSeconds = anonymousClientTtlSeconds();
    if (ttlSeconds <= 0) {
      return;
    }

    const rows = await this.db("gateway_clients")
      .select("id")
      .where("id", "like", `${anonymousClientPrefix}%`)
      .andWhere("last_seen_at", "<", cutoffFromSeconds(ttlSeconds));
    const clientIds = rows.map((row) => String(row.id));
    if (clientIds.length === 0) {
      return;
    }

    await this.db.transaction(async (trx) => {
      await trx("kv").whereIn("key", clientIds.map(currentProjectKey)).del();
      await trx("gateway_clients").whereIn("id", clientIds).del();
    });
  }

  private async countRows(table: string): Promise<number> {
    const [row] = await this.db(table).count<{ count: string | number }[]>({ count: "*" });
    return Number(row?.count ?? 0);
  }

  private async safeCountRows(table: string): Promise<number | null> {
    try {
      return await this.countRows(table);
    } catch {
      return null;
    }
  }

  private async artifactBackupStats(): Promise<{ count: number; totalBytes: number }> {
    const row = await this.db("artifacts")
      .select(
        this.db.raw("count(*)::int as count"),
        this.db.raw("coalesce(sum(size_bytes), 0)::bigint as total_bytes")
      )
      .first();
    return {
      count: Number(row?.count ?? 0),
      totalBytes: Number(row?.total_bytes ?? 0)
    };
  }

  private async uniqueProjectId(baseId: string): Promise<string> {
    if (!(await this.exists("projects", baseId))) {
      return baseId;
    }
    for (let index = 2; index < 1000; index += 1) {
      const id = `${baseId}-${index}`;
      if (!(await this.exists("projects", id))) {
        return id;
      }
    }
    throw new AppError("VALIDATION_ERROR", "Could not create a unique project id.");
  }

  private async nextId(table: string, prefix: string): Promise<string> {
    const rows = await this.db(table).select("id").where("id", "like", `${prefix}-%`);
    const next =
      rows.reduce((max, row) => {
        const match = String(row.id).match(/-(\d+)$/);
        return match ? Math.max(max, Number(match[1])) : max;
      }, 0) + 1;
    return `${prefix}-${String(next).padStart(3, "0")}`;
  }

  private async exists(table: string, id: string): Promise<boolean> {
    const row = await this.db(table).select("id").where({ id }).first();
    return Boolean(row);
  }

  private async assertRecordExists(id: string): Promise<void> {
    for (const table of ["projects", "items", "tasks", "decisions", "events", "links", "artifacts"]) {
      if (await this.exists(table, id)) {
        return;
      }
    }
    throw new AppError("LINK_NOT_FOUND", `Linked record ${id} does not exist.`, { id });
  }

  private async setKv(key: string, value: string): Promise<void> {
    await this.db("kv")
      .insert({ key, value, updated_at: nowIso() })
      .onConflict("key")
      .merge({ value, updated_at: nowIso() });
  }

  private async getKv(key: string): Promise<string | null> {
    const row = await this.db("kv").select("value").where({ key }).first();
    return row?.value ?? null;
  }

  private async tryCurrentProject(context?: NormalizedGatewayRequestContext) {
    try {
      return await this.currentProject(context);
    } catch (error) {
      if (error instanceof AppError && error.code === "CURRENT_PROJECT_NOT_SET") {
        return null;
      }
      throw error;
    }
  }
}

function artifactOut(row: Row) {
  return {
    id: String(row.id),
    projectId: stringOrNull(row.project_id),
    scope: row.project_id ? "project" : "common",
    path: String(row.path),
    title: String(row.title),
    description: stringOrNull(row.description),
    status: typeof row.status === "string" ? row.status : "active",
    contentType: String(row.content_type),
    sizeBytes: Number(row.size_bytes ?? 0),
    sha256: String(row.sha256),
    tags: stringArray(row.tags),
    downloadPath: `/artifacts/${encodeURIComponent(String(row.id))}/download`,
    archivedAt: dateStringOrNull(row.archived_at),
    archivedBy: stringOrNull(row.archived_by),
    archiveReason: stringOrNull(row.archive_reason),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function paginationInput(value: unknown): { limit: number; offset: number } {
  const input = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {};
  const limit = boundedInteger(input.limit, 50, 1, 200);
  const offset = boundedInteger(input.offset, 0, 0, 1_000_000);
  return { limit, offset };
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function artifactSearchOut(row: Row) {
  return {
    ...artifactOut(row),
    rank: Number(row.rank ?? 0)
  };
}

function compactProject(project: Row) {
  return {
    id: String(project.id),
    slug: String(project.slug),
    title: String(project.title),
    status: String(project.status),
    description: shortText(stringOrNull(project.description), 240)
  };
}

function compactTask(task: Row) {
  return {
    id: String(task.id),
    title: String(task.title),
    status: String(task.status),
    scope: shortText(stringOrNull(task.scope), 360),
    acceptance: shortText(stringOrNull(task.acceptance), 360),
    allowedFiles: stringArray(task.allowedFiles),
    forbiddenFiles: stringArray(task.forbiddenFiles),
    dependsOn: stringArray(task.dependsOn)
  };
}

function compactSearchRecord(record: Row) {
  return {
    id: String(record.id),
    scope: String(record.scope ?? (record.projectId ? "project" : "common")),
    type: String(record.type),
    title: String(record.title),
    status: String(record.status),
    excerpt: shortText(String(record.excerpt ?? record.body ?? ""), 360),
    tags: stringArray(record.tags)
  };
}

function compactMemoryRecord(record: Row) {
  return {
    id: String(record.id),
    projectId: stringOrNull(record.projectId),
    type: String(record.type),
    title: String(record.title),
    status: String(record.status),
    excerpt: shortText(String(record.body ?? ""), 500),
    tags: stringArray(record.tags),
    updatedAt: stringOrNull(record.updatedAt)
  };
}

function hygieneItemOut(record: Row) {
  return {
    id: String(record.id),
    projectId: stringOrNull(record.projectId),
    scope: String(record.scope ?? (record.projectId ? "project" : "common")),
    type: String(record.type),
    title: String(record.title),
    status: String(record.status),
    bodyChars: Number(record.bodyChars ?? 0),
    tags: stringArray(record.tags),
    updatedAt: stringOrNull(record.updatedAt)
  };
}

function memoryDuplicateGroups(rows: Row[], limit: number) {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = [row.projectId ?? "common", row.type, String(row.title).trim().toLowerCase()].join("\u0000");
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return Array.from(groups.values())
    .filter((group) => group.length > 1)
    .sort((left, right) => right.length - left.length)
    .slice(0, limit)
    .map((group) => ({
      scope: String(group[0]?.scope ?? "project"),
      projectId: stringOrNull(group[0]?.projectId),
      type: String(group[0]?.type),
      title: String(group[0]?.title),
      count: group.length,
      ids: group.map((item) => String(item.id)),
      updatedAt: stringOrNull(
        group
          .map((item) => stringOrNull(item.updatedAt))
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1) ?? null
      )
    }));
}

function hygieneNextCalls(records: Row[], duplicateGroups: Row[]) {
  const calls: Array<{ tool: string; input: Row; reason: string }> = [];
  const seen = new Set<string>();
  for (const record of records.slice(0, 5)) {
    const id = String(record.id);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    calls.push({
      tool: "memory.get",
      input: { id },
      reason: "Inspect full record before deciding whether to split, archive, or rewrite it."
    });
  }
  for (const group of duplicateGroups.slice(0, 3)) {
    for (const id of stringArray(group.ids).slice(0, 2)) {
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      calls.push({
        tool: "memory.get",
        input: { id },
        reason: "Compare duplicate title group before consolidating records."
      });
    }
  }
  return calls;
}

function handoffOut(record: Row, includeContent: boolean) {
  return {
    id: String(record.id),
    projectId: stringOrNull(record.projectId),
    title: String(record.title),
    status: String(record.status),
    excerpt: shortText(String(record.body ?? record.excerpt ?? ""), 700),
    tags: stringArray(record.tags),
    updatedAt: stringOrNull(record.updatedAt),
    ...(includeContent ? { body: String(record.body ?? "") } : {})
  };
}

function compactDecisionRecord(record: Row) {
  return {
    id: String(record.id),
    projectId: stringOrNull(record.projectId),
    title: String(record.title),
    status: String(record.status),
    decision: shortText(String(record.decision ?? ""), 360),
    rationale: shortText(stringOrNull(record.rationale), 260),
    consequences: shortText(stringOrNull(record.consequences), 260),
    tags: stringArray(record.tags)
  };
}

function compactArtifactRecord(record: Row) {
  const preferredNextTool = preferredArtifactReadTool(record);
  return {
    id: String(record.id),
    scope: String(record.scope ?? (record.projectId ? "project" : "common")),
    path: String(record.path),
    title: String(record.title),
    description: shortText(stringOrNull(record.description), 220),
    contentType: String(record.contentType),
    sizeBytes: Number(record.sizeBytes ?? 0),
    tags: stringArray(record.tags),
    downloadPath: String(record.downloadPath),
    preferredNextTool
  };
}

function compactArtifactSearchRecord(record: Row) {
  return {
    ...compactArtifactRecord(record),
    rank: Number(record.rank ?? 0)
  };
}

function preferredArtifactReadTool(record: Row) {
  const contentType = String(record.contentType ?? record.content_type ?? "");
  const artifactPath = String(record.path ?? "");
  return isTextArtifact(contentType, artifactPath) ? "artifact.read_text" : "artifact.peek";
}

function compactEventRecord(record: Row) {
  return {
    id: String(record.id),
    type: String(record.type),
    title: shortText(stringOrNull(record.title), 220),
    relatedId: stringOrNull(record.relatedId),
    createdAt: stringOrNull(record.createdAt)
  };
}

function tokenEfficiencyBase(overrides: Row = {}) {
  return {
    rule: "Use PMem as a lazy index first: compact first, select exact records, then read full content only by id/path.",
    severity: "info",
    strategy: "compact-first",
    fullBodiesIncluded: false,
    base64Included: false,
    warnings: [],
    preferredNextTools: ["context.pack", "project.summary", "artifact.search", "artifact.peek"],
    compactAfterThis: false,
    ...overrides
  };
}

function manualEfficiencyHints(input: Row, manuals: Row[]) {
  const includeContent = input.includeContent === true;
  const estimatedChars = JSON.stringify(manuals).length;
  const warnings = includeContent
    ? ["Manual content was included. Compact the chat after reading if you will continue implementation work."]
    : ["Manual content was not included. Request includeContent=true only for the specific manual you need."];
  return tokenEfficiencyBase({
    severity: includeContent || estimatedChars > 12_000 ? "warn" : "info",
    strategy: includeContent ? "manual-full-content" : "manual-metadata-first",
    fullBodiesIncluded: includeContent,
    estimatedChars,
    warnings,
    preferredNextTools: includeContent ? ["context.pack", "preflight.by_query"] : ["gateway.manuals"],
    compactAfterThis: includeContent || estimatedChars > 12_000
  });
}

function artifactWriteEfficiencyHints(tool: "artifact.put" | "artifact.put_text") {
  return tokenEfficiencyBase({
    strategy: tool === "artifact.put_text" ? "text-without-base64" : "exact-bytes-or-binary",
    base64Included: tool === "artifact.put",
    warnings:
      tool === "artifact.put_text"
        ? ["Text was stored without base64. Prefer artifact.read_text for future reads."]
        : ["Base64 upload was used. Prefer artifact.put_text for UTF-8 Markdown/text artifacts."],
    preferredNextTools: ["artifact.peek", "artifact.read_text", "artifact.search"]
  });
}

function artifactGetEfficiencyHints(input: Row, artifact: Row) {
  const base64Included = typeof artifact.contentBase64 === "string";
  const estimatedChars = JSON.stringify(artifact).length;
  const warnings = base64Included
    ? [
        "Inline base64 content was returned. Use artifact.peek or artifact.read_text for Markdown/text unless exact bytes are required.",
        "Compact the chat after consuming base64 content."
      ]
    : ["Only artifact metadata was returned. Use artifact.peek or artifact.read_text before requesting includeContent=true."];
  return tokenEfficiencyBase({
    severity: base64Included || input.includeContent === true ? "warn" : "info",
    strategy: base64Included ? "base64-inline-content" : "metadata-only",
    fullBodiesIncluded: base64Included,
    base64Included,
    estimatedChars,
    warnings,
    preferredNextTools: ["artifact.peek", "artifact.read_text"],
    compactAfterThis: base64Included || estimatedChars > 12_000
  });
}

function artifactPeekEfficiencyHints(artifact: Row) {
  const estimatedChars = JSON.stringify(artifact).length;
  const preview = (artifact.preview ?? {}) as Row;
  const truncated = preview.truncated === true;
  return tokenEfficiencyBase({
    strategy: "bounded-preview-no-base64",
    estimatedChars,
    warnings: truncated
      ? ["Preview was truncated. Read full text only if this selected artifact is necessary for the task."]
      : ["Preview stayed within bounded defaults. Prefer this before artifact.read_text."],
    preferredNextTools: truncated ? ["artifact.read_text", "context.pack"] : ["artifact.search", "context.pack"],
    compactAfterThis: estimatedChars > 12_000
  });
}

function artifactReadTextEfficiencyHints(artifact: Row) {
  const estimatedChars = JSON.stringify(artifact).length;
  const textInfo = (artifact.textInfo ?? {}) as Row;
  const truncated = textInfo.truncated === true;
  const readBytes = Number(textInfo.readBytes ?? 0);
  const warnings = [
    "Full text was read without base64. Keep only task-relevant excerpts in working context.",
    ...(truncated ? ["Text was truncated. Increase maxChars/maxLines only after confirming this file is required."] : []),
    ...(estimatedChars > 12_000 || readBytes > 24_000 ? ["Large text read detected. Compact the chat before implementation."] : [])
  ];
  return tokenEfficiencyBase({
    severity: estimatedChars > 12_000 || readBytes > 24_000 ? "warn" : "info",
    strategy: "bounded-text-no-base64",
    fullBodiesIncluded: true,
    base64Included: false,
    estimatedChars,
    warnings,
    preferredNextTools: ["context.pack", "handoff.create"],
    compactAfterThis: estimatedChars > 12_000 || readBytes > 24_000
  });
}

function compactContextEfficiencyHints(tool: string, estimatedChars?: number) {
  return tokenEfficiencyBase({
    strategy: "compact-cards-and-next-calls",
    estimatedChars,
    warnings: [
      "This response intentionally omits full bodies and base64 content.",
      "Follow nextCalls only for records or artifacts that are necessary for the current task."
    ],
    preferredNextTools: ["memory.get", "artifact.peek", "artifact.read_text", "preflight"],
    sourceTool: tool
  });
}

function mustReadPointers(faults: Row[]) {
  return faults.slice(0, 5).map((fault) => ({
    kind: "failed_attempt",
    id: String(fault.id),
    title: String(fault.title),
    tool: "memory.get",
    reason: "Known fault matched this task/query. Read before repeating related approaches."
  }));
}

function contextPackNextCalls(input: { decisions: Row[]; faults: Row[]; artifacts: Row[]; task: Row | null }) {
  const calls: Array<{ tool: string; input: Row; reason: string }> = [];
  for (const fault of input.faults.slice(0, 3)) {
    calls.push({
      tool: "memory.get",
      input: { id: String(fault.id) },
      reason: "Read full failed-attempt details before proceeding."
    });
  }
  for (const artifact of input.artifacts.slice(0, 5)) {
    const tool = preferredArtifactReadTool(artifact);
    calls.push({
      tool,
      input: { id: String(artifact.id) },
      reason:
        tool === "artifact.read_text"
          ? "Read bounded text from shared artifact without loading base64 content."
          : "Preview shared artifact before requesting full base64 content or downloading."
    });
  }
  for (const decision of input.decisions.slice(0, 3)) {
    calls.push({
      tool: "decision.get",
      input: { id: String(decision.id) },
      reason: "Read full decision only if the compact decision card affects the implementation."
    });
  }
  if (input.task?.id) {
    calls.push({
      tool: "preflight",
      input: { taskId: String(input.task.id) },
      reason: "Use full preflight when allowed/forbidden scope or complete context is needed."
    });
  }
  return calls;
}

function changedSinceNextCalls(input: {
  project: Row | null;
  memory: Row[];
  handoffs: Row[];
  decisions: Row[];
  artifacts: Row[];
}) {
  const calls: Array<{ tool: string; input: Row; reason: string }> = [];
  if (input.project) {
    calls.push({
      tool: "project.summary",
      input: { project: String(input.project.id) },
      reason: "Reload compact project state if the incremental changes are not enough."
    });
  }
  for (const item of [...input.memory, ...input.handoffs].slice(0, 3)) {
    calls.push({
      tool: "memory.get",
      input: { id: String(item.id) },
      reason: "Read full memory body only when the compact changed card is insufficient."
    });
  }
  for (const artifact of input.artifacts.slice(0, 3)) {
    const tool = preferredArtifactReadTool(artifact);
    calls.push({
      tool,
      input: { id: String(artifact.id) },
      reason:
        tool === "artifact.read_text"
          ? "Read bounded text from changed artifact without loading base64 content."
          : "Preview changed artifact before requesting full content."
    });
  }
  for (const decision of input.decisions.slice(0, 2)) {
    calls.push({
      tool: "decision.get",
      input: { id: String(decision.id) },
      reason: "Read full decision when the compact changed card affects current work."
    });
  }
  return calls;
}

function projectSummaryNextCalls(input: {
  project: Row;
  query: string;
  openTasks: Row[];
  knownFaults: Row[];
  artifacts: Row[];
  decisions: Row[];
}) {
  const calls: Array<{ tool: string; input: Row; reason: string }> = [
    {
      tool: "context.pack",
      input: { project: String(input.project.id), query: input.query, mode: "normal" },
      reason: "Load a focused compact context pack before implementation work."
    },
    {
      tool: "handoff.latest",
      input: { project: String(input.project.id), limit: 3 },
      reason: "Check recent continuation points before broad search."
    }
  ];
  for (const task of input.openTasks.slice(0, 2)) {
    calls.push({
      tool: "preflight",
      input: { taskId: String(task.id) },
      reason: "Use full task preflight before editing files for this task."
    });
  }
  for (const fault of input.knownFaults.slice(0, 3)) {
    calls.push({
      tool: "memory.get",
      input: { id: String(fault.id) },
      reason: "Read full failed-attempt details before repeating related work."
    });
  }
  for (const artifact of input.artifacts.slice(0, 3)) {
    const tool = preferredArtifactReadTool(artifact);
    calls.push({
      tool,
      input: { id: String(artifact.id) },
      reason:
        tool === "artifact.read_text"
          ? "Read bounded text from shared artifact without loading base64 content."
          : "Preview shared artifact before requesting full content."
    });
  }
  for (const decision of input.decisions.slice(0, 2)) {
    calls.push({
      tool: "decision.get",
      input: { id: String(decision.id) },
      reason: "Read full decision if the compact card affects the task."
    });
  }
  return calls;
}

function projectSummaryLimits(overrides: Row) {
  return {
    tasks: Number(overrides.tasks ?? 8),
    decisions: Number(overrides.decisions ?? 5),
    faults: Number(overrides.faults ?? 5),
    handoffs: Number(overrides.handoffs ?? 3),
    artifacts: Number(overrides.artifacts ?? 5),
    memory: Number(overrides.memory ?? 6),
    events: Number(overrides.events ?? 5)
  };
}

function contextPackLimits(mode: string, overrides: Row) {
  const defaults =
    mode === "brief"
      ? { decisions: 3, items: 4, failedAttempts: 3, artifacts: 3, events: 3, handoffs: 1 }
      : mode === "deep"
        ? { decisions: 10, items: 12, failedAttempts: 8, artifacts: 10, events: 10, handoffs: 3 }
        : { decisions: 5, items: 6, failedAttempts: 5, artifacts: 5, events: 5, handoffs: 2 };
  return {
    decisions: Number(overrides.decisions ?? defaults.decisions),
    items: Number(overrides.items ?? defaults.items),
    failedAttempts: Number(overrides.failedAttempts ?? defaults.failedAttempts),
    artifacts: Number(overrides.artifacts ?? defaults.artifacts),
    events: Number(overrides.events ?? defaults.events),
    handoffs: Number(overrides.handoffs ?? defaults.handoffs)
  };
}

function defaultTokenBudget(mode: string, profile = "general"): number {
  if (profile === "chatgpt") {
    return mode === "deep" ? 3000 : mode === "normal" ? 2000 : 1500;
  }
  return mode === "brief" ? 1500 : mode === "deep" ? 6000 : 3000;
}

function parseSinceCursor(value: unknown): string {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new AppError("VALIDATION_ERROR", "since must be an ISO timestamp or Date-compatible cursor.");
  }
  return date.toISOString();
}

function shortText(value: string | null, maxLength: number): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
}

function projectOut(row: Row) {
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    description: stringOrNull(row.description),
    status: String(row.status),
    rootPath: stringOrNull(row.root_path),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function connectionSnippets() {
  const baseUrl = "https://<gateway-host>/api";
  const mcpUrl = `${baseUrl}/mcp?client_id=\${PMEM_CLIENT_ID}&client_label=\${PMEM_CLIENT_LABEL}&client_kind=<client-kind>`;
  return [
    {
      client: "codex",
      transport: "streamable-http",
      config: {
        serverName: "project-memory",
        url: mcpUrl,
        headers: {
          Authorization: "Bearer ${PMEM_MCP_TOKEN}"
        }
      },
      notes: [
        "Set PMEM_CLIENT_ID to a stable developer/agent id such as USER@HOSTNAME.",
        "Set PMEM_CLIENT_LABEL to a readable label.",
        "Set PMEM_MCP_TOKEN to the gateway bearer token."
      ]
    },
    {
      client: "claude",
      transport: "streamable-http",
      cli: "claude mcp add --transport http project-memory \"https://<gateway-host>/api/mcp?client_id=${PMEM_CLIENT_ID}&client_label=${PMEM_CLIENT_LABEL}&client_kind=claude-code\" --header \"Authorization: Bearer ${PMEM_MCP_TOKEN}\""
    },
    {
      client: "codewhale",
      transport: "streamable-http",
      configPath: ".deepseek/mcp.json",
      config: {
        mcpServers: {
          "project-memory": {
            url: "https://<gateway-host>/api/mcp?client_id=${PMEM_CLIENT_ID}&client_label=${PMEM_CLIENT_LABEL}&client_kind=codewhale",
            headers: {
              Authorization: "Bearer ${PMEM_MCP_TOKEN}"
            }
          }
        }
      },
      notes: ["Use config file headers when the CodeWhale CLI does not accept --headers."]
    },
    {
      client: "generic-streamable-http",
      transport: "streamable-http",
      url: mcpUrl,
      headers: {
        Authorization: "Bearer ${PMEM_MCP_TOKEN}"
      }
    }
  ];
}

function currentProjectKey(clientId: string): string {
  return `current_project_id:${clientId}`;
}

function anonymousClientTtlSeconds(): number {
  const raw = process.env.GATEWAY_ANONYMOUS_CLIENT_TTL_SECONDS;
  if (raw === undefined || raw.trim().length === 0) {
    return defaultAnonymousClientTtlSeconds;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : defaultAnonymousClientTtlSeconds;
}

function cutoffFromSeconds(seconds: number): string {
  return new Date(Date.now() - Math.max(0, seconds) * 1000).toISOString();
}

function scoreProjectCandidate(row: Row, input: Row) {
  let score = 0;
  const reasons: string[] = [];
  const project = projectOut(row);
  const slug = project.slug.toLowerCase();
  const title = project.title.toLowerCase();
  const id = project.id.toLowerCase();
  const rootPath = normalizeComparablePath(project.rootPath);
  const inputRootPath = normalizeComparablePath(stringOrNull(input.rootPath));
  const remoteSlug = typeof input.remoteUrl === "string" ? slugFromRemoteUrl(input.remoteUrl) : null;
  const query = typeof input.query === "string" ? input.query.toLowerCase() : null;

  if (typeof input.id === "string" && input.id.toLowerCase() === id) {
    score += 120;
    reasons.push("id");
  }
  if (typeof input.slug === "string" && input.slug.toLowerCase() === slug) {
    score += 100;
    reasons.push("slug");
  }
  if (typeof input.title === "string" && input.title.toLowerCase() === title) {
    score += 85;
    reasons.push("title");
  }
  if (inputRootPath && rootPath && inputRootPath === rootPath) {
    score += 95;
    reasons.push("rootPath");
  } else if (inputRootPath && rootPath && inputRootPath.startsWith(`${rootPath}${path.sep}`)) {
    score += 80;
    reasons.push("rootPathParent");
  }
  if (remoteSlug && remoteSlug === slug) {
    score += 70;
    reasons.push("remoteUrlRepoName");
  }
  if (query) {
    if (query === id || query === slug || query === title) {
      score += 75;
      reasons.push("queryExact");
    } else if (slug.includes(query) || title.includes(query) || id.includes(query)) {
      score += 35;
      reasons.push("queryPartial");
    }
  }

  return {
    project,
    score,
    reasons
  };
}

function normalizeComparablePath(value: string | null): string | null {
  return value ? path.resolve(value) : null;
}

function slugFromRemoteUrl(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return null;
  }
  const lastSegment = trimmed.split(/[/:]/).filter(Boolean).at(-1);
  if (!lastSegment) {
    return null;
  }
  return lastSegment.replace(/\.git$/i, "").toLowerCase();
}

function clientOut(row: Row) {
  return {
    id: String(row.id),
    label: stringOrNull(row.label),
    lastSeenAt: stringOrNull(row.last_seen_at),
    metadata: jsonObject(row.metadata),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function compactClient(row: Row) {
  return {
    id: String(row.id),
    label: stringOrNull(row.label),
    kind: stringOrNull(jsonObject(row.metadata).kind),
    lastSeenAt: stringOrNull(row.last_seen_at)
  };
}

// T-MEMORY-044: the token_enc column never appears here, under any key --
// `token_enc` isn't even read out of `row`. `includeHint` is a caller-chosen
// last-4-characters hint (git.credential_list only; git.credential_create
// deliberately omits it since the caller just typed the token themselves).
function gitCredentialOut(row: Row, options: { includeHint?: boolean } = {}) {
  const out: Row = {
    id: String(row.id),
    host: String(row.host),
    label: String(row.label),
    createdAt: String(row.created_at),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null
  };
  if (options.includeHint && row.token_enc) {
    try {
      out.tokenHint = tokenHint(decryptGitToken(String(row.token_enc)));
    } catch {
      // If decryption fails (e.g. key rotated out from under an old row)
      // this is a display-only hint -- degrade to omitting it rather than
      // failing the whole list call.
    }
  }
  return out;
}

function graphNodeOut(kind: string, row: Row): GraphNode {
  return {
    id: String(row.id),
    kind,
    title: graphNodeTitle(kind, row),
    status: stringOrNull(row.status),
    // Most callers pass a raw db row (snake_case created_at, a Date object),
    // but the PROJECT node is built from resolveProject()'s already-
    // transformed projectOut() shape (camelCase createdAt, already a
    // string) — accept either.
    createdAt: dateStringOrNull(row.created_at) ?? dateStringOrNull(row.createdAt)
  };
}

function graphNodeTitle(kind: string, row: Row): string {
  const title = stringOrNull(row.title);
  if (title) {
    return title;
  }
  if (kind === "PROJECT") {
    return stringOrNull(row.slug) ?? String(row.id);
  }
  if (kind === "ARTIFACT") {
    return stringOrNull(row.path) ?? String(row.id);
  }
  if (kind === "EVENT") {
    return stringOrNull(row.type) ?? String(row.id);
  }
  return String(row.id);
}

function graphNodeSortKey(node: GraphNode): string {
  const order = ["PROJECT", "TASK", "DECISION", "MEMORY", "ARTIFACT", "EVENT"];
  const index = order.includes(node.kind) ? order.indexOf(node.kind) : order.length;
  return `${String(index).padStart(2, "0")}:${node.id}`;
}

function graphEdgeSortKey(edge: GraphEdge): string {
  return `${edge.from}:${edge.relation}:${edge.to}`;
}

function recordLookupTables(id: string): string[] {
  const tables = ["items", "projects", "tasks", "decisions", "artifacts", "events", "links"];
  let preferred = "items";
  if (id.startsWith("P-")) {
    preferred = "projects";
  } else if (id.startsWith("T-")) {
    preferred = "tasks";
  } else if (id.startsWith("D-")) {
    preferred = "decisions";
  } else if (id.startsWith("A-")) {
    preferred = "artifacts";
  } else if (id.startsWith("E-")) {
    preferred = "events";
  } else if (id.startsWith("L-")) {
    preferred = "links";
  }
  return [preferred, ...tables.filter((table) => table !== preferred)];
}

function recordLookupOut(table: string, row: Row): Row {
  switch (table) {
    case "projects": {
      const project = projectOut(row);
      return {
        id: project.id,
        kind: "PROJECT",
        projectId: project.id,
        record: { __typename: "Project", ...project }
      };
    }
    case "items": {
      const item = itemOut(row);
      return {
        id: item.id,
        kind: "MEMORY",
        projectId: item.projectId,
        record: { __typename: "MemoryRecord", ...item }
      };
    }
    case "tasks": {
      const task = taskOut(row);
      return {
        id: task.id,
        kind: "TASK",
        projectId: task.projectId,
        record: { __typename: "Task", ...task }
      };
    }
    case "decisions": {
      const decision = decisionOut(row);
      return {
        id: decision.id,
        kind: "DECISION",
        projectId: decision.projectId,
        record: { __typename: "Decision", ...decision }
      };
    }
    case "artifacts": {
      const artifact = artifactOut(row);
      return {
        id: artifact.id,
        kind: "ARTIFACT",
        projectId: artifact.projectId,
        record: { __typename: "Artifact", ...artifact }
      };
    }
    case "events": {
      const event = eventOut(row);
      return {
        id: event.id,
        kind: "EVENT",
        projectId: event.projectId,
        record: { __typename: "Event", ...event }
      };
    }
    case "links": {
      const link = linkOut(row);
      return {
        id: link.id,
        kind: "LINK",
        projectId: link.projectId,
        record: { __typename: "Link", ...link }
      };
    }
    default:
      throw new AppError("NOT_FOUND", `Unsupported record table ${table}.`, { table });
  }
}

function itemOut(row: Row) {
  return {
    id: String(row.id),
    projectId: stringOrNull(row.project_id),
    scope: row.project_id ? "project" : "common",
    type: String(row.type),
    title: String(row.title),
    body: String(row.body),
    status: String(row.status),
    tags: stringArray(row.tags),
    summary: stringOrNull(row.summary),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function searchOut(row: Row) {
  return {
    id: String(row.id),
    scope: row.project_id ? "project" : "common",
    type: String(row.type),
    title: String(row.title),
    // Preference order (I-MEMORY-022 step 5): a curated summary beats a
    // KWIC snippet around the actual match beats a blind first-200-chars
    // truncation of the body, which is usually just the intro, not the
    // reason this record matched.
    excerpt: stringOrNull(row.summary) ?? stringOrNull(row.headline) ?? excerpt(String(row.body ?? "")),
    status: String(row.status),
    tags: stringArray(row.tags),
    rank: Number(row.rank ?? 0)
  };
}

function taskOut(row: Row) {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    title: String(row.title),
    status: String(row.status),
    milestone: stringOrNull(row.milestone),
    priority: Number(row.priority ?? 100),
    scope: stringOrNull(row.scope),
    acceptance: stringOrNull(row.acceptance),
    allowedFiles: stringArray(row.allowed_files),
    forbiddenFiles: stringArray(row.forbidden_files),
    dependsOn: stringArray(row.depends_on),
    notes: stringOrNull(row.notes),
    activeClaimCount: Number(row.active_claim_count ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function taskClaimOut(row: Row) {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    projectId: String(row.project_id),
    clientId: String(row.client_id),
    clientLabel: stringOrNull(row.client_label),
    clientKind: stringOrNull(row.client_kind),
    role: String(row.role),
    scope: stringOrNull(row.scope),
    status: taskClaimEffectiveStatus(row),
    leaseExpiresAt: String(row.lease_expires_at),
    heartbeatAt: String(row.heartbeat_at),
    note: stringOrNull(row.note),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function taskClaimEffectiveStatus(row: Row): string {
  const status = String(row.status);
  if (status === "active" && new Date(String(row.lease_expires_at)).getTime() <= Date.now()) {
    return "expired";
  }
  return status;
}

function taskClaimRole(value: unknown): string {
  return typeof value === "string" && taskClaimRoles.includes(value as (typeof taskClaimRoles)[number]) ? value : "other";
}

function taskClaimLeaseExpiresAt(value: unknown): string {
  const seconds = boundedInteger(value, defaultTaskClaimLeaseSeconds, 60, 86_400);
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function taskClaimEventBody(row: Row): string {
  return [
    `claimId: ${String(row.id)}`,
    `clientId: ${String(row.client_id)}`,
    `clientLabel: ${String(row.client_label ?? "")}`,
    `role: ${String(row.role)}`,
    stringOrNull(row.scope) ? `scope: ${String(row.scope)}` : null,
    `leaseExpiresAt: ${String(row.lease_expires_at)}`,
    stringOrNull(row.note) ? `note: ${String(row.note)}` : null
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

function appendText(existing: string | null, addition: string | null): string | null {
  if (!addition) {
    return existing;
  }
  return existing ? `${existing}\n\n${addition}` : addition;
}

function taskNoteTypeTitle(type: string): string {
  switch (type) {
    case "implementation_note":
      return "Implementation note";
    case "handoff":
      return "Handoff";
    case "test_result":
      return "Test result";
    case "review_note":
      return "Review note";
    default:
      return "Coordination note";
  }
}

function taskNoteDefaultRelation(type: string): string {
  switch (type) {
    case "handoff":
      return "handoff_for";
    case "test_result":
      return "test_result_for";
    case "review_note":
      return "review_note_for";
    case "implementation_note":
      return "implementation_note_for";
    default:
      return "note_for";
  }
}

function decisionOut(row: Row) {
  return {
    id: String(row.id),
    projectId: stringOrNull(row.project_id),
    title: String(row.title),
    status: String(row.status),
    context: stringOrNull(row.context),
    decision: String(row.decision),
    rationale: stringOrNull(row.rationale),
    consequences: stringOrNull(row.consequences),
    tags: stringArray(row.tags),
    supersedesId: stringOrNull(row.supersedes_id),
    summary: stringOrNull(row.summary),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function eventOut(row: Row) {
  return {
    id: String(row.id),
    projectId: stringOrNull(row.project_id),
    type: String(row.type),
    title: stringOrNull(row.title),
    body: stringOrNull(row.body),
    relatedId: stringOrNull(row.related_id),
    // credentialId attributes the event to the client that performed the
    // operation (T-MEMORY-029 / D-MEMORY-007). recordEventForProject already
    // wrote this into created_by (and mirrored it into source_instance_id)
    // on every event row -- this DTO just stops hiding it from callers.
    credentialId: stringOrNull(row.created_by),
    createdAt: String(row.created_at)
  };
}

function linkOut(row: Row) {
  return {
    id: String(row.id),
    projectId: stringOrNull(row.project_id),
    fromId: String(row.from_id),
    toId: String(row.to_id),
    relation: String(row.relation),
    createdAt: String(row.created_at)
  };
}

function failedAttemptBody(input: Row): string {
  const sections: Array<[string, string]> = [
    ["What was tried", String(input.whatTried)],
    ["Why it failed", String(input.whyFailed)],
    ["What should not be repeated", String(input.doNotRepeat)]
  ];

  if (typeof input.betterNextApproach === "string" && input.betterNextApproach.length > 0) {
    sections.push(["Better next approach", input.betterNextApproach]);
  }

  return sections.map(([title, body]) => `${title}:\n${body}`).join("\n\n");
}

function handoffBody(input: Row): string {
  const sections: Array<[string, string[]]> = [
    ["Work completed", stringArray(input.workCompleted)],
    ["Files touched", stringArray(input.filesTouched)],
    ["Blockers", stringArray(input.blockers)],
    ["Validation", stringArray(input.validation)],
    ["Next steps", stringArray(input.nextSteps)]
  ];

  return sections
    .filter(([, values]) => values.length > 0)
    .map(([title, values]) => `${title}:\n${values.map((value) => `- ${value}`).join("\n")}`)
    .join("\n\n");
}

function excerpt(body: string): string {
  return body.length <= 220 ? body : `${body.slice(0, 217)}...`;
}

// I-MEMORY-022 step 5 ranking. `table` is always one of the hardcoded
// literals passed at each call site below ("items" | "artifacts"), never
// user input, so string-interpolating it into the SQL identifier position
// (where a bind parameter can't go anyway) is safe.
const combinedTsQuerySql = "(plainto_tsquery('simple', ?) || plainto_tsquery('english', ?) || plainto_tsquery('russian', ?))";

function statusRankWeightSql(): string {
  return "(case status when 'active' then 1.0 when 'draft' then 0.9 when 'superseded' then 0.4 when 'archived' then 0.3 when 'rejected' then 0.2 else 1.0 end)";
}

// Absorbed records (something newer supersedes/refines/derives_from them)
// rank below their replacement even when both match — "голова цепочки
// вверх, поглощённые звенья вниз". Reuses the existing idx_links_to_id index.
function chainHeadRankWeightSql(table: string): string {
  return (
    `(case when exists (select 1 from links l where l.to_id = ${table}.id ` +
    "and l.relation in ('supersedes', 'refines', 'derives_from')) then 0.5 else 1.0 end)"
  );
}

function combinedRankSql(table: string): string {
  return `(ts_rank(search_vector, ${combinedTsQuerySql}) * ${statusRankWeightSql()} * ${chainHeadRankWeightSql(table)})`;
}

// KWIC excerpt: context around the actual match instead of the first ~200
// chars of body (which is usually just the intro). Markdown-bolded so the
// match is visible in plain text without HTML.
function kwicHeadlineSql(): string {
  return (
    `ts_headline('simple', coalesce(body, ''), ${combinedTsQuerySql}, ` +
    "'MaxFragments=2, MinWords=15, MaxWords=40, StartSel=**, StopSel=**, FragmentDelimiter= ... ')"
  );
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// timestamptz columns come back from pg/knex as Date objects, not strings —
// stringOrNull alone silently drops them. Everywhere else in this file
// timestamps go through String(row.created_at) (JS Date.toString(), not
// ISO — kept consistent with that, not "corrected" to ISO), which is only
// safe because those fields are always selected/present; graphNodeOut's
// createdAt is occasionally absent by design (unselected columns), so it
// needs the null check stringOrNull gives plus proper Date handling.
function dateStringOrNull(value: unknown): string | null {
  if (value instanceof Date) {
    return String(value);
  }
  return stringOrNull(value);
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string" && value.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(value);
      return stringArray(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

function jsonStringArray(value: unknown): string {
  return JSON.stringify(stringArray(value));
}

function normalizeArtifactPath(value: string): string {
  const withoutLeadingSlash = value.replace(/^\/+/, "");
  if (withoutLeadingSlash.includes("\0") || withoutLeadingSlash.includes("\\")) {
    throw new AppError("VALIDATION_ERROR", "Artifact path contains invalid characters.", { path: value });
  }
  const normalized = path.posix.normalize(withoutLeadingSlash);
  if (
    normalized === "." ||
    normalized.length === 0 ||
    normalized.startsWith("../") ||
    normalized === ".." ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new AppError("VALIDATION_ERROR", "Artifact path must be a safe relative path.", { path: value });
  }
  return normalized;
}

function artifactStoragePath(projectSlug: string | null, artifactPath: string): string {
  return path.posix.join(projectSlug ?? "common", artifactPath);
}

function artifactAbsolutePath(storagePath: string): string {
  const root = path.resolve(process.env.ARTIFACT_DIR ?? "artifacts");
  const absolutePath = path.resolve(root, storagePath);
  if (!absolutePath.startsWith(`${root}${path.sep}`) && absolutePath !== root) {
    throw new AppError("VALIDATION_ERROR", "Artifact storage path escaped artifact root.", { storagePath });
  }
  return absolutePath;
}

function artifactBytesMissingError(row: Row, absolutePath: string): AppError {
  return new AppError("ARTIFACT_BYTES_MISSING", `Artifact ${String(row.id)} metadata exists, but bytes are not available on this gateway.`, {
    id: String(row.id),
    projectId: row.project_id ?? null,
    path: String(row.path),
    storagePath: String(row.storage_path),
    absolutePath,
    status: String(row.status),
    suggestedActions: [
      "send the read request to the gateway that owns this ARTIFACT_DIR",
      "restore or sync the missing file under this gateway ARTIFACT_DIR",
      "re-upload the artifact through this gateway with artifact.put or artifact.put_text using overwrite=true"
    ]
  });
}

function ensureArtifactBytesExist(row: Row, absolutePath: string): void {
  if (!existsSync(absolutePath)) {
    throw artifactBytesMissingError(row, absolutePath);
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function readArtifactBytes(row: Row): Promise<Buffer> {
  const absolutePath = artifactAbsolutePath(String(row.storage_path));
  try {
    return await readFile(absolutePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw artifactBytesMissingError(row, absolutePath);
    }
    throw error;
  }
}

async function readArtifactPrefixForRow(row: Row, maxBytes: number): Promise<Buffer> {
  const absolutePath = artifactAbsolutePath(String(row.storage_path));
  try {
    return await readArtifactPrefix(absolutePath, maxBytes);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw artifactBytesMissingError(row, absolutePath);
    }
    throw error;
  }
}

async function readArtifactPrefix(absolutePath: string, maxBytes: number): Promise<Buffer> {
  const file = await open(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const result = await file.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, result.bytesRead);
  } finally {
    await file.close();
  }
}

function isTextArtifact(contentType: string, artifactPath: string): boolean {
  const normalized = contentType.toLowerCase();
  if (
    normalized.startsWith("text/") ||
    normalized.includes("json") ||
    normalized.includes("xml") ||
    normalized.includes("yaml") ||
    normalized.includes("toml") ||
    normalized.includes("markdown")
  ) {
    return true;
  }
  return [".md", ".txt", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".csv", ".tsv", ".xml"].includes(
    path.posix.extname(artifactPath).toLowerCase()
  );
}

function isMarkdownArtifact(contentType: string, artifactPath: string): boolean {
  return contentType.toLowerCase().includes("markdown") || path.posix.extname(artifactPath).toLowerCase() === ".md";
}

function limitText(text: string, maxChars: number, maxLines: number) {
  let output = text;
  let truncatedByChars = false;
  let truncatedByLines = false;

  if (output.length > maxChars) {
    output = output.slice(0, maxChars);
    truncatedByChars = true;
  }

  const lines = output.split(/\r?\n/);
  if (lines.length > maxLines) {
    output = lines.slice(0, maxLines).join("\n");
    truncatedByLines = true;
  }

  return {
    text: output,
    truncatedByChars,
    truncatedByLines
  };
}

function redactSensitiveText(text: string) {
  let redactions = 0;
  const redact = () => {
    redactions += 1;
    return "[REDACTED]";
  };

  let output = text.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    () => redact()
  );
  output = output.replace(/(authorization\s*:\s*bearer\s+)[^\s"'`]+/gi, (_match, prefix: string) => `${prefix}${redact()}`);
  output = output.replace(
    /((?:"?(?:api[_-]?key|token|secret|password|private[_-]?key|client[_-]?secret)"?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s]+))/gi,
    (match: string) => {
      const separatorIndex = Math.max(match.indexOf(":"), match.indexOf("="));
      if (separatorIndex < 0) {
        return redact();
      }
      redactions += 1;
      return `${match.slice(0, separatorIndex + 1)} [REDACTED]`;
    }
  );

  return { text: output, redactions };
}

function markdownOutline(text: string, limit: number): Array<{ level: number; title: string; line: number }> {
  const outline: Array<{ level: number; title: string; line: number }> = [];
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) {
      continue;
    }
    outline.push({
      level: match[1].length,
      title: match[2].trim(),
      line: index + 1
    });
    if (outline.length >= limit) {
      break;
    }
  }
  return outline;
}

function decodeBase64(value: string): Buffer {
  const compact = value.replace(/\s/g, "");
  const decoded = Buffer.from(compact, "base64");
  if (decoded.length === 0 || decoded.toString("base64").replace(/=+$/, "") !== compact.replace(/=+$/, "")) {
    throw new AppError("VALIDATION_ERROR", "contentBase64 must be valid base64.");
  }
  return decoded;
}

function inferContentType(artifactPath: string): string {
  const extension = path.posix.extname(artifactPath).toLowerCase();
  switch (extension) {
    case ".md":
      return "text/markdown; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".pdf":
      return "application/pdf";
    case ".zip":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
}

function inferTextContentType(artifactPath: string): string {
  const inferred = inferContentType(artifactPath);
  return isTextArtifact(inferred, artifactPath) ? inferred : "text/plain; charset=utf-8";
}

async function readBundledManual(relativePath: string): Promise<string> {
  const attemptedPaths: string[] = [];
  for (const candidate of manualPathCandidates(relativePath)) {
    attemptedPaths.push(candidate);
    try {
      return await readFile(candidate, "utf8");
    } catch {
      // Try the next layout. Source runs from src/, package runs from dist/.
    }
  }
  throw new AppError("NOT_FOUND", `Bundled manual ${relativePath} could not be read.`, {
    path: relativePath,
    attemptedPaths
  });
}

function manualPathCandidates(relativePath: string): string[] {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return Array.from(
    new Set([
      path.resolve(moduleDir, "../..", relativePath),
      path.resolve(moduleDir, "../../..", relativePath),
      path.resolve(process.cwd(), relativePath)
    ])
  );
}

async function readPackageMetadata(): Promise<{ name: string; version: string }> {
  const packagePath = path.resolve(packageRoot(), "package.json");
  const parsed = JSON.parse(await readFile(packagePath, "utf8")) as Row;
  return {
    name: typeof parsed.name === "string" ? parsed.name : "unknown",
    version: typeof parsed.version === "string" ? parsed.version : "unknown"
  };
}

function migrationField(migration: unknown, key: "name" | "file"): string {
  if (typeof migration === "object" && migration !== null && key in migration) {
    const value = (migration as Record<string, unknown>)[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return String(migration);
}

function packageRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    process.cwd(),
    path.resolve(moduleDir, "../.."),
    path.resolve(moduleDir, "../../..")
  ]) {
    if (existsSync(path.resolve(candidate, "package.json"))) {
      return candidate;
    }
  }
  return process.cwd();
}

function jsonObject(value: unknown): Row {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Row;
  }
  if (typeof value === "string" && value.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(value);
      return jsonObject(parsed);
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeContext(context: GatewayRequestContext): NormalizedGatewayRequestContext {
  const clientId = context.clientId && context.clientId.length > 0 ? context.clientId : "anonymous";
  return {
    clientId,
    clientLabel: context.clientLabel && context.clientLabel.length > 0 ? context.clientLabel : clientId,
    metadata: context.metadata ?? {},
    sessionUserId: context.sessionUserId ?? null,
    sessionRole: context.sessionRole ?? null
  };
}

function writeActorFields(context: NormalizedGatewayRequestContext) {
  return {
    created_by: context.clientId,
    updated_by: context.clientId,
    source_instance_id: context.clientId
  };
}

function eventTypeForStatus(status: string): string {
  switch (status) {
    case "doing":
      return "task.started";
    case "done":
      return "task.completed";
    case "blocked":
      return "task.blocked";
    case "cancelled":
      return "task.cancelled";
    default:
      return "task.status_changed";
  }
}
