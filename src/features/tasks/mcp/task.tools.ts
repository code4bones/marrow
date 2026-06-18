import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asMcpResult, fail, ok } from "../../../shared/mcp/tool-response.js";
import {
  createTaskSchema,
  getTaskSchema,
  listTasksSchema,
  nextTaskSchema,
  updateTaskStatusSchema
} from "../model/schema.js";
import type { TaskService } from "../service/task.service.js";

export function registerTaskTools(server: McpServer, tasks: TaskService): void {
  server.registerTool(
    "task.create",
    {
      description:
        "Create an executable project task with scope, acceptance criteria, allowed files, forbidden files, and dependencies. Use before implementation work so agents can run preflight against a concrete task.",
      inputSchema: createTaskSchema.shape
    },
    async (input) => {
      try {
        const task = tasks.create(createTaskSchema.parse(input));
        return asMcpResult(ok(`Task ${task.id} created.`, { task }));
      } catch (error) {
        return asMcpResult(fail(error));
      }
    }
  );

  server.registerTool(
    "task.list",
    {
      description:
        "List tasks for a project, optionally filtered by status or milestone. Use to inspect backlog or find active/todo work before choosing a task.",
      inputSchema: listTasksSchema.shape
    },
    async (input) => {
      try {
        const taskList = tasks.list(listTasksSchema.parse(input));
        return asMcpResult(ok(`${taskList.length} task(s) listed.`, { tasks: taskList }));
      } catch (error) {
        return asMcpResult(fail(error));
      }
    }
  );

  server.registerTool(
    "task.get",
    {
      description:
        "Get a task by id. Use when you already have a task id and need full scope, acceptance criteria, allowed/forbidden files, dependencies, notes, and status.",
      inputSchema: getTaskSchema.shape
    },
    async (input) => {
      try {
        const parsed = getTaskSchema.parse(input);
        const task = tasks.get(parsed.id);
        return asMcpResult(ok(`Task ${task.id} loaded.`, { task }));
      } catch (error) {
        return asMcpResult(fail(error));
      }
    }
  );

  server.registerTool(
    "task.next",
    {
      description:
        "Return the next todo task for a project using priority and creation order. Typical chain: project.current -> task.next -> preflight -> implementation.",
      inputSchema: nextTaskSchema.shape
    },
    async (input) => {
      try {
        const task = tasks.next(nextTaskSchema.parse(input));
        return asMcpResult(ok(task ? `Next task is ${task.id}.` : "No todo task found.", { task }));
      } catch (error) {
        return asMcpResult(fail(error));
      }
    }
  );

  server.registerTool(
    "task.update_status",
    {
      description:
        "Update task status after workflow transitions. Use doing when starting, blocked when blocked, done when acceptance criteria are met, cancelled when abandoned. Records task lifecycle events automatically.",
      inputSchema: updateTaskStatusSchema.shape
    },
    async (input) => {
      try {
        const task = tasks.updateStatus(updateTaskStatusSchema.parse(input));
        return asMcpResult(ok(`Task ${task.id} status updated.`, { task }));
      } catch (error) {
        return asMcpResult(fail(error));
      }
    }
  );
}
