export type Row = Record<string, unknown>;

export type GraphNode = {
  id: string;
  kind: string;
  title: string;
  status: string | null;
  createdAt: string | null;
  milestone: string | null;
};

export type GraphEdge = {
  // Deterministic, not DB-backed (some edges -- "blocks"/"supersedes" -- are
  // synthesized from a task/decision column, not a real `links` row) --
  // same from:to:relation triple GraphMixin already dedupes edges by.
  // Exists so Apollo's InMemoryCache can normalize GraphEdge like it
  // already does GraphNode (which has a real id): without one, the whole
  // `edges` array was unnormalizable, forcing every client-side memo
  // keyed off it (satellitesByRecord, remarksByTarget) to recompute new
  // Map/array references on every projectGraph refetch even when nothing
  // about the edges actually changed -- see T-MEMORY-065 follow-up on the
  // "one task's status change re-rendered the whole Timeline" report.
  id: string;
  from: string;
  to: string;
  relation: string;
};

export const taskClaimRoles = ["backend", "frontend", "test", "docs", "review", "devops", "coordination", "other"] as const;
export const defaultTaskClaimLeaseSeconds = 60 * 60;

export interface GatewayRequestContext {
  clientId?: string;
  clientLabel?: string;
  metadata?: Row;
  // Threaded from the session cookie, personal token, OR (T-MEMORY-052) a
  // real OAuth-authenticated identity, so project-membership filtering
  // (D-MEMORY-007 / T-MEMORY-029) can tell a role=member caller apart from
  // an admin caller. Only a static-token/anonymous caller (never
  // membership-filtered by design) leaves this absent. T-MEMORY-052 closed a
  // gap where a role=member user connecting over an OAuth-authenticated
  // client (now role-derived since D-MEMORY-027's SSO work) bypassed
  // project_members filtering entirely -- the same user's session or
  // personal token was correctly filtered, but their OAuth connector wasn't,
  // because this field used to stay unset for OAuth on purpose.
  sessionUserId?: string;
  sessionRole?: string;
  // T-MEMORY-047 / T-MEMORY-052: distinguishes *how* sessionUserId/sessionRole
  // were resolved. Only one consumer cares about the distinction:
  // git-credential *management* (create/delete, see requireSessionUserId
  // below) stays deliberately browser-session-only, so it checks this field
  // is exactly "cookie" -- a personal token or an OAuth connector resolving
  // the same user's real identity still can't mint/destroy a raw credential.
  // Every other consumer (scope-tier resolution, project-membership
  // filtering, git-credential *reads*) treats all three sources alike and
  // ignores this field. Absent only for static-token/anonymous callers.
  sessionSource?: "cookie" | "personal_token" | "oauth";
  // The real Marrow user behind an OAuth-sourced request, resolved fresh
  // from the bearer's JWT `sub` on every request (see resolveOAuthOwner in
  // http-server.ts). Since T-MEMORY-052 this is also the source
  // sessionUserId/sessionRole fall back to for an OAuth caller (see
  // requestContext() in http-server.ts) -- kept as its own field too because
  // touchClient() (base.ts) specifically wants "was this OAuth" for
  // gateway_clients attribution, not just "do we know who this is".
  // Absent for every non-OAuth auth source.
  ownerUserId?: string;
}

export interface NormalizedGatewayRequestContext {
  clientId: string;
  clientLabel: string;
  metadata: Row;
  sessionUserId: string | null;
  sessionRole: string | null;
  sessionSource: "cookie" | "personal_token" | "oauth" | null;
  ownerUserId: string | null;
}

export const manualSpecs = [
  {
    id: "developer",
    audience: "developer",
    aliases: ["user", "manual"],
    title: "Marrow Developer Manual",
    description: "Purpose, setup, safe usage, artifact workflows, guardrails, and gateway operations.",
    path: "docs/DEVELOPER_MANUAL.md"
  },
  {
    id: "onboarding",
    audience: "onboarding",
    aliases: ["start", "first-run", "quickstart"],
    title: "Marrow Agent Onboarding",
    description: "First-run tool chain for agents connecting to a shared Marrow gateway.",
    path: "docs/AGENT_ONBOARDING.md"
  },
  {
    id: "agent",
    audience: "agent",
    aliases: ["workflow"],
    title: "Marrow Agent Guide",
    description: "Operational rules for agents: when to use Marrow, tool chains, preflight, artifacts, and clarification triggers.",
    path: "docs/AGENT_GUIDE.md"
  },
  {
    id: "conventions",
    audience: "conventions",
    aliases: ["collaboration"],
    title: "Marrow Collaboration Conventions",
    description:
      "Shared storage-surface mapping and collaboration rules for ChatGPT, Codex, and other agents using Marrow together.",
    path: "docs/PROJECT_MEMORY_COLLABORATION_CONVENTIONS.md"
  }
] as const;

export const anonymousClientPrefix = "anonymous:";
export const defaultAnonymousClientTtlSeconds = 24 * 60 * 60;
// Stable gateway_clients id for the shared static MCP_TOKEN (T-MEMORY-029).
// Exported so http-server.ts's requestContext() can assign the same id to
// every static-token request instead of a fresh anonymous id per request.
export const staticTokenClientId = "static:mcp-token";
