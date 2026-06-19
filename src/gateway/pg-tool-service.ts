import type { Knex } from "knex";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nowIso } from "../shared/dates.js";
import { AppError } from "../shared/errors.js";
import { commonItemPrefix, createProjectId, projectKeyFromId } from "../shared/ids/id.service.js";
import { fail, ok, type ToolResponse } from "../shared/mcp/tool-response.js";
import { gatewayToolSpecs } from "./tool-definitions.js";

type Row = Record<string, unknown>;

export interface GatewayRequestContext {
  clientId?: string;
  clientLabel?: string;
  metadata?: Row;
}

export interface ArtifactDownload {
  artifact: ReturnType<typeof artifactOut>;
  absolutePath: string;
}

interface NormalizedGatewayRequestContext {
  clientId: string;
  clientLabel: string;
  metadata: Row;
}

const manualSpecs = [
  {
    id: "developer",
    audience: "developer",
    aliases: ["user"],
    title: "Project Memory MCP Developer Manual",
    description: "Purpose, setup, safe usage, artifact workflows, guardrails, and gateway operations.",
    path: "docs/DEVELOPER_MANUAL.md"
  },
  {
    id: "agent",
    audience: "agent",
    aliases: [],
    title: "Project Memory MCP Agent Guide",
    description: "Operational rules for agents: when to use pmem, tool chains, preflight, artifacts, and clarification triggers.",
    path: "docs/AGENT_GUIDE.md"
  }
] as const;

export class PgToolService {
  constructor(private readonly db: Knex) {}

  listTools() {
    return gatewayToolSpecs.map(({ name, description }) => ({ name, description }));
  }

  async call(
    toolName: string,
    input: unknown,
    context: GatewayRequestContext = {}
  ): Promise<ToolResponse<unknown>> {
    const spec = gatewayToolSpecs.find((tool) => tool.name === toolName);
    if (!spec) {
      return fail(new AppError("VALIDATION_ERROR", `Tool ${toolName} is not registered.`));
    }

    try {
      const requestContext = normalizeContext(context);
      await this.touchClient(requestContext);
      const parsed = spec.schema.parse(input ?? {}) as Row;
      switch (toolName) {
        case "gateway.about":
          return ok("Project Memory overview loaded.", { about: this.gatewayAbout() });
        case "gateway.version":
          return ok("Gateway version loaded.", { version: await this.gatewayVersion() });
        case "gateway.diagnostics":
          return ok("Gateway diagnostics loaded.", { diagnostics: await this.gatewayDiagnostics() });
        case "gateway.backup_manifest":
          return ok("Gateway backup manifest loaded.", { manifest: await this.gatewayBackupManifest() });
        case "gateway.manuals":
          return ok("Project Memory manuals loaded.", { manuals: await this.gatewayManuals(parsed) });
        case "gateway.status":
          return ok("Gateway status loaded.", { status: await this.gatewayStatus() });
        case "gateway.clients":
          return ok("Gateway clients listed.", { clients: await this.listClients(parsed) });
        case "project.create":
          return ok("Project created.", { project: await this.createProject(parsed, requestContext) });
        case "project.list":
          return ok("Projects listed.", { projects: await this.listProjects(parsed) });
        case "project.get":
          return ok("Project loaded.", { project: await this.getProject(parsed) });
        case "project.resolve":
          return ok("Project candidates resolved.", await this.resolveProjectCandidates(parsed));
        case "project.set_current":
          return ok("Current project set.", { currentProject: await this.setCurrentProject(parsed) });
        case "project.current":
          return ok("Current project loaded.", { project: await this.currentProject() });
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
          return ok("Memory searched.", { results: await this.searchMemory(parsed) });
        case "memory.update":
          return ok("Memory item updated.", { item: await this.updateMemory(parsed, requestContext) });
        case "artifact.put":
          return ok("Artifact stored.", { artifact: await this.putArtifact(parsed, requestContext) });
        case "artifact.search":
          return ok("Artifacts searched.", { results: await this.searchArtifacts(parsed) });
        case "artifact.get":
          return ok("Artifact loaded.", { artifact: await this.getArtifact(parsed) });
        case "artifact.update_metadata":
          return ok("Artifact metadata updated.", { artifact: await this.updateArtifactMetadata(parsed, requestContext) });
        case "artifact.archive":
          return ok("Artifact archived.", await this.archiveArtifact(parsed, requestContext));
        case "task.create":
          return ok("Task created.", { task: await this.createTask(parsed, requestContext) });
        case "task.list":
          return ok("Tasks listed.", { tasks: await this.listTasks(parsed) });
        case "task.get":
          return ok("Task loaded.", { task: await this.getTask(String(parsed.id)) });
        case "task.next":
          return ok("Next task loaded.", { task: await this.nextTask(parsed) });
        case "task.update_status":
          return ok("Task status updated.", { task: await this.updateTaskStatus(parsed, requestContext) });
        case "decision.record":
          return ok("Decision recorded.", { decision: await this.recordDecision(parsed, requestContext) });
        case "decision.supersede":
          return ok("Decision superseded.", await this.supersedeDecision(parsed, requestContext));
        case "decision.list":
          return ok("Decisions listed.", { decisions: await this.listDecisions(parsed) });
        case "decision.get":
          return ok("Decision loaded.", { decision: await this.getDecision(String(parsed.id)) });
        case "event.record":
          return ok("Event recorded.", { event: await this.recordEvent(parsed, requestContext) });
        case "event.list":
          return ok("Events listed.", { events: await this.listEvents(parsed) });
        case "link.create":
          return ok("Link created.", { link: await this.createLink(parsed, requestContext) });
        case "link.list":
          return ok("Links listed.", { links: await this.listLinks(parsed) });
        case "preflight":
          return ok("Preflight context loaded.", await this.preflight(parsed));
        default:
          return fail(new AppError("VALIDATION_ERROR", `Tool ${toolName} is not implemented.`));
      }
    } catch (error) {
      return fail(error);
    }
  }

