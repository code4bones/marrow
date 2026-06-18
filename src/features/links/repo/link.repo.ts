import type { Db } from "../../../shared/db/connection.js";
import type { LinkDirection, LinkRecord } from "../model/types.js";

interface LinkRow {
  id: string;
  project_id: string | null;
  from_id: string;
  to_id: string;
  relation: string;
  created_at: string;
}

function mapLink(row: LinkRow): LinkRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    fromId: row.from_id,
    toId: row.to_id,
    relation: row.relation,
    createdAt: row.created_at
  };
}

export class LinkRepo {
  constructor(private readonly db: Db) {}

  create(link: LinkRecord): LinkRecord {
    this.db
      .prepare(
        `INSERT INTO links (id, project_id, from_id, to_id, relation, created_at)
         VALUES (@id, @projectId, @fromId, @toId, @relation, @createdAt)`
      )
      .run(link);
    return link;
  }

  list(recordId: string, direction: LinkDirection): LinkRecord[] {
    const condition =
      direction === "from"
        ? "from_id = @recordId"
        : direction === "to"
          ? "to_id = @recordId"
          : "(from_id = @recordId OR to_id = @recordId)";

    const rows = this.db
      .prepare(`SELECT * FROM links WHERE ${condition} ORDER BY created_at DESC`)
      .all({ recordId }) as LinkRow[];

    return rows.map(mapLink);
  }

  recordExists(recordId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS found FROM (
           SELECT id FROM projects WHERE id = @recordId
           UNION ALL SELECT id FROM items WHERE id = @recordId
           UNION ALL SELECT id FROM tasks WHERE id = @recordId
           UNION ALL SELECT id FROM decisions WHERE id = @recordId
           UNION ALL SELECT id FROM events WHERE id = @recordId
           UNION ALL SELECT id FROM links WHERE id = @recordId
         ) LIMIT 1`
      )
      .get({ recordId }) as { found: number } | undefined;

    return Boolean(row);
  }
}
