import { shortText } from "../formatters/common.js";
import type { NormalizedGatewayRequestContext, Row } from "../types.js";
import type { Constructor } from "../base.js";
import { type Tier1Instance } from "../core/links-core.mixin.js";
import { ArtifactsMixin } from "../domains/artifacts.mixin.js";
import { DecisionsMixin } from "../domains/decisions.mixin.js";
import { type MemoryInstance } from "../domains/memory.mixin.js";
import { TasksMixin } from "../domains/tasks.mixin.js";

// T-context (2026-08-25, owner's ask: "(task/decisions/mem/faults/artifacts)
// это omni search"): a single quick-search call fanning out across all five
// content kinds in parallel, each independently ranked/capped, returning a
// flat list of uniform {id, kind, title, excerpt, status, updatedAt} cards
// the frontend groups by kind. No existing endpoint did this -- tasks and
// decisions had zero FTS support before migration 079 added search_vector to
// both (following items/artifacts/projects' established generated-tsvector +
// GIN pattern, migrations 007/060).
type ArtifactsInstance = InstanceType<ReturnType<typeof ArtifactsMixin<Constructor<Tier1Instance>>>>;
type DecisionsInstance = InstanceType<ReturnType<typeof DecisionsMixin<Constructor<Tier1Instance>>>>;
type TasksInstance = InstanceType<ReturnType<typeof TasksMixin<Constructor<MemoryInstance>>>>;
type GlobalSearchBase = ArtifactsInstance & DecisionsInstance & TasksInstance;

export function GlobalSearchMixin<TBase extends Constructor<GlobalSearchBase>>(Base: TBase) {
  return class extends Base {
  protected async globalSearch(input: Row, context?: NormalizedGatewayRequestContext) {
    const project = await this.resolveProject(input.project, context);
    // projectSearchSchema requires query.min(1) at raw string length, but a
    // whitespace-only string ("   ") still passes that -- trim() here would
    // otherwise reach the per-kind search* calls as an empty queryText, and
    // each of those treats an empty/falsy query as "browse, no FTS filter"
    // (matching searchMemory/searchArtifacts' own established behavior), so
    // this quick search would silently turn into an unwanted 5-per-kind
    // recent-items dump instead of staying a live-typing search.
    const query = String(input.query).trim();
    const perKindLimit = Number(input.limit ?? 5);
    if (!query) {
      return { results: [] };
    }

    // prefix: true -- a live quick-search re-queries on every keystroke, so
    // the caller is very often mid-word ("task compl"); plainto_tsquery only
    // matches whole words, which made the box feel broken (reported live:
    // "task compl" found nothing despite a real "Task completion..." task
    // existing). See formatters/common.ts's toPrefixTsQueryText.
    const [tasks, decisions, memory, faults, artifacts] = await Promise.all([
      this.searchTasks({ project: project.slug, query, prefix: true, limit: perKindLimit }, context),
      this.searchDecisions({ project: project.slug, query, prefix: true, includeCommon: true, limit: perKindLimit }, context),
      this.searchMemory({ project: project.slug, query, prefix: true, includeCommon: true, excludeType: "failed_attempt", limit: perKindLimit }, context),
      this.searchMemory({ project: project.slug, query, prefix: true, includeCommon: true, type: "failed_attempt", limit: perKindLimit }, context),
      this.searchArtifacts({ project: project.slug, query, prefix: true, includeCommon: true, limit: perKindLimit }, context)
    ]);

    const results = [
      ...tasks,
      ...decisions,
      ...memory.map((row: Row) => ({ id: row.id, kind: "memory", title: row.title, excerpt: row.excerpt, status: row.status, updatedAt: row.updatedAt })),
      ...faults.map((row: Row) => ({ id: row.id, kind: "fault", title: row.title, excerpt: row.excerpt, status: row.status, updatedAt: row.updatedAt })),
      ...artifacts.map((row: Row) => ({ id: row.id, kind: "artifact", title: row.title, excerpt: shortText((row.description as string | null) ?? "", 200), status: row.status, updatedAt: row.updatedAt }))
    ];
    return { results };
  }
  };
}
