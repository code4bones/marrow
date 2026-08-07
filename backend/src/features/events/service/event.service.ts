import type { Db } from "../../../shared/db/connection.js";
import { nowIso } from "../../../shared/dates.js";
import { nextId, projectKeyFromId } from "../../../shared/ids/id.service.js";
import type { ProjectService } from "../../projects/service/project.service.js";
import type { EventRecord, ListEventsInput, RecordEventInput } from "../model/types.js";
import { EventRepo } from "../repo/event.repo.js";

export class EventService {
  constructor(
    private readonly db: Db,
    private readonly repo: EventRepo,
    private readonly projects: ProjectService
  ) {}

  record(input: RecordEventInput): EventRecord {
    const project = input.project === null ? undefined : this.projects.resolveProject(input.project);
    const prefix = project ? `E-${projectKeyFromId(project.id)}` : "E-COMMON";
    const event: EventRecord = {
      id: nextId(this.db, "events", prefix),
      projectId: project?.id ?? null,
      type: input.type,
      title: input.title ?? null,
      body: input.body ?? null,
      relatedId: input.relatedId ?? null,
      createdAt: nowIso()
    };

    return this.repo.record(event);
  }

  list(input: ListEventsInput = {}): EventRecord[] {
    const project =
      input.project === null
        ? null
        : input.project
          ? this.projects.resolveProject(input.project)
          : undefined;

    return this.repo.list({
      projectId: project === null ? null : project?.id,
      relatedId: input.relatedId,
      limit: input.limit ?? 20
    });
  }

  recordForProject(projectId: string | null, input: Omit<RecordEventInput, "project">): EventRecord {
    const projectKey = projectId ? projectKeyFromId(projectId) : "COMMON";
    const event: EventRecord = {
      id: nextId(this.db, "events", `E-${projectKey}`),
      projectId,
      type: input.type,
      title: input.title ?? null,
      body: input.body ?? null,
      relatedId: input.relatedId ?? null,
      createdAt: nowIso()
    };

    return this.repo.record(event);
  }
}
