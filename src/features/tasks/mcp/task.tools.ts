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
      description: "Create an executable project task.",
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
      description: "List project tasks.",
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
      description: "Get a task by id.",
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
      description: "Return the next todo task for a project.",
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
      description: "Update task status and record an event.",
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
