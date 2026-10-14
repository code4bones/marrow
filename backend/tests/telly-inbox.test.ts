import { describe, expect, it } from "vitest";
import { tellyInboxConfigFromEnv, tellyInboxTaskOfferPayload } from "../src/gateway/telly-inbox.js";

describe("TellyMCP inbox offer payload (T-MEMORY-184)", () => {
  it("is self-contained for the Telegram prompt and grants no operations", () => {
    const payload = tellyInboxTaskOfferPayload({
      sourceEventId: "E-MEMORY-184",
      projectId: "P-MEMORY",
      projectTitle: "Marrow",
      taskId: "T-MEMORY-184",
      title: "Connect the generic inbox",
      summary: "Deliver assignments to TellyMCP.",
      status: "todo",
      priority: 50,
      milestone: "Telly inbox",
      acceptance: "An agent can be nudged after approval.",
      recipientUserId: "user-recipient",
      actorUserId: "user-assigner"
    });

    expect(payload).toMatchObject({
      schemaVersion: 1,
      source: { integration: "marrow", messageId: "E-MEMORY-184" },
      recipient: { externalPrincipal: { namespace: "marrow", subject: "user-recipient" } },
      route: { namespace: "marrow", key: "P-MEMORY" },
      resource: { kind: "task", id: "T-MEMORY-184" },
      kind: "work.offer",
      requiresAcceptance: true,
      display: {
        title: "Connect the generic inbox",
        summary: "Deliver assignments to TellyMCP.",
        status: "todo",
        priority: 50,
        milestone: "Telly inbox",
        acceptance: "An agent can be nudged after approval.",
        project: { id: "P-MEMORY", title: "Marrow" },
        task: { id: "T-MEMORY-184" }
      }
    });
    expect(payload).not.toHaveProperty("operations");
  });

  it("only enables delivery when both endpoint and dedicated credential exist", () => {
    expect(tellyInboxConfigFromEnv({})).toBeNull();
    expect(tellyInboxConfigFromEnv({ TELLYMCP_INBOX_MCP_URL: "https://telly.example/mcp" })).toBeNull();
    expect(
      tellyInboxConfigFromEnv({
        TELLYMCP_INBOX_MCP_URL: "https://telly.example/mcp",
        TELLYMCP_INBOX_BEARER_TOKEN: "inbox-send-token"
      })
    ).toMatchObject({ endpoint: new URL("https://telly.example/mcp"), bearerToken: "inbox-send-token" });
  });
});
