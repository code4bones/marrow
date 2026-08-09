import { compactContextEfficiencyHints, compactSearchRecord } from "../formatters/common.js";
import { compactArtifactRecord } from "../formatters/artifacts.js";
import { compactDecisionRecord } from "../formatters/decisions.js";
import { compactEventRecord } from "../formatters/events.js";
import { compactHandoffRecord } from "../formatters/memory.js";
import { compactProject } from "../formatters/projects.js";
import { compactTask, taskOut } from "../formatters/tasks.js";
import { projectSummaryLimits, projectSummaryNextCalls } from "../formatters/project-summary.js";
import type { NormalizedGatewayRequestContext, Row } from "../types.js";
import type { Constructor } from "../base.js";
import { type Tier1Instance } from "../core/links-core.mixin.js";
import { ArtifactsMixin } from "../domains/artifacts.mixin.js";
import { DecisionsMixin } from "../domains/decisions.mixin.js";
import { EventsMixin } from "../domains/events.mixin.js";
import { type MemoryInstance } from "../domains/memory.mixin.js";
import { TasksMixin } from "../domains/tasks.mixin.js";

// project.summary reads across Memory (searchMemory), Artifacts
// (searchArtifacts), Decisions (listDecisions), Events (listEvents), and
// Tasks (listOpenProjectTasks needs the Tier 0 taskSelectWithActiveClaimCount
// helper only, but listOpenProjectTasks itself lives here) -- so this
// aggregate can only be composed onto a base that already includes all of
// those domains (see service.ts's composition order).
type ArtifactsInstance = InstanceType<ReturnType<typeof ArtifactsMixin<Constructor<Tier1Instance>>>>;
type DecisionsInstance = InstanceType<ReturnType<typeof DecisionsMixin<Constructor<Tier1Instance>>>>;
type EventsInstance = InstanceType<ReturnType<typeof EventsMixin<Constructor<Tier1Instance>>>>;
type TasksInstance = InstanceType<ReturnType<typeof TasksMixin<Constructor<MemoryInstance>>>>;
type ProjectSummaryBase = ArtifactsInstance & DecisionsInstance & EventsInstance & TasksInstance;

export function ProjectSummaryMixin<TBase extends Constructor<ProjectSummaryBase>>(Base: TBase) {
  return class extends Base {
  protected async projectSummary(input: Row, context: NormalizedGatewayRequestContext) {
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
        status: "current",
        limit: limits.decisions
      }),
      this.searchMemory({
        query: explicitQuery,
        project: project.id,
        includeCommon,
        type: "failed_attempt",
        status: "current",
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
        status: "current",
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
      handoffs: handoffs.map(compactHandoffRecord),
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

  protected async listOpenProjectTasks(projectId: string, limit: number): Promise<Row[]> {
    const rows = await this.taskSelectWithActiveClaimCount(this.db("tasks"))
      .where("project_id", projectId)
      .whereIn("status", ["doing", "todo", "blocked"])
      .orderByRaw("case status when 'doing' then 0 when 'todo' then 1 when 'blocked' then 2 else 3 end")
      .orderBy("priority")
      .orderBy("created_at")
      .limit(limit);
    return rows.map(taskOut);
  }

  protected async projectSummaryCounts(projectId: string) {
    const [tasks, openTasks, items, decisions, links, artifacts, events] = await Promise.all([
      this.countQueryRows(this.db("tasks").where("project_id", projectId)),
      this.countQueryRows(this.db("tasks").where("project_id", projectId).whereIn("status", ["doing", "todo", "blocked"])),
      this.countQueryRows(this.db("items").where("project_id", projectId)),
      this.countQueryRows(this.db("decisions").where("project_id", projectId)),
      this.countQueryRows(this.db("links").where("project_id", projectId)),
      this.countQueryRows(this.db("artifacts").where("project_id", projectId)),
      this.countQueryRows(this.db("events").where("project_id", projectId))
    ]);
    return {
      tasks,
      openTasks,
      items,
      decisions,
      links,
      artifacts,
      events
    };
  }

  };
}
