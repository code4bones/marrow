import { AppError } from "../../../shared/errors.js";
import type { GatewayRequestContext, NormalizedGatewayRequestContext, Row } from "../types.js";

export function paginationInput(value: unknown): { limit: number; offset: number } {
  const input = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {};
  const limit = boundedInteger(input.limit, 50, 1, 200);
  const offset = boundedInteger(input.offset, 0, 0, 1_000_000);
  return { limit, offset };
}

export function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function compactSearchRecord(record: Row) {
  return {
    id: String(record.id),
    scope: String(record.scope ?? (record.projectId ? "project" : "common")),
    type: String(record.type),
    title: String(record.title),
    status: String(record.status),
    excerpt: shortText(String(record.excerpt ?? record.body ?? ""), 360),
    tags: stringArray(record.tags)
  };
}

export function tokenEfficiencyBase(overrides: Row = {}) {
  return {
    rule: "Use PMem as a lazy index first: compact first, select exact records, then read full content only by id/path.",
    severity: "info",
    strategy: "compact-first",
    fullBodiesIncluded: false,
    base64Included: false,
    warnings: [],
    preferredNextTools: ["context.pack", "project.summary", "artifact.search", "artifact.peek"],
    compactAfterThis: false,
    ...overrides
  };
}

export function compactContextEfficiencyHints(tool: string, estimatedChars?: number) {
  return tokenEfficiencyBase({
    strategy: "compact-cards-and-next-calls",
    estimatedChars,
    warnings: [
      "This response intentionally omits full bodies and base64 content.",
      "Follow nextCalls only for records or artifacts that are necessary for the current task."
    ],
    preferredNextTools: ["memory.get", "artifact.peek", "artifact.read_text", "preflight"],
    sourceTool: tool
  });
}

export function defaultTokenBudget(mode: string, profile = "general"): number {
  if (profile === "chatgpt") {
    return mode === "deep" ? 3000 : mode === "normal" ? 2000 : 1500;
  }
  return mode === "brief" ? 1500 : mode === "deep" ? 6000 : 3000;
}

export function parseSinceCursor(value: unknown): string {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new AppError("VALIDATION_ERROR", "since must be an ISO timestamp or Date-compatible cursor.");
  }
  return date.toISOString();
}

export function shortText(value: string | null, maxLength: number): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
}

export function connectionSnippets() {
  const baseUrl = "https://<gateway-host>/api";
  const mcpUrl = `${baseUrl}/mcp?client_id=\${MARROW_CLIENT_ID}&client_label=\${MARROW_CLIENT_LABEL}&client_kind=<client-kind>`;
  return [
    {
      client: "codex",
      transport: "streamable-http",
      config: {
        serverName: "marrow",
        url: mcpUrl,
        headers: {
          Authorization: "Bearer ${MARROW_MCP_TOKEN}"
        }
      },
      notes: [
        "Set MARROW_CLIENT_ID to a stable developer/agent id such as USER@HOSTNAME.",
        "Set MARROW_CLIENT_LABEL to a readable label.",
        "Set MARROW_MCP_TOKEN to the gateway bearer token."
      ]
    },
    {
      client: "claude",
      transport: "streamable-http",
      cli: "claude mcp add --transport http marrow \"https://<gateway-host>/api/mcp?client_id=${MARROW_CLIENT_ID}&client_label=${MARROW_CLIENT_LABEL}&client_kind=claude-code\" --header \"Authorization: Bearer ${MARROW_MCP_TOKEN}\""
    },
    {
      client: "codewhale",
      transport: "streamable-http",
      configPath: ".deepseek/mcp.json",
      config: {
        mcpServers: {
          marrow: {
            url: "https://<gateway-host>/api/mcp?client_id=${MARROW_CLIENT_ID}&client_label=${MARROW_CLIENT_LABEL}&client_kind=codewhale",
            headers: {
              Authorization: "Bearer ${MARROW_MCP_TOKEN}"
            }
          }
        }
      },
      notes: ["Use config file headers when the CodeWhale CLI does not accept --headers."]
    },
    {
      client: "generic-streamable-http",
      transport: "streamable-http",
      url: mcpUrl,
      headers: {
        Authorization: "Bearer ${MARROW_MCP_TOKEN}"
      }
    }
  ];
}

