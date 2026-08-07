import type { Db } from "../../../shared/db/connection.js";
import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import { nextId, projectKeyFromId } from "../../../shared/ids/id.service.js";
import type { EventService } from "../../events/service/event.service.js";
import type { ProjectService } from "../../projects/service/project.service.js";
import type { CreateLinkInput, LinkRecord, ListLinksInput } from "../model/types.js";
import { LinkRepo } from "../repo/link.repo.js";

export class LinkService {
  constructor(
    private readonly db: Db,
    private readonly repo: LinkRepo,
    private readonly projects: ProjectService,
    private readonly events: EventService
  ) {}

  create(input: CreateLinkInput): LinkRecord {
    this.assertRecordExists(input.fromId);
    this.assertRecordExists(input.toId);

    const project = input.project === null ? undefined : this.projects.resolveProject(input.project);
    const link: LinkRecord = {
      id: nextId(this.db, "links", project ? `L-${projectKeyFromId(project.id)}` : "L-COMMON"),
      projectId: project?.id ?? null,
      fromId: input.fromId,
      toId: input.toId,
      relation: input.relation,
      createdAt: nowIso()
    };

    this.repo.create(link);
    this.events.recordForProject(link.projectId, {
      type: "link.created",
      title: `Link created: ${link.fromId} ${link.relation} ${link.toId}`,
      relatedId: link.id
    });
    return link;
  }

  list(input: ListLinksInput): LinkRecord[] {
    return this.repo.list(input.id, input.direction ?? "both");
  }

  private assertRecordExists(recordId: string): void {
    if (!this.repo.recordExists(recordId)) {
      throw new AppError("LINK_NOT_FOUND", `Linked record ${recordId} does not exist.`, {
        recordId
      });
    }
  }
}
