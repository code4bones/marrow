import type { Db } from "../../../shared/db/connection.js";
import { parseJsonArray, serializeJsonArray } from "../../../shared/json.js";
import type { Task, TaskStatus } from "../model/types.js";

interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  status: TaskStatus;
  milestone: string | null;
  priority: number;
  scope: string | null;
  acceptance: string | null;
  allowed_files: string | null;
  forbidden_files: string | null;
  depends_on: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    milestone: row.milestone,
    priority: row.priority,
    scope: row.scope,
    acceptance: row.acceptance,
    allowedFiles: parseJsonArray(row.allowed_files),
    forbiddenFiles: parseJsonArray(row.forbidden_files),
    dependsOn: parseJsonArray(row.depends_on),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function dbTask(task: Task) {
  return {
    ...task,
    allowedFiles: serializeJsonArray(task.allowedFiles),
    forbiddenFiles: serializeJsonArray(task.forbiddenFiles),
    dependsOn: serializeJsonArray(task.dependsOn)
  };
}

export class TaskRepo {
  constructor(private readonly db: Db) {}

  create(task: Task): Task {
    this.db
      .prepare(
        `INSERT INTO tasks
          (id, project_id, title, status, milestone, priority, scope, acceptance,
           allowed_files, forbidden_files, depends_on, notes, created_at, updated_at)
         VALUES
          (@id, @projectId, @title, @status, @milestone, @priority, @scope, @acceptance,
           @allowedFiles, @forbiddenFiles, @dependsOn, @notes, @createdAt, @updatedAt)`
      )
      .run(dbTask(task));
    return task;
  }

  get(id: string): Task | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
    return row ? mapTask(row) : null;
  }

  list(params: {
    projectId: string;
    status?: TaskStatus;
    milestone?: string;
    limit: number;
  }): Task[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM tasks
         WHERE project_id = @projectId
           AND (@status IS NULL OR status = @status)
           AND (@milestone IS NULL OR milestone = @milestone)
         ORDER BY priority ASC, created_at ASC
         LIMIT @limit`
      )
      .all({
        projectId: params.projectId,
        status: params.status ?? null,
        milestone: params.milestone ?? null,
        limit: params.limit
      }) as TaskRow[];

    return rows.map(mapTask);
  }

  next(projectId: string): Task | null {
    const row = this.db
      .prepare(
        `SELECT * FROM tasks
         WHERE project_id = ? AND status = 'todo'
         ORDER BY priority ASC, created_at ASC
         LIMIT 1`
      )
      .get(projectId) as TaskRow | undefined;
    return row ? mapTask(row) : null;
  }

  update(task: Task): Task {
    this.db
      .prepare(
        `UPDATE tasks
         SET title = @title,
             status = @status,
             milestone = @milestone,
             priority = @priority,
             scope = @scope,
             acceptance = @acceptance,
             allowed_files = @allowedFiles,
             forbidden_files = @forbiddenFiles,
             depends_on = @dependsOn,
             notes = @notes,
             updated_at = @updatedAt
         WHERE id = @id`
      )
      .run(dbTask(task));
    return task;
  }
}
