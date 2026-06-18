import type * as z from "zod/v4";
import { getDecisionSchema, listDecisionsSchema, recordDecisionSchema } from "../features/decisions/model/schema.js";
import { listEventsSchema, recordEventSchema } from "../features/events/model/schema.js";
import { createLinkSchema, listLinksSchema } from "../features/links/model/schema.js";
import {
  createMemorySchema,
  getMemorySchema,
  searchMemorySchema,
  updateMemorySchema
} from "../features/memory/model/schema.js";
import { preflightSchema } from "../features/preflight/model/schema.js";
import { createProjectSchema, listProjectsSchema, projectLookupSchema } from "../features/projects/model/schema.js";
import {
  createTaskSchema,
  getTaskSchema,
  listTasksSchema,
  nextTaskSchema,
  updateTaskStatusSchema
} from "../features/tasks/model/schema.js";

export interface GatewayToolSpec {
  name: string;
  description: string;
  schema: z.ZodObject;
}

export const gatewayToolSpecs: GatewayToolSpec[] = [
  {
    name: "project.create",
    description:
      "Create a durable shared project scope. In gateway mode this writes to PostgreSQL for all connected developers and agents.",
    schema: createProjectSchema
  },
  {
    name: "project.list",
    description: "List shared project scopes from the gateway database.",
    schema: listProjectsSchema
  },
  {
    name: "project.get",
    description: "Get a shared project by id or slug.",
    schema: projectLookupSchema
  },
  {
    name: "project.set_current",
    description: "Set the gateway current project used when project arguments are omitted.",
    schema: projectLookupSchema
  },
  {
    name: "project.current",
    description: "Return the gateway current project.",
    schema: listProjectsSchema.pick({})
  },
  {
    name: "memory.create",
    description: "Create a project or common memory item in the shared gateway database.",
    schema: createMemorySchema
  },
  {
    name: "memory.get",
    description: "Get a memory item by id from shared gateway storage.",
    schema: getMemorySchema
  },
  {
    name: "memory.search",
    description: "Search shared memory using PostgreSQL full-text search across project and common records.",
    schema: searchMemorySchema
  },
  {
    name: "memory.update",
    description: "Update a shared memory item and record an event.",
    schema: updateMemorySchema
  },
  {
    name: "task.create",
    description: "Create a shared executable task for a project.",
    schema: createTaskSchema
  },
  {
    name: "task.list",
    description: "List shared tasks for a project.",
    schema: listTasksSchema
  },
  {
    name: "task.get",
    description: "Get a shared task by id.",
    schema: getTaskSchema
  },
  {
    name: "task.next",
    description: "Return the next shared todo task by priority and creation time.",
    schema: nextTaskSchema
  },
  {
    name: "task.update_status",
    description: "Update shared task status and record lifecycle event.",
    schema: updateTaskStatusSchema
  },
  {
    name: "decision.record",
    description: "Record a shared project or common decision.",
    schema: recordDecisionSchema
  },
  {
    name: "decision.list",
    description: "List shared project and common decisions.",
    schema: listDecisionsSchema
  },
  {
    name: "decision.get",
    description: "Get a shared decision by id.",
    schema: getDecisionSchema
  },
  {
    name: "event.record",
    description: "Record an append-only shared gateway event.",
    schema: recordEventSchema
  },
  {
    name: "event.list",
    description: "List shared gateway events.",
    schema: listEventsSchema
  },
  {
    name: "link.create",
    description: "Create a shared relationship between records.",
    schema: createLinkSchema
  },
  {
    name: "link.list",
    description: "List shared links for a record.",
    schema: listLinksSchema
  },
  {
    name: "preflight",
    description: "Return shared preflight context for a task before editing files.",
    schema: preflightSchema
  }
];
