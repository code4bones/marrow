import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fail, ok, asMcpResult } from "../../../shared/mcp/tool-response.js";
import {
  createProjectSchema,
  listProjectsSchema,
  projectLookupSchema
} from "../model/schema.js";
import type { ProjectService } from "../service/project.service.js";

export function registerProjectTools(server: McpServer, projects: ProjectService): void {
  server.registerTool(
    "project.create",
    {
      description:
        "Create a durable project scope for project-specific memory. Use this during setup when the repository or work context is not registered yet. After creating it, call project.set_current before creating project tasks, decisions, or memory.",
      inputSchema: createProjectSchema.shape
    },
    async (input) => {
      try {
        const project = projects.create(createProjectSchema.parse(input));
        return asMcpResult(ok(`Project ${project.id} created.`, { project }));
      } catch (error) {
        return asMcpResult(fail(error));
      }
    }
  );

  server.registerTool(
    "project.list",
    {
      description:
        "List registered project scopes, optionally filtered by status. Use this when you need to discover available projects before choosing or setting the current project.",
      inputSchema: listProjectsSchema.shape
    },
    async (input) => {
      try {
        const parsed = listProjectsSchema.parse(input);
        return asMcpResult(ok("Projects listed.", { projects: projects.list(parsed.status) }));
      } catch (error) {
        return asMcpResult(fail(error));
      }
    }
  );

  server.registerTool(
    "project.get",
    {
      description:
        "Get one project by id or slug. Use this to inspect project metadata before creating scoped records or when a tool response references a project id.",
      inputSchema: projectLookupSchema.shape
    },
    async (input) => {
      try {
        const project = projects.get(projectLookupSchema.parse(input));
        return asMcpResult(ok(`Project ${project.id} loaded.`, { project }));
      } catch (error) {
        return asMcpResult(fail(error));
      }
    }
  );

  server.registerTool(
    "project.set_current",
    {
      description:
        "Set the current project used by tools when their optional project argument is omitted. Use this after project.create/project.list and before task, decision, memory, search, or preflight workflows.",
      inputSchema: projectLookupSchema.shape
    },
    async (input) => {
      try {
        const currentProject = projects.setCurrent(projectLookupSchema.parse(input));
        return asMcpResult(ok(`Current project set to ${currentProject.id}.`, { currentProject }));
      } catch (error) {
        return asMcpResult(fail(error));
      }
    }
  );

  server.registerTool(
    "project.current",
    {
      description:
        "Return the current project. Use this as the first check in an agent session; if it fails, call project.list or project.create, then project.set_current.",
      inputSchema: {}
    },
    async () => {
      try {
        const project = projects.current();
        return asMcpResult(ok(`Current project is ${project.id}.`, { project }));
      } catch (error) {
        return asMcpResult(fail(error));
      }
    }
  );
}
