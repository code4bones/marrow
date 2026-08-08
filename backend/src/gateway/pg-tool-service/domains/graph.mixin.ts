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

  protected async projectGraphLinkRows(projectId: string, ids: string[]): Promise<Row[]> {
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

  protected missingGraphEndpointIds(edges: Map<string, GraphEdge>, nodes: Map<string, GraphNode>): string[] {
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

  protected async graphNodesByIds(ids: string[]): Promise<GraphNode[]> {
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

  };
}
