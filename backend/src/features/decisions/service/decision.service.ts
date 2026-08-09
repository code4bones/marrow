import type { Db } from "../../../shared/db/connection.js";
import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import { nextId, projectKeyFromId } from "../../../shared/ids/id.service.js";
import type { EventService } from "../../events/service/event.service.js";
import type { ProjectService } from "../../projects/service/project.service.js";
import type { Decision, ListDecisionsInput, RecordDecisionInput } from "../model/types.js";
import { DecisionRepo } from "../repo/decision.repo.js";

export class DecisionService {
  constructor(
    private readonly db: Db,
    private readonly repo: DecisionRepo,
    private readonly projects: ProjectService,
    private readonly events: EventService
  ) {}

  record(input: RecordDecisionInput): Decision {
    const project = input.project === null ? undefined : this.projects.resolveProject(input.project);
    const now = nowIso();
    const decision: Decision = {
      id: nextId(this.db, "decisions", project ? `D-${projectKeyFromId(project.id)}` : "D-COMMON"),
      projectId: project?.id ?? null,
      title: input.title,
      status: input.status ?? "current",
      context: input.context ?? null,
      decision: input.decision,
      rationale: input.rationale ?? null,
      consequences: input.consequences ?? null,
      tags: input.tags ?? [],
      supersedesId: input.supersedesId ?? null,
      createdAt: now,
      updatedAt: now
    };

    this.repo.create(decision);
    if (decision.supersedesId) {
      this.repo.markSuperseded(decision.supersedesId, nowIso());
    }

    this.events.recordForProject(decision.projectId, {
      type: "decision.recorded",
      title: `Decision recorded: ${decision.title}`,
      relatedId: decision.id
    });
    return decision;
  }

  list(input: ListDecisionsInput = {}): Decision[] {
    const includeCommon = input.includeCommon ?? true;
    const project = input.project ? this.projects.resolveProject(input.project) : this.tryCurrentProject();
    return this.repo.list({
      projectId: project?.id,
      includeCommon,
      status: input.status,
      limit: input.limit ?? 20
    });
  }

  get(id: string): Decision {
    const decision = this.repo.get(id);
    if (!decision) {
      throw new AppError("DECISION_NOT_FOUND", `Decision ${id} does not exist.`, { id });
    }
    return decision;
  }

  private tryCurrentProject() {
    try {
      return this.projects.current();
    } catch (error) {
      if (error instanceof AppError && error.code === "CURRENT_PROJECT_NOT_SET") {
        return null;
      }
      throw error;
    }
  }
}
