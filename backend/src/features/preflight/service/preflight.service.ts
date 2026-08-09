import type { DecisionService } from "../../decisions/service/decision.service.js";
import type { EventService } from "../../events/service/event.service.js";
import type { MemoryService } from "../../memory/service/memory.service.js";
import type { ProjectService } from "../../projects/service/project.service.js";
import type { TaskService } from "../../tasks/service/task.service.js";
import type { PreflightInput, PreflightResult } from "../model/types.js";

export class PreflightService {
  constructor(
    private readonly projects: ProjectService,
    private readonly tasks: TaskService,
    private readonly decisions: DecisionService,
    private readonly memory: MemoryService,
    private readonly events: EventService
  ) {}

  run(input: PreflightInput): PreflightResult {
    const includeCommon = input.includeCommon ?? true;
    const limits = {
      decisions: input.limits?.decisions ?? 10,
      items: input.limits?.items ?? 10,
      failedAttempts: input.limits?.failedAttempts ?? 5,
      events: input.limits?.events ?? 10
    };

    const task = this.tasks.get(input.taskId);
    const project = this.projects.get({ id: task.projectId });
    const query = taskQuery(task.title, task.scope, task.acceptance);
    const faultQuery = task.title || query;

    const relevantDecisions = this.decisions.list({
      project: project.id,
      includeCommon,
      status: "current",
      limit: limits.decisions
    });

    const commonRules = [
      ...this.memory.search({
        query: "preflight task scope acceptance diffs failed attempts",
        project: project.id,
        includeCommon,
        type: "agent_rule",
        status: "current",
        limit: Math.ceil(limits.items / 2)
      }),
      ...this.memory.search({
        query: "preflight task scope acceptance diffs failed attempts",
        project: project.id,
        includeCommon,
        type: "workflow_rule",
        status: "current",
        limit: Math.floor(limits.items / 2)
      })
    ].filter((item) => item.scope === "common");

    const relatedItems = this.memory.search({
      query,
      project: project.id,
      includeCommon,
      status: "current",
      limit: limits.items
    });

    const failedAttempts = this.memory.search({
      query: faultQuery,
      project: project.id,
      includeCommon,
      type: "failed_attempt",
      status: "current",
      limit: limits.failedAttempts
    });

    const recentEvents = this.events.list({
      project: project.id,
      limit: limits.events
    });

    return {
      project: {
        id: project.id,
        slug: project.slug,
        title: project.title,
        description: project.description,
        rootPath: project.rootPath
      },
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        scope: task.scope,
        acceptance: task.acceptance,
        allowedFiles: task.allowedFiles,
        forbiddenFiles: task.forbiddenFiles,
        dependsOn: task.dependsOn
      },
      relevantDecisions,
      commonRules,
      relatedItems,
      failedAttempts,
      knownFaults: failedAttempts,
      recentEvents,
      summary: "Use this context before editing files. Treat knownFaults as stop-signals before repeating an approach."
    };
  }
}

function taskQuery(...parts: Array<string | null>): string {
  const text = parts.filter(Boolean).join(" ").trim();
  return text || "task";
}
