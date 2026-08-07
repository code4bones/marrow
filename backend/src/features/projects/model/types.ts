export type ProjectStatus = "active" | "paused" | "archived";

export interface Project {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: ProjectStatus;
  rootPath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  slug: string;
  title: string;
  description?: string;
  rootPath?: string;
}

export interface ProjectLookup {
  id?: string;
  slug?: string;
}
