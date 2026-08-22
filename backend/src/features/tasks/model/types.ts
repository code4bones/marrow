export type TaskStatus = "todo" | "doing" | "blocked" | "review" | "changes_requested" | "done" | "cancelled";

export interface Task {
  id: string;
  projectId: string;
  title: string;
  status: TaskStatus;
  milestone: string | null;
  priority: number;
  scope: string | null;
  acceptance: string | null;
  allowedFiles: string[];
  forbiddenFiles: string[];
  dependsOn: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  project?: string;
  title: string;
  milestone?: string;
  priority?: number;
  scope?: string;
  acceptance?: string;
  allowedFiles?: string[];
  forbiddenFiles?: string[];
  dependsOn?: string[];
  notes?: string;
}

export interface ListTasksInput {
  project?: string | null;
  status?: TaskStatus;
  milestone?: string;
  limit?: number;
}

export interface UpdateTaskStatusInput {
  id: string;
  status: TaskStatus;
  note?: string;
}