// I-MEMORY-022 step 5 ranking. `table` is always one of the hardcoded
// literals passed at each call site below ("items" | "artifacts"), never
// user input, so string-interpolating it into the SQL identifier position
// (where a bind parameter can't go anyway) is safe.
const combinedTsQuerySql = "(plainto_tsquery('simple', ?) || plainto_tsquery('english', ?) || plainto_tsquery('russian', ?))";

export function statusRankWeightSql(): string {
  return "(case status when 'active' then 1.0 when 'draft' then 0.9 when 'superseded' then 0.4 when 'archived' then 0.3 when 'rejected' then 0.2 else 1.0 end)";
}

// Absorbed records (something newer supersedes/refines/derives_from them)
// rank below their replacement even when both match — "голова цепочки
// вверх, поглощённые звенья вниз". Reuses the existing idx_links_to_id index.
export function chainHeadRankWeightSql(table: string): string {
  return (
    `(case when exists (select 1 from links l where l.to_id = ${table}.id ` +
    "and l.relation in ('supersedes', 'refines', 'derives_from')) then 0.5 else 1.0 end)"
  );
}

export function combinedRankSql(table: string): string {
  return `(ts_rank(search_vector, ${combinedTsQuerySql}) * ${statusRankWeightSql()} * ${chainHeadRankWeightSql(table)})`;
}

// KWIC excerpt: context around the actual match instead of the first ~200
// chars of body (which is usually just the intro). Markdown-bolded so the
// match is visible in plain text without HTML.
export function kwicHeadlineSql(): string {
  return (
    `ts_headline('simple', coalesce(body, ''), ${combinedTsQuerySql}, ` +
    "'MaxFragments=2, MinWords=15, MaxWords=40, StartSel=**, StopSel=**, FragmentDelimiter= ... ')"
  );
}

export function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// timestamptz columns come back from pg/knex as Date objects, not strings —
// stringOrNull alone silently drops them. Everywhere else in this file
// timestamps go through String(row.created_at) (JS Date.toString(), not
// ISO — kept consistent with that, not "corrected" to ISO), which is only
// safe because those fields are always selected/present; graphNodeOut's
// createdAt is occasionally absent by design (unselected columns), so it
// needs the null check stringOrNull gives plus proper Date handling.
export function dateStringOrNull(value: unknown): string | null {
  if (value instanceof Date) {
    return String(value);
  }
  return stringOrNull(value);
}

export function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string" && value.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(value);
      return stringArray(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

export function jsonStringArray(value: unknown): string {
  return JSON.stringify(stringArray(value));
}

export function jsonObject(value: unknown): Row {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Row;
  }
  if (typeof value === "string" && value.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(value);
      return jsonObject(parsed);
    } catch {
      return {};
    }
  }
  return {};
}

export function normalizeContext(context: GatewayRequestContext): NormalizedGatewayRequestContext {
  const clientId = context.clientId && context.clientId.length > 0 ? context.clientId : "anonymous";
  return {
    clientId,
    clientLabel: context.clientLabel && context.clientLabel.length > 0 ? context.clientLabel : clientId,
    metadata: context.metadata ?? {},
    sessionUserId: context.sessionUserId ?? null,
    sessionRole: context.sessionRole ?? null,
    sessionSource: context.sessionSource ?? null,
    ownerUserId: context.ownerUserId ?? null
  };
}

export function writeActorFields(context: NormalizedGatewayRequestContext) {
  return {
    created_by: context.clientId,
    updated_by: context.clientId,
    source_instance_id: context.clientId
  };
}

export function currentProjectKey(clientId: string): string {
  return `current_project_id:${clientId}`;
}