  async close(): Promise<void> {
    await this.db.destroy();
  }

  async artifactDownload(id: string): Promise<ArtifactDownload> {
    const row = await this.artifactRowById(id);
    return {
      artifact: artifactOut(row),
      absolutePath: artifactAbsolutePath(String(row.storage_path))
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
            "Load Markdown manuals for developers/users and agents. Use includeContent=true when the caller wants the .md files inline."
        },
        {
          tool: "gateway.status",
          reason: "Confirm that the agent is connected to the shared PostgreSQL gateway."
        },
        {
          tool: "gateway.clients",
          reason: "See recently connected agents and developers."
        },
        {
          tool: "project.list",
          reason: "Discover existing project scopes."
        },
        {
          tool: "memory.search",
          reason: "Search common and project-specific knowledge before editing files."
        },
        {
          tool: "preflight",
          reason: "Load task-specific safety context before implementation work."
        }
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
        "Call gateway.manuals with includeContent=true when the developer or agent needs the bundled Markdown manuals.",
        "Call gateway.status to confirm shared gateway mode.",
        "Call project.current or project.list to identify the active project.",
        "Call memory.search with the task topic and include common knowledge.",
        "Call task.next or task.get when working from a recorded task.",
        "Call preflight before editing files.",
        "Record decisions, failed attempts, events, and useful memory after meaningful work."
      ],
      artifactStorage: {
        status: "available",
        intent:
          "Store reusable files such as AGENTS.md templates on the gateway under project-oriented paths so agents can search and download them.",
        tools: ["artifact.put", "artifact.search", "artifact.get"]
      }
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
    const rows = await this.db("gateway_clients")
      .select("*")
      .orderBy("updated_at", "desc")
      .limit(Number(input.limit ?? 50));
    return rows.map(clientOut);
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

  private async listProjects(input: Row) {
    let query = this.db("projects").select("*").orderBy("slug");
    if (input.status) {
      query = query.where("status", String(input.status));
    }
    return (await query).map(projectOut);
  }

  private async getProject(input: Row) {
    const row = input.id
      ? await this.db("projects").where({ id: String(input.id) }).first()
      : await this.db("projects").where({ slug: String(input.slug) }).first();
    if (!row) {
      throw new AppError("PROJECT_NOT_FOUND", "Project does not exist.", { ...input });
    }
    return projectOut(row);
  }

