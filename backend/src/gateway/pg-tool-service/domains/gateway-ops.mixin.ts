import { existsSync } from "node:fs";
import path from "node:path";
import { nowIso } from "../../../shared/dates.js";
import { anonymousClientTtlSeconds } from "../formatters/clients.js";
import { connectionSnippets } from "../formatters/common.js";
import { migrationField, packageRoot, readBundledManual, readPackageMetadata } from "../formatters/gateway-ops.js";
import { manualSpecs, type Row } from "../types.js";
import { type Constructor, BaseService } from "../base.js";

export function GatewayOpsMixin<TBase extends Constructor<BaseService>>(Base: TBase) {
  return class extends Base {
  protected gatewayAbout() {
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

  protected async gatewayManuals(input: Row) {
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

  protected async gatewayVersion() {
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

  protected async gatewayDiagnostics() {
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

  // Deliberately DOES expose a real secret value (oauthClientSecret), unlike
  // gatewayDiagnostics above (whose own security.bearerAuth field only ever
  // returns a presence boolean, never MCP_TOKEN itself). This tool exists
  // specifically so a `role=member` user can self-serve their own OAuth
  // connector setup (MCP URL + client id/secret) from their own profile
  // page instead of needing an operator to SSH in and read .env -- the
  // motivating gap for this tool. Safe to do at `read` scope: the OAuth
  // client_id/secret pair is shared identically across every user of this
  // instance (it authenticates "this is the pmem connector app", not any
  // individual), and the real access boundary is the login step OAuth's
  // authorize flow requires (D-MEMORY-027) -- knowing this pair alone,
  // without also completing that login, grants nothing.
  protected async gatewayConnectorInfo() {
    const publicUrl = process.env.PROJECT_MEMORY_PUBLIC_URL;
    return {
      mcpUrl: publicUrl ? `${publicUrl.replace(/\/$/, "")}/mcp` : null,
      oauthClientId: process.env.PROJECT_MEMORY_OAUTH_CLIENT_ID ?? null,
      oauthClientSecret: process.env.PROJECT_MEMORY_OAUTH_CLIENT_SECRET ?? null
    };
  }

  protected async gatewayBackupManifest() {
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

  protected async migrationStatus() {
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

  protected async gatewayStatus() {
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

  };
}
