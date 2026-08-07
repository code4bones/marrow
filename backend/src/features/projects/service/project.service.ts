import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import { createProjectId } from "../../../shared/ids/id.service.js";
import type { CreateProjectInput, Project, ProjectLookup, ProjectStatus } from "../model/types.js";
import { ProjectRepo } from "../repo/project.repo.js";

export type ProjectCreatedRecorder = (project: Project) => void;

export class ProjectService {
  private projectCreatedRecorder: ProjectCreatedRecorder | undefined;

  constructor(
    private readonly repo: ProjectRepo,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  setProjectCreatedRecorder(recorder: ProjectCreatedRecorder): void {
    this.projectCreatedRecorder = recorder;
  }

  create(input: CreateProjectInput): Project {
    const now = nowIso();
    const baseId = createProjectId(input.slug);
    const id = this.uniqueProjectId(baseId);
    const project = this.repo.create({
      id,
      slug: input.slug,
      title: input.title,
      description: input.description ?? null,
      status: "active",
      rootPath: input.rootPath ?? null,
      createdAt: now,
      updatedAt: now
    });
    this.projectCreatedRecorder?.(project);
    return project;
  }

  list(status?: ProjectStatus): Project[] {
    return this.repo.list(status);
  }

  get(lookup: ProjectLookup): Project {
    const project = lookup.id
      ? this.repo.getById(lookup.id)
      : lookup.slug
        ? this.repo.getBySlug(lookup.slug)
        : null;

    if (!project) {
      throw new AppError("PROJECT_NOT_FOUND", "Project does not exist.", { ...lookup });
    }

    return project;
  }

  setCurrent(lookup: ProjectLookup): Project {
    const project = this.get(lookup);
    this.repo.setCurrentProjectId(project.id, nowIso());
    return project;
  }

  current(): Project {
    const envProject = this.env.PROJECT_MEMORY_CURRENT_PROJECT;
    if (envProject) {
      return this.resolveProject(envProject);
    }

    const storedProjectId = this.repo.getStoredCurrentProjectId();
    if (!storedProjectId) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "Current project is not configured.");
    }

    return this.get({ id: storedProjectId });
  }

  resolveProject(project?: string | null): Project {
    if (project === null) {
      throw new AppError("PROJECT_NOT_FOUND", "Common scope has no project.");
    }

    if (!project) {
      return this.current();
    }

    return project.startsWith("P-") ? this.get({ id: project }) : this.get({ slug: project });
  }

  private uniqueProjectId(baseId: string): string {
    if (!this.repo.getById(baseId)) {
      return baseId;
    }

    for (let index = 2; index < 1000; index += 1) {
      const id = `${baseId}-${index}`;
      if (!this.repo.getById(id)) {
        return id;
      }
    }

    throw new AppError("VALIDATION_ERROR", "Could not create a unique project id.");
  }
}
