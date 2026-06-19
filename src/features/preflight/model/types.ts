import type { Decision } from "../../decisions/model/types.js";
import type { EventRecord } from "../../events/model/types.js";
import type { MemorySearchResult } from "../../memory/model/types.js";
import type { Project } from "../../projects/model/types.js";
import type { Task } from "../../tasks/model/types.js";

export interface PreflightLimits {
  decisions?: number;
  items?: number;
  failedAttempts?: number;
  events?: number;
}

export interface PreflightInput {
  taskId: string;
  includeCommon?: boolean;
  limits?: PreflightLimits;
}

export interface PreflightResult {
  project: Pick<Project, "id" | "slug" | "title" | "description" | "rootPath">;
  task: Pick<
    Task,
    | "id"
    | "title"
    | "status"
    | "scope"
    | "acceptance"
    | "allowedFiles"
    | "forbiddenFiles"
    | "dependsOn"
  >;
  relevantDecisions: Decision[];
  commonRules: MemorySearchResult[];
  relatedItems: MemorySearchResult[];
  failedAttempts: MemorySearchResult[];
  knownFaults: MemorySearchResult[];
  recentEvents: EventRecord[];
  summary: string;
}
