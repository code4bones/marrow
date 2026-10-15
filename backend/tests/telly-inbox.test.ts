import { describe, expect, it } from "vitest";
import { tellyInboxConfigFromEnv, tellyInboxTaskOfferPayload } from "../src/gateway/telly-inbox.js";

describe("TellyMCP inbox offer payload (T-MEMORY-184)", () => {
  it("is self-contained for the Telegram prompt and grants no operations", () => {
    const previousWebUrl = process.env.MARROW_WEB_URL;
    delete process.env.MARROW_WEB_URL;
    delete process.env.PROJECT_MEMORY_PUBLIC_URL;
    try {
      const payload = tellyInboxTaskOfferPayload({
        sourceEventId: "E-MEMORY-184",
        projectId: "P-MEMORY",
        projectSlug: "marrow",
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
          summary: "Deliver assignments to TellyMCP."
        }
      });
      expect(payload).not.toHaveProperty("operations");
      // consoleText becomes literal PTY input on TellyMCP's side -- must
      // stay IDs-only, never task.title/notes/scope free text.
      expect(payload.consoleText).toContain("T-MEMORY-184");
      expect(payload.consoleText).toContain("P-MEMORY");
      expect(payload.consoleText).not.toContain("Connect the generic inbox");
    } finally {
      if (previousWebUrl === undefined) delete process.env.MARROW_WEB_URL;
      else process.env.MARROW_WEB_URL = previousWebUrl;
    }
  });

  it("omits a missing summary instead of sending null to TellyMCP", () => {
    const previousWebUrl = process.env.MARROW_WEB_URL;
    delete process.env.MARROW_WEB_URL;
    delete process.env.PROJECT_MEMORY_PUBLIC_URL;
    try {
      const payload = tellyInboxTaskOfferPayload({
        sourceEventId: "E-MEMORY-184-null-summary",
        projectId: "P-MEMORY",
        projectSlug: "marrow",
        projectTitle: "Marrow",
        taskId: "T-MEMORY-184",
        title: "Title only",
        summary: null,
        status: "todo",
        priority: 100,
        milestone: null,
        acceptance: null,
        recipientUserId: "user-recipient",
        actorUserId: "user-assigner"
      });
      expect(payload.display).toEqual({ title: "Title only" });
    } finally {
      if (previousWebUrl === undefined) delete process.env.MARROW_WEB_URL;
      else process.env.MARROW_WEB_URL = previousWebUrl;
    }
  });

  it("includes a deep link to the task's web drawer when MARROW_WEB_URL is configured", () => {
    const previousWebUrl = process.env.MARROW_WEB_URL;
    process.env.MARROW_WEB_URL = "https://marrow.undoo.ru";
    try {
      const payload = tellyInboxTaskOfferPayload({
        sourceEventId: "E-MEMORY-184-url",
        projectId: "P-MEMORY",
        projectSlug: "marrow",
        projectTitle: "Marrow",
        taskId: "T-MEMORY-184",
        title: "Title only",
        summary: null,
        status: "todo",
        priority: 100,
        milestone: null,
        acceptance: null,
        recipientUserId: "user-recipient",
        actorUserId: "user-assigner"
      });
      expect(payload.display).toMatchObject({
        url: "https://marrow.undoo.ru/projects/marrow/tasks/T-MEMORY-184"
      });
    } finally {
      if (previousWebUrl === undefined) delete process.env.MARROW_WEB_URL;
      else process.env.MARROW_WEB_URL = previousWebUrl;
    }
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
