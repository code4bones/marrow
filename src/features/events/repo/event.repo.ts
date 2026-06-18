import type { Db } from "../../../shared/db/connection.js";
import type { EventRecord } from "../model/types.js";

interface EventRow {
  id: string;
  project_id: string | null;
  type: string;
  title: string | null;
  body: string | null;
  related_id: string | null;
  created_at: string;
}

function mapEvent(row: EventRow): EventRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    title: row.title,
    body: row.body,
    relatedId: row.related_id,
    createdAt: row.created_at
  };
}

export class EventRepo {
  constructor(private readonly db: Db) {}

  record(event: EventRecord): EventRecord {
    this.db
      .prepare(
        `INSERT INTO events (id, project_id, type, title, body, related_id, created_at)
         VALUES (@id, @projectId, @type, @title, @body, @relatedId, @createdAt)`
      )
      .run(event);
    return event;
  }

  list(params: { projectId?: string | null; relatedId?: string; limit: number }): EventRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM events
         WHERE (@projectIdMissing = 1 OR project_id IS @projectId)
           AND (@relatedId IS NULL OR related_id = @relatedId)
         ORDER BY created_at DESC
         LIMIT @limit`
      )
      .all({
        projectIdMissing: params.projectId === undefined ? 1 : 0,
        projectId: params.projectId ?? null,
        relatedId: params.relatedId ?? null,
        limit: params.limit
      }) as EventRow[];

    return rows.map(mapEvent);
  }
}
