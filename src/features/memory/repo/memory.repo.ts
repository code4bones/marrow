import type { Db } from "../../../shared/db/connection.js";
import { parseJsonArray, serializeJsonArray } from "../../../shared/json.js";
import type { ItemStatus, MemoryItem, MemorySearchResult } from "../model/types.js";

interface ItemRow {
  id: string;
  project_id: string | null;
  type: string;
  title: string;
  body: string;
  status: ItemStatus;
  tags: string | null;
  created_at: string;
  updated_at: string;
}

interface SearchRow {
  id: string;
  scope: "project" | "common";
  type: string;
  title: string;
  body: string;
  status: ItemStatus;
  tags: string | null;
  rank: number;
}

function excerpt(body: string): string {
  return body.length <= 220 ? body : `${body.slice(0, 217)}...`;
}

function mapItem(row: ItemRow): MemoryItem {
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    title: row.title,
    body: row.body,
    status: row.status,
    tags: parseJsonArray(row.tags),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSearch(row: SearchRow): MemorySearchResult {
  return {
    id: row.id,
    scope: row.scope,
    type: row.type,
    title: row.title,
    excerpt: excerpt(row.body),
    status: row.status,
    tags: parseJsonArray(row.tags),
    rank: row.rank
  };
}

export class MemoryRepo {
  constructor(private readonly db: Db) {}

  create(item: MemoryItem): MemoryItem {
    this.db
      .prepare(
        `INSERT INTO items
          (id, project_id, type, title, body, status, tags, created_at, updated_at)
         VALUES
          (@id, @projectId, @type, @title, @body, @status, @tags, @createdAt, @updatedAt)`
      )
      .run({ ...item, tags: serializeJsonArray(item.tags) });
    return item;
  }

  get(id: string): MemoryItem | null {
    const row = this.db.prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow | undefined;
    return row ? mapItem(row) : null;
  }

  update(item: MemoryItem): MemoryItem {
    this.db
      .prepare(
        `UPDATE items
         SET title = @title,
             body = @body,
             status = @status,
             tags = @tags,
             updated_at = @updatedAt
         WHERE id = @id`
      )
      .run({ ...item, tags: serializeJsonArray(item.tags) });
    return item;
  }

  search(params: {
    ftsQuery: string;
    projectId?: string;
    includeCommon: boolean;
    type?: string;
    status?: ItemStatus;
    limit: number;
  }): MemorySearchResult[] {
    const rows = this.db
      .prepare(
        `SELECT
           i.id,
           CASE WHEN i.project_id IS NULL THEN 'common' ELSE 'project' END AS scope,
           i.type,
           i.title,
           i.body,
           i.status,
           i.tags,
           bm25(items_fts) AS rank
         FROM items_fts
         JOIN items i ON i.id = items_fts.id
         WHERE items_fts MATCH @ftsQuery
           AND (
             (@projectId IS NOT NULL AND i.project_id = @projectId)
             OR (@includeCommon = 1 AND i.project_id IS NULL)
           )
           AND (@type IS NULL OR i.type = @type)
           AND (@status IS NULL OR i.status = @status)
         ORDER BY
           CASE WHEN i.project_id IS NULL THEN 1 ELSE 0 END,
           rank
         LIMIT @limit`
      )
      .all({
        ...params,
        projectId: params.projectId ?? null,
        includeCommon: params.includeCommon ? 1 : 0,
        type: params.type ?? null,
        status: params.status ?? null
      }) as SearchRow[];

    return rows.map(mapSearch);
  }
}
