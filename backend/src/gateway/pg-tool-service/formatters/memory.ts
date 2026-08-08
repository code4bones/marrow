import { stringArray, stringOrNull, shortText } from "./common.js";
import type { Row } from "../types.js";

function excerpt(body: string): string {
  return body.length <= 220 ? body : `${body.slice(0, 217)}...`;
}

export function itemOut(row: Row) {
  return {
    id: String(row.id),
    projectId: stringOrNull(row.project_id),
    scope: row.project_id ? "project" : "common",
    type: String(row.type),
    title: String(row.title),
    body: String(row.body),
    status: String(row.status),
    tags: stringArray(row.tags),
    summary: stringOrNull(row.summary),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function searchOut(row: Row) {
  return {
    id: String(row.id),
    scope: row.project_id ? "project" : "common",
    type: String(row.type),
    title: String(row.title),
    // Preference order (I-MEMORY-022 step 5): a curated summary beats a
    // KWIC snippet around the actual match beats a blind first-200-chars
    // truncation of the body, which is usually just the intro, not the
    // reason this record matched.
    excerpt: stringOrNull(row.summary) ?? stringOrNull(row.headline) ?? excerpt(String(row.body ?? "")),
    status: String(row.status),
    tags: stringArray(row.tags),
    rank: Number(row.rank ?? 0)
  };
}

export function compactMemoryRecord(record: Row) {
  return {
    id: String(record.id),
    projectId: stringOrNull(record.projectId),
    type: String(record.type),
    title: String(record.title),
    status: String(record.status),
    excerpt: shortText(String(record.body ?? ""), 500),
    tags: stringArray(record.tags),
    updatedAt: stringOrNull(record.updatedAt)
  };
}

export function hygieneItemOut(record: Row) {
  return {
    id: String(record.id),
    projectId: stringOrNull(record.projectId),
    scope: String(record.scope ?? (record.projectId ? "project" : "common")),
    type: String(record.type),
    title: String(record.title),
    status: String(record.status),
    bodyChars: Number(record.bodyChars ?? 0),
    tags: stringArray(record.tags),
    updatedAt: stringOrNull(record.updatedAt)
  };
}

export function memoryDuplicateGroups(rows: Row[], limit: number) {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = [row.projectId ?? "common", row.type, String(row.title).trim().toLowerCase()].join("\u0000");
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return Array.from(groups.values())
    .filter((group) => group.length > 1)
    .sort((left, right) => right.length - left.length)
    .slice(0, limit)
    .map((group) => ({
      scope: String(group[0]?.scope ?? "project"),
      projectId: stringOrNull(group[0]?.projectId),
      type: String(group[0]?.type),
      title: String(group[0]?.title),
      count: group.length,
      ids: group.map((item) => String(item.id)),
      updatedAt: stringOrNull(
        group
          .map((item) => stringOrNull(item.updatedAt))
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1) ?? null
      )
    }));
}

export function hygieneNextCalls(records: Row[], duplicateGroups: Row[]) {
  const calls: Array<{ tool: string; input: Row; reason: string }> = [];
  const seen = new Set<string>();
  for (const record of records.slice(0, 5)) {
    const id = String(record.id);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    calls.push({
      tool: "memory.get",
      input: { id },
      reason: "Inspect full record before deciding whether to split, archive, or rewrite it."
    });
  }
  for (const group of duplicateGroups.slice(0, 3)) {
    for (const id of stringArray(group.ids).slice(0, 2)) {
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      calls.push({
        tool: "memory.get",
        input: { id },
        reason: "Compare duplicate title group before consolidating records."
      });
    }
  }
  return calls;
}

export function failedAttemptBody(input: Row): string {
  const sections: Array<[string, string]> = [
    ["What was tried", String(input.whatTried)],
    ["Why it failed", String(input.whyFailed)],
    ["What should not be repeated", String(input.doNotRepeat)]
  ];

  if (typeof input.betterNextApproach === "string" && input.betterNextApproach.length > 0) {
    sections.push(["Better next approach", input.betterNextApproach]);
  }

  return sections.map(([title, body]) => `${title}:\n${body}`).join("\n\n");
}
