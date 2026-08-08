import { shortText, stringArray, stringOrNull } from "./common.js";
import type { Row } from "../types.js";

export function handoffOut(record: Row, includeContent: boolean) {
  return {
    id: String(record.id),
    projectId: stringOrNull(record.projectId),
    title: String(record.title),
    status: String(record.status),
    excerpt: shortText(String(record.body ?? record.excerpt ?? ""), 700),
    tags: stringArray(record.tags),
    updatedAt: stringOrNull(record.updatedAt),
    ...(includeContent ? { body: String(record.body ?? "") } : {})
  };
}


export function handoffBody(input: Row): string {
  const sections: Array<[string, string[]]> = [
    ["Work completed", stringArray(input.workCompleted)],
    ["Files touched", stringArray(input.filesTouched)],
    ["Blockers", stringArray(input.blockers)],
    ["Validation", stringArray(input.validation)],
    ["Next steps", stringArray(input.nextSteps)]
  ];

  return sections
    .filter(([, values]) => values.length > 0)
    .map(([title, values]) => `${title}:\n${values.map((value) => `- ${value}`).join("\n")}`)
    .join("\n\n");
}

