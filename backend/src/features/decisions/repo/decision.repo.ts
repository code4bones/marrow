import type { Db } from "../../../shared/db/connection.js";
import { parseJsonArray, serializeJsonArray } from "../../../shared/json.js";
import type { Decision, DecisionStatus } from "../model/types.js";

interface DecisionRow {
  id: string;
  project_id: string | null;
  title: string;
  status: DecisionStatus;
  context: string | null;
  decision: string;
  rationale: string | null;
  consequences: string | null;
  tags: string | null;
  supersedes_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapDecision(row: DecisionRow): Decision {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    context: row.context,
    decision: row.decision,
    rationale: row.rationale,
    consequences: row.consequences,
    tags: parseJsonArray(row.tags),
    supersedesId: row.supersedes_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function dbDecision(decision: Decision) {
  return {
    ...decision,
    tags: serializeJsonArray(decision.tags)
  };
}

export class DecisionRepo {
  constructor(private readonly db: Db) {}

  create(decision: Decision): Decision {
    this.db
      .prepare(
        `INSERT INTO decisions
          (id, project_id, title, status, context, decision, rationale, consequences,
           tags, supersedes_id, created_at, updated_at)
         VALUES
          (@id, @projectId, @title, @status, @context, @decision, @rationale, @consequences,
           @tags, @supersedesId, @createdAt, @updatedAt)`
      )
      .run(dbDecision(decision));
    return decision;
  }

  get(id: string): Decision | null {
    const row = this.db.prepare("SELECT * FROM decisions WHERE id = ?").get(id) as
      | DecisionRow
      | undefined;
    return row ? mapDecision(row) : null;
  }

  markSuperseded(id: string, updatedAt: string): void {
    this.db
      .prepare("UPDATE decisions SET status = 'superseded', updated_at = ? WHERE id = ?")
      .run(updatedAt, id);
  }

  list(params: {
    projectId?: string;
    includeCommon: boolean;
    status?: DecisionStatus;
    limit: number;
  }): Decision[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM decisions
         WHERE (
             (@projectId IS NOT NULL AND project_id = @projectId)
             OR (@includeCommon = 1 AND project_id IS NULL)
           )
           AND (@status IS NULL OR status = @status)
         ORDER BY
           CASE WHEN project_id IS NULL THEN 1 ELSE 0 END,
           created_at DESC
         LIMIT @limit`
      )
      .all({
        projectId: params.projectId ?? null,
        includeCommon: params.includeCommon ? 1 : 0,
        status: params.status ?? null,
        limit: params.limit
      }) as DecisionRow[];

    return rows.map(mapDecision);
  }
}
