import type { Knex } from "knex";
import { compactContextEfficiencyHints, compactSearchRecord } from "../formatters/common.js";
import { compactArtifactRecord } from "../formatters/artifacts.js";
import { compactDecisionRecord } from "../formatters/decisions.js";
import { compactEventRecord } from "../formatters/events.js";
import { compactHandoffRecord } from "../formatters/memory.js";
import { compactTask, taskOut } from "../formatters/tasks.js";
import { projectSummaryLimits, projectSummaryNextCalls } from "../formatters/project-summary.js";
import type { NormalizedGatewayRequestContext, Row } from "../types.js";
import type { Constructor } from "../base.js";
import { type Tier1Instance } from "../core/links-core.mixin.js";
import { ArtifactsMixin } from "../domains/artifacts.mixin.js";
import { DecisionsMixin } from "../domains/decisions.mixin.js";
import { EventsMixin } from "../domains/events.mixin.js";
import { type MemoryInstance } from "../domains/memory.mixin.js";
import { SkillsMixin } from "../domains/skills.mixin.js";
import { TasksMixin } from "../domains/tasks.mixin.js";

// project.summary reads across Memory (searchMemory), Artifacts
// (searchArtifacts), Decisions (listDecisions), Events (listEvents), Skills
// (listSkills), and Tasks (listOpenProjectTasks needs the Tier 0
// taskSelectWithActiveClaimCount helper only, but listOpenProjectTasks
// itself lives here) -- so this aggregate can only be composed onto a base
// that already includes all of those domains (see service.ts's composition
// order).
type ArtifactsInstance = InstanceType<ReturnType<typeof ArtifactsMixin<Constructor<Tier1Instance>>>>;
type DecisionsInstance = InstanceType<ReturnType<typeof DecisionsMixin<Constructor<Tier1Instance>>>>;
type EventsInstance = InstanceType<ReturnType<typeof EventsMixin<Constructor<Tier1Instance>>>>;
type SkillsInstance = InstanceType<ReturnType<typeof SkillsMixin<Constructor<Tier1Instance>>>>;
type TasksInstance = InstanceType<ReturnType<typeof TasksMixin<Constructor<MemoryInstance>>>>;
type ProjectSummaryBase = ArtifactsInstance & DecisionsInstance & EventsInstance & SkillsInstance & TasksInstance;

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

    const [openTasks, decisions, knownFaults, availableSkills, handoffs, artifacts, memory, recentEvents, counts] = await Promise.all([
      this.listOpenProjectTasks(project.id, limits.tasks),
      this.listDecisions({
        project: project.id,
        includeCommon,
        status: "accepted",
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
      this.listSkills({
        project: project.id,
        includeCommon,
        status: "active",
        compact: true,
        limit: limits.skills
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
      // T-context (2026-08-25): was compactProject(project) (id/slug/title/
      // status/description only) -- GET_PROJECT_SUMMARY's frontend selection
      // set also asks for updatedAt, which compactProject doesn't have, so
      // the response nulled it. Apollo's InMemoryCache normalizes Project
      // entities by id with no custom merge policy, so that null silently
      // overwrote the SAME project's already-correct updatedAt that the
      // projects-sidebar list (GET_PROJECTS_PAGE) had cached, the moment a
      // user opened that project -- Timestamp's `!value` guard then rendered
      // a bare dash for both the date and the author in the sidebar row.
      // `project` here is already resolveProject()->getProject()'s full
      // projectOut()-shaped object, so no reformatting is needed at all.
      project,
      query,
      includeCommon,
      counts,
      // T-context (owner's ask, 2026-08-22): knownFaults deliberately comes
      // first among the record sections, before openTasks/decisions/etc --
      // "learn what already went wrong here before reading what's left to
      // do." Field order in the serialized JSON is what an agent actually
      // reads first; burying it after task/decision lists meant it competed
      // for attention with everything else instead of priming the read.
      knownFaults: knownFaults.map(compactSearchRecord),
      // T-context (D-MEMORY-041): availableSkills sits next to knownFaults
      // for the same reason -- both are "orient before acting" surfaces an
      // agent should notice before diving into openTasks/decisions. Already
      // compact (listSkills was called with compact:true above) -- name+
      // description only, no body -- skill.activate(id) loads the full body
      // when the agent decides it needs one.
      availableSkills,
      openTasks: openTasks.map(compactTask),
      handoffs: handoffs.map(compactHandoffRecord),
      decisions: decisions.map(compactDecisionRecord),
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
      .whereIn("status", ["doing", "todo", "blocked", "review"])
      .orderByRaw("case status when 'doing' then 0 when 'todo' then 1 when 'blocked' then 2 else 3 end")
      .orderBy("priority")
      .orderBy("created_at")
      .limit(limit);
    return rows.map(taskOut);
  }

  protected async projectSummaryCounts(projectId: string) {
    // T-context (owner's ask, 2026-08-27, kribrum): decisionsPage,
    // artifactsPage, and memorySearchPage (faults) all default
    // includeCommon to true with no frontend opt-out, so a project's
    // Decisions/Artifacts/Faults tabs always show common-scope records
    // mixed in -- but these three counts stayed project-id-only, so a
    // young project with real common decisions/artifacts visible in its
    // own tabs showed 0 in the header/menu/stat-tile badge. Memory items
    // and links are NOT included here: their pages default their
    // includeCommon toggle to false, so those two counts already match
    // what's shown by default.
    const includeCommon = (builder: Knex.QueryBuilder) => builder.where("project_id", projectId).orWhereNull("project_id");
    const [tasks, openTasks, items, decisions, links, artifacts, events, faults, skills] = await Promise.all([
      this.countQueryRows(this.db("tasks").where("project_id", projectId)),
      this.countQueryRows(this.db("tasks").where("project_id", projectId).whereIn("status", ["doing", "todo", "blocked", "review"])),
      this.countQueryRows(this.db("items").where("project_id", projectId)),
      this.countQueryRows(this.db("decisions").where(includeCommon)),
      this.countQueryRows(this.db("links").where("project_id", projectId)),
      this.countQueryRows(this.db("artifacts").where(includeCommon)),
      this.countQueryRows(this.db("events").where("project_id", projectId)),
      // T-context (2026-08-25): the frontend's "Faults" stat/nav badge was a
      // hardcoded 0 -- this count backs both now that a real number exists.
      this.countQueryRows(this.db("items").where(includeCommon).andWhere({ type: "failed_attempt", status: "current" })),
      this.countQueryRows(this.db("skills").where(includeCommon).andWhere({ status: "active" }))
    ]);
    return {
      tasks,
      openTasks,
      items,
      decisions,
      links,
      artifacts,
      events,
      faults,
      skills
    };
  }

  };
}
