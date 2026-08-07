import type { Db } from "../../../shared/db/connection.js";
import type { Project, ProjectStatus } from "../model/types.js";

interface ProjectRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: ProjectStatus;
  root_path: string | null;
  created_at: string;
  updated_at: string;
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    status: row.status,
    rootPath: row.root_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class ProjectRepo {
  constructor(private readonly db: Db) {}

  create(project: Project): Project {
    this.db
      .prepare(
        `INSERT INTO projects
          (id, slug, title, description, status, root_path, created_at, updated_at)
         VALUES
          (@id, @slug, @title, @description, @status, @rootPath, @createdAt, @updatedAt)`
      )
      .run(project);
    return project;
  }

  list(status?: ProjectStatus): Project[] {
    const rows = status
      ? this.db.prepare("SELECT * FROM projects WHERE status = ? ORDER BY slug").all(status)
      : this.db.prepare("SELECT * FROM projects ORDER BY slug").all();
    return (rows as ProjectRow[]).map(mapProject);
  }

  getById(id: string): Project | null {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as
      | ProjectRow
      | undefined;
    return row ? mapProject(row) : null;
  }

  getBySlug(slug: string): Project | null {
    const row = this.db.prepare("SELECT * FROM projects WHERE slug = ?").get(slug) as
      | ProjectRow
      | undefined;
    return row ? mapProject(row) : null;
  }

  setCurrentProjectId(projectId: string, updatedAt: string): void {
    this.db
      .prepare(
        `INSERT INTO kv (key, value, updated_at)
         VALUES ('current_project_id', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(projectId, updatedAt);
  }

  getStoredCurrentProjectId(): string | null {
    const row = this.db
      .prepare("SELECT value FROM kv WHERE key = 'current_project_id'")
      .get() as { value: string } | undefined;
    return row?.value ?? null;
  }
}
