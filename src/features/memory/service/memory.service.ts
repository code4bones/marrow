import type { Db } from "../../../shared/db/connection.js";
import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import { commonItemPrefix, nextId, projectKeyFromId } from "../../../shared/ids/id.service.js";
import type { ProjectService } from "../../projects/service/project.service.js";
import type {
  CreateMemoryInput,
  MemoryItem,
  MemorySearchResult,
  SearchMemoryInput,
  UpdateMemoryInput
} from "../model/types.js";
import { MemoryRepo } from "../repo/memory.repo.js";

export class MemoryService {
  constructor(
    private readonly db: Db,
    private readonly repo: MemoryRepo,
    private readonly projects: ProjectService
  ) {}

  create(input: CreateMemoryInput): MemoryItem {
    const now = nowIso();
    const common = input.common === true || input.project === null;
    const project = common ? undefined : this.projects.resolveProject(input.project);
    const prefix = project ? `I-${projectKeyFromId(project.id)}` : commonItemPrefix(input.type);
    const item: MemoryItem = {
      id: nextId(this.db, "items", prefix),
      projectId: project?.id ?? null,
      type: input.type,
      title: input.title,
      body: input.body,
      status: input.status ?? "active",
      tags: input.tags ?? [],
      createdAt: now,
      updatedAt: now
    };

    return this.repo.create(item);
  }

  get(id: string): MemoryItem {
    const item = this.repo.get(id);
    if (!item) {
      throw new AppError("ITEM_NOT_FOUND", `Memory item ${id} does not exist.`, { id });
    }

    return item;
  }

  update(input: UpdateMemoryInput): MemoryItem {
    const current = this.get(input.id);
    return this.repo.update({
      ...current,
      title: input.title ?? current.title,
      body: input.body ?? current.body,
      status: input.status ?? current.status,
      tags: input.tags ?? current.tags,
      updatedAt: nowIso()
    });
  }

  search(input: SearchMemoryInput): MemorySearchResult[] {
    const includeCommon = input.includeCommon ?? true;
    const project = input.project ? this.projects.resolveProject(input.project) : this.tryCurrentProject();
    const ftsQuery = buildFtsQuery(input.query);

    if (!project && !includeCommon) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "Search requires a project or includeCommon=true.");
    }

    return this.repo.search({
      ftsQuery,
      projectId: project?.id,
      includeCommon,
      type: input.type,
      status: input.status,
      limit: input.limit ?? 10
    });
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

export function buildFtsQuery(query: string): string {
  const tokens = query
    .trim()
    .split(/[^A-Za-z0-9_]+/)
    .filter(Boolean)
    .slice(0, 12);

  if (tokens.length === 0) {
    throw new AppError("VALIDATION_ERROR", "Search query must contain searchable terms.");
  }

  return tokens.map((token) => `${token}*`).join(" OR ");
}
