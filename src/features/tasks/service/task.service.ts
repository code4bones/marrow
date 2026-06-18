import type { Db } from "../../../shared/db/connection.js";
import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import { nextId, projectKeyFromId } from "../../../shared/ids/id.service.js";
import type { EventService } from "../../events/service/event.service.js";
import type { ProjectService } from "../../projects/service/project.service.js";
import type { CreateTaskInput, ListTasksInput, Task, UpdateTaskStatusInput } from "../model/types.js";
import { TaskRepo } from "../repo/task.repo.js";

export class TaskService {
  constructor(
    private readonly db: Db,
    private readonly repo: TaskRepo,
    private readonly projects: ProjectService,
    private readonly events: EventService
  ) {}

  create(input: CreateTaskInput): Task {
    const project = this.projects.resolveProject(input.project);
    const now = nowIso();
    const task: Task = {
      id: nextId(this.db, "tasks", `T-${projectKeyFromId(project.id)}`),
      projectId: project.id,
      title: input.title,
      status: "todo",
      milestone: input.milestone ?? null,
      priority: input.priority ?? 100,
      scope: input.scope ?? null,
      acceptance: input.acceptance ?? null,
      allowedFiles: input.allowedFiles ?? [],
      forbiddenFiles: input.forbiddenFiles ?? [],
      dependsOn: input.dependsOn ?? [],
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now
    };

    this.repo.create(task);
    this.events.recordForProject(project.id, {
      type: "task.created",
      title: `Task created: ${task.title}`,
      relatedId: task.id
    });
    return task;
  }

  list(input: ListTasksInput): Task[] {
    const project = this.projects.resolveProject(input.project);
    return this.repo.list({
      projectId: project.id,
      status: input.status,
      milestone: input.milestone,
      limit: input.limit ?? 20
    });
  }

  get(id: string): Task {
    const task = this.repo.get(id);
    if (!task) {
      throw new AppError("TASK_NOT_FOUND", `Task ${id} does not exist.`, { id });
    }
    return task;
  }

  next(input: { project?: string }): Task | null {
    const project = this.projects.resolveProject(input.project);
    return this.repo.next(project.id);
  }

  updateStatus(input: UpdateTaskStatusInput): Task {
    const current = this.get(input.id);
    const updated = this.repo.update({
      ...current,
      status: input.status,
      notes: appendNote(current.notes, input.note),
      updatedAt: nowIso()
    });

    this.events.recordForProject(updated.projectId, {
      type: eventTypeForStatus(input.status),
      title: `Task status changed: ${updated.title}`,
      body: input.note,
      relatedId: updated.id
    });

    return updated;
  }
}

function appendNote(current: string | null, note: string | undefined): string | null {
  if (!note) {
    return current;
  }

  return current ? `${current}\n\n${note}` : note;
}

function eventTypeForStatus(status: string): string {
  switch (status) {
    case "doing":
      return "task.started";
    case "done":
      return "task.completed";
    case "blocked":
      return "task.blocked";
    case "cancelled":
      return "task.cancelled";
    default:
      return "task.status_changed";
  }
}
