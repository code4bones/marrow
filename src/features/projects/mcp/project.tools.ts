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
      description: "Create a new memory project.",
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
      description: "List memory projects.",
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
      description: "Get a memory project by id or slug.",
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
      description: "Set the current memory project.",
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
      description: "Return the current memory project.",
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
