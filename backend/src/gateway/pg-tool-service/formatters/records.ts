import { AppError } from "../../../shared/errors.js";
import type { Row } from "../types.js";
import { projectOut } from "./projects.js";
import { itemOut } from "./memory.js";
import { taskOut } from "./tasks.js";
import { decisionOut } from "./decisions.js";
import { artifactOut } from "./artifacts.js";
import { eventOut } from "./events.js";
import { linkOut } from "./links.js";
import { skillOut } from "./skills.js";

export function recordLookupTables(id: string): string[] {
  const tables = ["items", "projects", "tasks", "decisions", "artifacts", "events", "links", "skills"];
  let preferred = "items";
  if (id.startsWith("P-")) {
    preferred = "projects";
  } else if (id.startsWith("T-")) {
    preferred = "tasks";
  } else if (id.startsWith("D-")) {
    preferred = "decisions";
  } else if (id.startsWith("A-")) {
    preferred = "artifacts";
  } else if (id.startsWith("E-")) {
    preferred = "events";
  } else if (id.startsWith("L-")) {
    preferred = "links";
  } else if (id.startsWith("SK-")) {
    preferred = "skills";
  }
  return [preferred, ...tables.filter((table) => table !== preferred)];
}

export function recordLookupOut(table: string, row: Row): Row {
  switch (table) {
    case "projects": {
      const project = projectOut(row);
      return {
        id: project.id,
        kind: "PROJECT",
        projectId: project.id,
        record: { __typename: "Project", ...project }
      };
    }
    case "items": {
      const item = itemOut(row);
      return {
        id: item.id,
        kind: "MEMORY",
        projectId: item.projectId,
        record: { __typename: "MemoryRecord", ...item }
      };
    }
    case "tasks": {
      const task = taskOut(row);
      return {
        id: task.id,
        kind: "TASK",
        projectId: task.projectId,
        record: { __typename: "Task", ...task }
      };
    }
    case "decisions": {
      const decision = decisionOut(row);
      return {
        id: decision.id,
        kind: "DECISION",
        projectId: decision.projectId,
        record: { __typename: "Decision", ...decision }
      };
    }
    case "artifacts": {
      const artifact = artifactOut(row);
      return {
        id: artifact.id,
        kind: "ARTIFACT",
        projectId: artifact.projectId,
        record: { __typename: "Artifact", ...artifact }
      };
    }
    case "events": {
      const event = eventOut(row);
      return {
        id: event.id,
        kind: "EVENT",
        projectId: event.projectId,
        record: { __typename: "Event", ...event }
      };
    }
    case "links": {
      const link = linkOut(row);
      return {
        id: link.id,
        kind: "LINK",
        projectId: link.projectId,
        record: { __typename: "Link", ...link }
      };
    }
    case "skills": {
      const skill = skillOut(row);
      return {
        id: skill.id,
        kind: "SKILL",
        projectId: skill.projectId,
        record: { __typename: "Skill", ...skill }
      };
    }
    default:
      throw new AppError("NOT_FOUND", `Unsupported record table ${table}.`, { table });
  }
}

