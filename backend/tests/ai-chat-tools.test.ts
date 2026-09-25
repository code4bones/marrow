import { describe, expect, it } from "vitest";
import { gatewayToolSpecs } from "../src/gateway/tool-definitions.js";
import {
  AI_CHAT_ALLOWED_WRITE_TOOLS,
  aiChatRedactTools,
  aiChatToolSpecs
} from "../src/gateway/pg-tool-service/ai-chat-tools.js";

// T-MEMORY-167: Ask Marrow's tool-use loop runs with the human's authority
// over untrusted record text -- keep destructive/privilege tools away from it.
describe("aiChatToolSpecs", () => {
  const offered = new Set(aiChatToolSpecs().map((spec) => spec.name));

  it("never offers admin-tier tools", () => {
    for (const spec of gatewayToolSpecs.filter((tool) => tool.access === "admin")) {
      expect(offered.has(spec.name)).toBe(false);
    }
  });

  it("never offers destructive, membership, secret-write or recursive tools", () => {
    const forbidden = [
      "project.delete", "memory.delete", "task.delete", "decision.delete", "artifact.delete",
      "event.delete", "link.delete", "skill.delete", "ai.conversation_delete",
      "memory.archive", "decision.archive", "artifact.archive", "skill.archive",
      "project.approve_member", "project.reject_member", "project.update_member_role",
      "project.invite_link_get", "project.invite_link_regenerate", "project.invite_claim",
      "project.create", "project.update",
      "env.variable_set", "env.variable_delete", "user.preference_set",
      "git.credential_create", "git.credential_delete", "git.credential_list",
      "ai.ask", "ai.provider_create", "ai.provider_update", "ai.provider_delete",
      "artifact.put"
    ];
    for (const name of forbidden) {
      expect(offered.has(name), name).toBe(false);
    }
  });

  it("offers a write tool only if it is explicitly allow-listed", () => {
    for (const spec of gatewayToolSpecs.filter((tool) => tool.access === "write")) {
      expect(offered.has(spec.name), spec.name).toBe(AI_CHAT_ALLOWED_WRITE_TOOLS.has(spec.name));
    }
  });

  it("every allow-listed write tool really exists (no stale names)", () => {
    const writeNames = new Set(gatewayToolSpecs.filter((tool) => tool.access === "write").map((tool) => tool.name));
    for (const name of AI_CHAT_ALLOWED_WRITE_TOOLS) {
      expect(writeNames.has(name), name).toBe(true);
    }
  });

  it("forces redaction on every offered tool that has a redact switch", () => {
    const redact = aiChatRedactTools();
    expect(redact.has("env.variable_get")).toBe(true);
    expect(redact.has("env.variables_list")).toBe(true);
    expect(redact.has("git.variable_get")).toBe(true);
    expect(redact.has("git.variables_list")).toBe(true);
    expect(redact.has("git.job_trace")).toBe(true);
  });
});