  private async resolveProjectCandidates(input: Row) {
    const rows = await this.db("projects").select("*").where({ status: "active" });
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

  private async setCurrentProject(input: Row) {
    const project = await this.getProject(input);
    await this.setKv("current_project_id", project.id);
    return project;
  }

  private async currentProject() {
    const currentProjectId = await this.getKv("current_project_id");
    if (!currentProjectId) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "Current project is not configured.");
    }
    return this.getProject({ id: currentProjectId });
  }

  private async resolveProject(project?: unknown) {
    if (typeof project === "string" && project.length > 0) {
      return project.startsWith("P-") ? this.getProject({ id: project }) : this.getProject({ slug: project });
    }
    return this.currentProject();
  }

  private async createMemory(input: Row, context: NormalizedGatewayRequestContext) {
    const common = input.common === true || input.project === null;
    const project = common ? null : await this.resolveProject(input.project);
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
    return itemOut(row);
  }

  private async upsertMemory(input: Row, context: NormalizedGatewayRequestContext) {
    const existing = await this.findExistingMemoryForUpsert(input);
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

  private async findExistingMemoryForUpsert(input: Row): Promise<Row | undefined> {
    const match = typeof input.match === "string" ? input.match : undefined;
    if ((match === "id" || !match) && typeof input.id === "string") {
      const byId = await this.db("items").where({ id: input.id }).first();
      if (byId || match === "id") {
        return byId;
      }
    }

    const common = input.common === true || input.project === null;
    const project = common ? null : await this.resolveProject(input.project);
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

  private async searchMemory(input: Row) {
    const includeCommon = input.includeCommon !== false;
    const project = input.project ? await this.resolveProject(input.project) : await this.tryCurrentProject();
    if (!project && !includeCommon) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "Search requires a project or includeCommon=true.");
    }

    const queryText = String(input.query);
    let query = this.db("items")
      .select(
        "id",
        "project_id",
        "type",
        "title",
        "body",
        "status",
        "tags",
        this.db.raw("ts_rank(search_vector, plainto_tsquery('simple', ?)) as rank", [queryText])
      )
      .whereRaw("search_vector @@ plainto_tsquery('simple', ?)", [queryText]);

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
      .orderBy("rank", "desc")
      .limit(Number(input.limit ?? 10));
    return rows.map(searchOut);
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

  private async putArtifact(input: Row, context: NormalizedGatewayRequestContext) {
    const common = input.common === true || input.project === null;
    const project = common ? null : await this.resolveProject(input.project);
    const artifactPath = normalizeArtifactPath(String(input.path));
    const content = decodeBase64(String(input.contentBase64));
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
      throw new AppError("VALIDATION_ERROR", "Artifact already exists. Set overwrite=true to replace it.", {
        id: existing.id,
        path: artifactPath
      });
    }

    const now = nowIso();
    const id = existing?.id ? String(existing.id) : String(input.id ?? (await this.nextId("artifacts", `A-${project ? projectKeyFromId(project.id) : "COMMON"}`)));
    const title = typeof input.title === "string" ? input.title : path.posix.basename(artifactPath);
    const contentType = typeof input.contentType === "string" ? input.contentType : inferContentType(artifactPath);
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

  private async searchArtifacts(input: Row) {
    const includeCommon = input.includeCommon !== false;
    const project = input.project ? await this.resolveProject(input.project) : await this.tryCurrentProject();
    if (!project && !includeCommon) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "Artifact search requires a project or includeCommon=true.");
    }

    let query = this.db("artifacts").select("*");
    const queryText = typeof input.query === "string" ? input.query : null;
    if (queryText) {
      query = query
        .select(this.db.raw("ts_rank(search_vector, plainto_tsquery('simple', ?)) as rank", [queryText]))
        .whereRaw("search_vector @@ plainto_tsquery('simple', ?)", [queryText]);
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
    return rows.map(artifactSearchOut);
  }

  private async getArtifact(input: Row) {
    const row = input.id ? await this.artifactRowById(String(input.id)) : await this.artifactRowByPath(input);
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
      const content = await readFile(artifactAbsolutePath(String(row.storage_path)));
      return {
        ...output,
        contentBase64: content.toString("base64")
      };
    }
    return output;
  }

  private async updateArtifactMetadata(input: Row, context: NormalizedGatewayRequestContext) {
    const current = input.id ? await this.artifactRowById(String(input.id)) : await this.artifactRowByPath(input);
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
    const current = input.id ? await this.artifactRowById(String(input.id)) : await this.artifactRowByPath(input);
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

  private async artifactRowById(id: string): Promise<Row> {
    const row = await this.db("artifacts").where({ id }).first();
    if (!row) {
      throw new AppError("ARTIFACT_NOT_FOUND", `Artifact ${id} does not exist.`, { id });
    }
    return row;
  }

  private async artifactRowByPath(input: Row): Promise<Row> {
    const common = input.project === null;
    const project = common ? null : await this.resolveProject(input.project);
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
    const project = await this.resolveProject(input.project);
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

  private async listTasks(input: Row) {
    const project = await this.resolveProject(input.project);
    let query = this.db("tasks").select("*").where("project_id", project.id);
    if (input.status) {
      query = query.andWhere("status", String(input.status));
    }
    if (input.milestone) {
      query = query.andWhere("milestone", String(input.milestone));
    }
    return (await query.orderBy("priority").orderBy("created_at").limit(Number(input.limit ?? 20))).map(taskOut);
  }

  private async getTask(id: string) {
    const row = await this.db("tasks").where({ id }).first();
    if (!row) {
      throw new AppError("TASK_NOT_FOUND", `Task ${id} does not exist.`, { id });
    }
    return taskOut(row);
  }

  private async nextTask(input: Row) {
    const project = await this.resolveProject(input.project);
    const row = await this.db("tasks")
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

  private async recordDecision(input: Row, context: NormalizedGatewayRequestContext) {
    const project = input.project === null ? null : await this.resolveProject(input.project);
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
    return decisionOut(row);
  }

  private async supersedeDecision(input: Row, context: NormalizedGatewayRequestContext) {
    const oldRow = await this.db("decisions").where({ id: String(input.supersedesId) }).first();
    if (!oldRow) {
      throw new AppError("DECISION_NOT_FOUND", `Decision ${String(input.supersedesId)} does not exist.`, {
        id: input.supersedesId
      });
    }

    const projectId = await this.resolveDecisionProjectId(input, oldRow);
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

  private async resolveDecisionProjectId(input: Row, oldRow: Row): Promise<string | null> {
    if (input.project === undefined) {
      return stringOrNull(oldRow.project_id);
    }
    if (input.project === null) {
      return null;
    }
    return (await this.resolveProject(input.project)).id;
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

  private async listDecisions(input: Row) {
    const includeCommon = input.includeCommon !== false;
    const project = input.project ? await this.resolveProject(input.project) : await this.tryCurrentProject();
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

  private async getDecision(id: string) {
    const row = await this.db("decisions").where({ id }).first();
    if (!row) {
      throw new AppError("DECISION_NOT_FOUND", `Decision ${id} does not exist.`, { id });
    }
    return decisionOut(row);
  }

  private async recordEvent(input: Row, context: NormalizedGatewayRequestContext) {
    const project = input.project === null ? null : await this.resolveProject(input.project);
    return this.recordEventForProject(project?.id ?? null, {
      type: String(input.type),
      title: asNullableString(input.title),
      body: asNullableString(input.body),
      related_id: asNullableString(input.relatedId)
    }, context);
  }

  private async listEvents(input: Row) {
    let query = this.db("events").select("*");
    if (input.project !== undefined) {
      if (input.project === null) {
        query = query.whereNull("project_id");
      } else {
        const project = await this.resolveProject(input.project);
        query = query.where("project_id", project.id);
      }
    }
    if (input.relatedId) {
      query = query.andWhere("related_id", String(input.relatedId));
    }
    return (await query.orderBy("created_at", "desc").limit(Number(input.limit ?? 20))).map(eventOut);
  }

  private async createLink(input: Row, context: NormalizedGatewayRequestContext) {
    await this.assertRecordExists(String(input.fromId));
    await this.assertRecordExists(String(input.toId));
    const project = input.project === null ? null : await this.resolveProject(input.project);
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
    return (await query.orderBy("created_at", "desc")).map(linkOut);
  }

  private async preflight(input: Row) {
    const task = await this.getTask(String(input.taskId));
    const project = await this.getProject({ id: task.projectId });
    const query = [task.title, task.scope, task.acceptance].filter(Boolean).join(" ") || "task";
    const limits = (input.limits ?? {}) as Row;
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
      failedAttempts: await this.searchMemory({
        query,
        project: project.id,
        includeCommon: input.includeCommon !== false,
        type: "failed_attempt",
        status: "active",
        limit: limits.failedAttempts ?? 5
      }),
      recentEvents: await this.listEvents({
        project: project.id,
        limit: limits.events ?? 10
      }),
      summary: "Use this shared gateway context before editing files. Respect allowed and forbidden scope."
    };
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
    return eventOut(row);
  }

  private async touchClient(context: NormalizedGatewayRequestContext): Promise<void> {
    const now = nowIso();
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

  private async tryCurrentProject() {
    try {
      return await this.currentProject();
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
    archivedAt: stringOrNull(row.archived_at),
    archivedBy: stringOrNull(row.archived_by),
    archiveReason: stringOrNull(row.archive_reason),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function artifactSearchOut(row: Row) {
  return {
    ...artifactOut(row),
    rank: Number(row.rank ?? 0)
  };
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

function itemOut(row: Row) {
  return {
    id: String(row.id),
    projectId: stringOrNull(row.project_id),
    type: String(row.type),
    title: String(row.title),
    body: String(row.body),
    status: String(row.status),
    tags: stringArray(row.tags),
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
    excerpt: excerpt(String(row.body ?? "")),
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
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
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

function excerpt(body: string): string {
  return body.length <= 220 ? body : `${body.slice(0, 217)}...`;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
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
    metadata: context.metadata ?? {}
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
