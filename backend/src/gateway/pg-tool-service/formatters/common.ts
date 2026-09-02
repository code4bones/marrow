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
    excerpt: shortText(String(record.excerpt ?? record.body ?? ""), 140),
    tags: stringArray(record.tags)
  };
}

// T-MEMORY-063: warnings/preferredNextTools/strategy/etc. repeat verbatim on
// every single tool response regardless of whether anything is actually
// wrong -- only worth the bytes when severity escalates past "info". The
// plain-info case still carries rule + estimatedChars, enough to notice a
// response is getting large without re-explaining the whole strategy.
export function tokenEfficiencyBase(overrides: Row = {}): Row {
  const full: Row = {
    rule: "Use Marrow as a lazy index first: compact first, select exact records, then read full content only by id/path.",
    severity: "info",
    strategy: "compact-first",
    fullBodiesIncluded: false,
    base64Included: false,
    warnings: [],
    preferredNextTools: ["context.pack", "project.summary", "artifact.search", "artifact.peek"],
    compactAfterThis: false,
    ...overrides
  };
  if (full.severity !== "info") {
    return full;
  }
  return {
    rule: full.rule,
    severity: full.severity,
    ...(full.estimatedChars !== undefined ? { estimatedChars: full.estimatedChars } : {})
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

// T-MEMORY-063: project.summary/context.pack were building 10-12+ nextCalls
// (a few per section), each carrying a full input object and a reason
// string -- capped to the 4 most relevant, reason dropped since the tool
// name plus gateway.manuals already explains what the call does.
export function capNextCalls<T extends { tool: string; input: Row; reason?: string }>(
  calls: T[],
  limit = 4
): Array<{ tool: string; input: Row }> {
  return calls.slice(0, limit).map((call) => ({ tool: call.tool, input: call.input }));
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

// T-context (2026-08-25, live-caught while testing omni search): a live
// quick-search box re-queries on every keystroke, so the user is very often
// mid-word ("task compl") -- plainto_tsquery only matches WHOLE words (after
// stemming), so "compl" never matches "completion" until the word is
// finished, making a live search box feel broken. to_tsquery with each
// token suffixed `:*` does prefix matching instead -- crucially, to_tsquery
// still stems/normalizes each token through the given config's dictionary
// BEFORE appending `:*` (so under 'simple' "compl:*" prefix-matches the
// literal stored lexeme "completion"; under 'english'/'russian' it also
// prefix-matches against stemmed lexemes like "complet"), so this composes
// correctly with the existing tri-lingual OR pattern. Deliberately NOT
// changed on the plain plainto_tsquery path above -- that's unaffected, kept
// for existing "type a full query, press search" call sites; the new
// prefix* functions below are additive, opted into per search* call only
// when the caller explicitly wants live/incremental matching (see
// global-search.mixin.ts).
export function toPrefixTsQueryText(query: string): string {
  const tokens = query
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}_]/gu, ""))
    .filter(Boolean)
    .slice(0, 12);
  return tokens.map((token) => `${token}:*`).join(" & ");
}

const prefixTsQuerySql = "(to_tsquery('simple', ?) || to_tsquery('english', ?) || to_tsquery('russian', ?))";

export function prefixRankSql(table: string): string {
  return `(ts_rank(search_vector, ${prefixTsQuerySql}) * ${statusRankWeightSql()} * ${chainHeadRankWeightSql(table)})`;
}

export function prefixWhereSql(): string {
  return `search_vector @@ ${prefixTsQuerySql}`;
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

// timestamptz columns come back from pg/knex as Date objects, not strings.
// This used to return Date.toString() ("Thu Aug 06 2026 21:39:02 GMT+0000
// (Coordinated Universal Time)") "for consistency" with the plain
// String(row.created_at) calls scattered across the other formatters in
// this directory -- but that format isn't lexically sortable (it starts
// with a weekday name, so "Fri ..." sorts before "Thu ..." regardless of
// which is actually later), which silently broke every client-side
// chronological sort/compare built on a raw createdAt/updatedAt string
// (found via DecisionTimeline's newest-first ordering reading wrong).
// toISOString() is what every other formatter's date field should also be
// emitting now -- see the sibling String(row.xxx_at) call sites fixed
// alongside this to call dateStringOrNull instead.
export function dateStringOrNull(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
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
    ownerUserId: context.ownerUserId ?? null,
    // Not an auth-context field -- service.ts's call() sets this from the
    // raw tool input's `agent` param after this runs. Defaults to null here
    // for every caller that doesn't go through call() (internal/test
    // construction) or didn't pass one.
    agentName: null
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
