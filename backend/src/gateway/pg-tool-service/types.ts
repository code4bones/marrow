export type Row = Record<string, unknown>;

export type GraphNode = {
  id: string;
  kind: string;
  title: string;
  status: string | null;
  createdAt: string | null;
};

export type GraphEdge = {
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
  // Threaded from the session cookie (if any) so project-membership
  // filtering (D-MEMORY-007 / T-MEMORY-029) can tell a role=member session
  // apart from an admin session, a static-token/OAuth/anonymous caller, none
  // of which are ever membership-filtered. Absent for every non-session auth
  // source.
  sessionUserId?: string;
  sessionRole?: string;
  // T-MEMORY-047: distinguishes a real browser session (cookie) from a
  // personal-API-token bearer -- both populate sessionUserId/sessionRole
  // identically (scope-tier resolution and project-membership filtering
  // treat them the same), but git-credential *management*
  // (create/delete, see requireSessionUserId below) stays deliberately
  // browser-session-only, so it checks this field too. Absent for every
  // non-session, non-personal-token auth source (static token, OAuth,
  // anonymous), same as sessionUserId/sessionRole above.
  sessionSource?: "cookie" | "personal_token";
}

export interface NormalizedGatewayRequestContext {
  clientId: string;
  clientLabel: string;
  metadata: Row;
  sessionUserId: string | null;
  sessionRole: string | null;
  sessionSource: "cookie" | "personal_token" | null;
}

export const manualSpecs = [
  {
    id: "developer",
    audience: "developer",
    aliases: ["user", "manual"],
    title: "Project Memory MCP Developer Manual",
    description: "Purpose, setup, safe usage, artifact workflows, guardrails, and gateway operations.",
    path: "docs/DEVELOPER_MANUAL.md"
  },
  {
    id: "onboarding",
    audience: "onboarding",
    aliases: ["start", "first-run", "quickstart"],
    title: "Project Memory MCP Agent Onboarding",
    description: "First-run tool chain for agents connecting to a shared pmem gateway.",
    path: "docs/AGENT_ONBOARDING.md"
  },
  {
    id: "agent",
    audience: "agent",
    aliases: ["workflow"],
    title: "Project Memory MCP Agent Guide",
    description: "Operational rules for agents: when to use pmem, tool chains, preflight, artifacts, and clarification triggers.",
    path: "docs/AGENT_GUIDE.md"
  },
  {
    id: "conventions",
    audience: "conventions",
    aliases: ["collaboration"],
    title: "Project Memory MCP Collaboration Conventions",
    description:
      "Shared storage-surface mapping and collaboration rules for ChatGPT, Codex, and other agents using pmem together.",
    path: "docs/PROJECT_MEMORY_COLLABORATION_CONVENTIONS.md"
  }
] as const;

export const anonymousClientPrefix = "anonymous:";
export const defaultAnonymousClientTtlSeconds = 24 * 60 * 60;
// Stable gateway_clients id for the shared static MCP_TOKEN (T-MEMORY-029).
// Exported so http-server.ts's requestContext() can assign the same id to
// every static-token request instead of a fresh anonymous id per request.
export const staticTokenClientId = "static:mcp-token";
