import type { Knex } from "knex";
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

interface NormalizedGatewayRequestContext {
  clientId: string;
  clientLabel: string;
  metadata: Row;
}

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
        case "project.set_current":
          return ok("Current project set.", { currentProject: await this.setCurrentProject(parsed) });
        case "project.current":
          return ok("Current project loaded.", { project: await this.currentProject() });
        case "memory.create":
          return ok("Memory item created.", { item: await this.createMemory(parsed, requestContext) });
        case "memory.get":
          return ok("Memory item loaded.", { item: await this.getMemory(String(parsed.id)) });
        case "memory.search":
          return ok("Memory searched.", { results: await this.searchMemory(parsed) });
        case "memory.update":
          return ok("Memory item updated.", { item: await this.updateMemory(parsed, requestContext) });
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
      recommendedAgentFlow: [
        "Call gateway.about if the agent has not used pmem before.",
        "Call gateway.status to confirm shared gateway mode.",
        "Call project.current or project.list to identify the active project.",
        "Call memory.search with the task topic and include common knowledge.",
        "Call task.next or task.get when working from a recorded task.",
        "Call preflight before editing files.",
        "Record decisions, failed attempts, events, and useful memory after meaningful work."
      ],
      artifactStorage: {
        status: "planned",
        intent:
          "Store reusable files such as AGENTS.md templates on the gateway under project-oriented paths so agents can search and download them."
      }
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
    const [projects, items, tasks, decisions, events, clients] = await Promise.all([
      this.countRows("projects"),
      this.countRows("items"),
      this.countRows("tasks"),
      this.countRows("decisions"),
      this.countRows("events"),
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
        events
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
    for (const table of ["projects", "items", "tasks", "decisions", "events", "links"]) {
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
