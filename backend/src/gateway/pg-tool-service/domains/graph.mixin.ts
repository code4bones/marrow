import { AppError } from "../../../shared/errors.js";
import { boundedInteger, stringArray, stringOrNull } from "../formatters/common.js";
import { graphEdgeSortKey, graphNodeOut, graphNodeSortKey } from "../formatters/graph.js";
import type { GraphEdge, GraphNode, NormalizedGatewayRequestContext, Row } from "../types.js";
import type { Constructor } from "../base.js";
import { type Tier1Instance } from "../core/links-core.mixin.js";

export function GraphMixin<TBase extends Constructor<Tier1Instance>>(Base: TBase) {
  return class extends Base {
  protected async projectGraph(input: Row, context?: NormalizedGatewayRequestContext) {
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
    const addEdge = (edge: Omit<GraphEdge, "id">) => {
      if (!edge.from || !edge.to || !edge.relation) {
        return;
      }
      const key = `${edge.from}\0${edge.to}\0${edge.relation}`;
      edges.set(key, { ...edge, id: `${edge.from}:${edge.to}:${edge.relation}` });
    };

    addNode(graphNodeOut("PROJECT", project));

    // T-context (2026-09-02, owner's ask -- project switch took 5-7s+):
    // the old BFS here did up to two sequential DB round trips *per depth
    // level* (a filtered links query, then a node-detail batch) -- up to
    // ~10 round trips end to end at depth=5 (the frontend's fixed value)
    // on a link-rich project. Every link the project owns is cheap to
    // fetch in one shot (149 rows on P-MEMORY, still cheap at 10x that) --
    // fetching it once here and walking the whole multi-hop expansion in
    // memory turns "up to 10 sequential round trips" into "at most 2"
    // (this Promise.all, then one final node-detail batch below).
    const [items, tasks, decisions, artifacts, allLinks] = await Promise.all([
      this.db("items")
        .select("id", "title", "status", "type", "project_id", "created_by", "created_at")
        .where({ project_id: project.id })
        .orderBy("updated_at", "desc")
        .limit(maxPerType),
      this.db("tasks")
        .select("id", "title", "status", "project_id", "depends_on", "created_by", "created_at", "milestone", "assignee_user_id")
        .where({ project_id: project.id })
        .orderBy("updated_at", "desc")
        .limit(maxPerType),
      this.db("decisions")
        .select("id", "title", "status", "project_id", "supersedes_id", "created_by", "created_at", "milestone", "assignee_user_id")
        .where({ project_id: project.id })
        .orderBy("updated_at", "desc")
        .limit(maxPerType),
      this.db("artifacts")
        .select("id", "title", "status", "project_id", "path", "created_by", "created_at")
        .where({ project_id: project.id })
        .orderBy("updated_at", "desc")
        .limit(maxPerType),
      this.projectGraphLinkRows(project.id)
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

    // Pure in-memory BFS over allLinks, depth-1 expansion rounds -- matches
    // the old loop's semantics exactly (its last level only ever harvested
    // edges, never expanded past them; see graph.mixin.ts git history for
    // the walkthrough this comment is based on). One difference, strictly
    // additive and safe: the old loop stopped following a chain through any
    // id that didn't resolve to a real node (e.g. it deliberately never
    // expands through an event id) since that gated *which ids counted as
    // the next level's frontier*; this version's frontier is the plain id
    // graph and only filters out unresolvable ids at the very end (the
    // final `nodes.has(...)` check on edges, same as before) -- so it can
    // occasionally surface a real node reachable only through such a
    // chain that the old code would've missed, never a fabricated one.
    const adjacency = new Map<string, string[]>();
    for (const link of allLinks) {
      const from = String(link.from_id);
      const to = String(link.to_id);
      (adjacency.get(from) ?? adjacency.set(from, []).get(from)!).push(to);
      (adjacency.get(to) ?? adjacency.set(to, []).get(to)!).push(from);
    }

    const knownIds = new Set<string>(nodes.keys());
    let frontier = new Set<string>(knownIds);
    for (let level = 1; level < depth; level += 1) {
      const nextFrontier = new Set<string>();
      for (const id of frontier) {
        for (const neighborId of adjacency.get(id) ?? []) {
          if (!knownIds.has(neighborId)) {
            knownIds.add(neighborId);
            nextFrontier.add(neighborId);
          }
        }
      }
      if (nextFrontier.size === 0) {
        break;
      }
      frontier = nextFrontier;
    }

    for (const link of allLinks) {
      const from = String(link.from_id);
      const to = String(link.to_id);
      if (knownIds.has(from) || knownIds.has(to)) {
        addEdge({ from, to, relation: String(link.relation) });
      }
    }

    const pendingIds = Array.from(knownIds).filter((id) => !nodes.has(id));
    if (pendingIds.length > 0) {
      const expandedNodes = await this.graphNodesByIds(pendingIds);
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

  protected async projectGraphLinkRows(projectId: string): Promise<Row[]> {
    return await this.db("links")
      .select("id", "project_id", "from_id", "to_id", "relation")
      .where("project_id", projectId)
      .orderBy("created_at", "desc");
  }

  protected async graphNodesByIds(ids: string[]): Promise<GraphNode[]> {
    const uniqueIds = Array.from(new Set(ids.filter((id) => id.length > 0)));
    if (uniqueIds.length === 0) {
      return [];
    }

    // Events are deliberately excluded here too — see the comment in
    // projectGraph. Without this, a link that happened to reference an event
    // id could reintroduce event nodes through BFS expansion.
    const [projects, items, tasks, decisions, artifacts] = await Promise.all([
      this.db("projects").select("id", "slug", "title", "status", "created_by", "created_at").whereIn("id", uniqueIds),
      this.db("items").select("id", "title", "status", "type", "project_id", "created_by", "created_at").whereIn("id", uniqueIds),
      this.db("tasks").select("id", "title", "status", "project_id", "created_by", "created_at", "milestone", "assignee_user_id").whereIn("id", uniqueIds),
      this.db("decisions").select("id", "title", "status", "project_id", "created_by", "created_at", "milestone", "assignee_user_id").whereIn("id", uniqueIds),
      this.db("artifacts").select("id", "title", "status", "project_id", "path", "created_by", "created_at").whereIn("id", uniqueIds)
    ]);

    return [
      ...projects.map((row) => graphNodeOut("PROJECT", row)),
      ...items.map((row) => graphNodeOut("MEMORY", row)),
      ...tasks.map((row) => graphNodeOut("TASK", row)),
      ...decisions.map((row) => graphNodeOut("DECISION", row)),
      ...artifacts.map((row) => graphNodeOut("ARTIFACT", row))
    ];
  }

  };
}
