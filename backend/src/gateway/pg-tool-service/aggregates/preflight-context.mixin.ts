import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import {
  compactContextEfficiencyHints,
  compactSearchRecord,
  defaultTokenBudget,
  parseSinceCursor
} from "../formatters/common.js";
import { artifactOut, compactArtifactRecord } from "../formatters/artifacts.js";
import { compactDecisionRecord, decisionOut } from "../formatters/decisions.js";
import { compactEventRecord, eventOut } from "../formatters/events.js";
import { compactHandoffRecord, compactMemoryRecord, itemOut } from "../formatters/memory.js";
import { compactProject, projectOut } from "../formatters/projects.js";
import { compactTask, taskOut } from "../formatters/tasks.js";
import { changedSinceNextCalls, contextPackLimits, contextPackNextCalls, mustReadPointers } from "../formatters/preflight.js";
import type { NormalizedGatewayRequestContext, Row } from "../types.js";
import type { Constructor } from "../base.js";
import { type Tier1Instance } from "../core/links-core.mixin.js";
import { ArtifactsMixin } from "../domains/artifacts.mixin.js";
import { DecisionsMixin } from "../domains/decisions.mixin.js";
import { EventsMixin } from "../domains/events.mixin.js";
import { type MemoryInstance } from "../domains/memory.mixin.js";
import { TasksMixin } from "../domains/tasks.mixin.js";

// preflight/preflightByQuery/contextPack/contextChangedSince read across
// Memory (searchMemory), Artifacts (searchArtifacts), Decisions
// (listDecisions), Events (listEvents), and Tasks (getTask) -- so this
// aggregate can only be composed onto a base that already includes all of
// those domains (see service.ts's composition order).
type ArtifactsInstance = InstanceType<ReturnType<typeof ArtifactsMixin<Constructor<Tier1Instance>>>>;
type DecisionsInstance = InstanceType<ReturnType<typeof DecisionsMixin<Constructor<Tier1Instance>>>>;
type EventsInstance = InstanceType<ReturnType<typeof EventsMixin<Constructor<Tier1Instance>>>>;
type TasksInstance = InstanceType<ReturnType<typeof TasksMixin<Constructor<MemoryInstance>>>>;
type PreflightContextBase = ArtifactsInstance & DecisionsInstance & EventsInstance & TasksInstance;

export function PreflightContextMixin<TBase extends Constructor<PreflightContextBase>>(Base: TBase) {
  return class extends Base {
  protected async preflight(input: Row, context?: NormalizedGatewayRequestContext) {
    const task = await this.getTask(String(input.taskId), context);
    const project = await this.getProject({ id: task.projectId }, context);
    const query = [task.title, task.scope, task.acceptance].filter(Boolean).join(" ") || "task";
    const faultQuery = String(task.title || query);
    const limits = (input.limits ?? {}) as Row;
    const failedAttempts = await this.searchMemory({
      query: faultQuery,
      project: project.id,
      includeCommon: input.includeCommon !== false,
      type: "failed_attempt",
      status: "current",
      limit: limits.failedAttempts ?? 5
    });
    return {
      project,
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        scope: task.scope,
        acceptance: task.acceptance,
        allowedFiles: task.allowedFiles,
        forbiddenFiles: task.forbiddenFiles,
        dependsOn: task.dependsOn
      },
      relevantDecisions: await this.listDecisions({
        project: project.id,
        includeCommon: input.includeCommon !== false,
        status: "current",
        limit: limits.decisions ?? 10
      }),
      commonRules: await this.searchMemory({
        query: "preflight task scope acceptance diffs failed attempts",
        project: project.id,
        includeCommon: true,
        status: "current",
        limit: limits.items ?? 10
      }),
      relatedItems: await this.searchMemory({
        query,
        project: project.id,
        includeCommon: input.includeCommon !== false,
        status: "current",
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

  protected async preflightByQuery(input: Row, context?: NormalizedGatewayRequestContext) {
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
      status: "current",
      limit: limits.failedAttempts ?? 5
    });

    return {
      project: project ?? null,
      query,
      relevantDecisions: await this.listDecisions({
        project: project?.id,
        includeCommon,
        status: "current",
        limit: limits.decisions ?? 10
      }),
      commonRules: await this.searchMemory({
        query: "preflight task scope acceptance diffs failed attempts",
        project: project?.id,
        includeCommon: true,
        status: "current",
        limit: limits.items ?? 10
      }),
      relatedItems: await this.searchMemory({
        query,
        project: project?.id,
        includeCommon,
        status: "current",
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

  protected async contextPack(input: Row, context: NormalizedGatewayRequestContext) {
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
      handoffs: handoffs.map(compactHandoffRecord),
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

  protected async contextChangedSince(input: Row, context: NormalizedGatewayRequestContext) {
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
      handoffs: handoffs.map(compactHandoffRecord),
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

  protected async listChangedTasks(projectId: string, since: string, limit: number): Promise<Row[]> {
    const rows = await this.db("tasks")
      .select("*")
      .where("project_id", projectId)
      .andWhere("updated_at", ">", since)
      .orderBy("updated_at", "desc")
      .limit(limit);
    return rows.map(taskOut);
  }

  protected async listChangedItems(projectId: string | null, includeCommon: boolean, since: string, limit: number, type?: string) {
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

  protected async listChangedDecisions(projectId: string | null, includeCommon: boolean, since: string, limit: number) {
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

  protected async listChangedArtifacts(projectId: string | null, includeCommon: boolean, since: string, limit: number) {
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

  protected async listChangedEvents(projectId: string | null, includeCommon: boolean, since: string, limit: number) {
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

  };
}
