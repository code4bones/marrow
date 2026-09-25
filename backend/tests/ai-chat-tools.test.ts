import { describe, expect, it } from "vitest";
import { gatewayToolSpecs } from "../src/gateway/tool-definitions.js";
import {
  AI_CHAT_ALLOWED_WRITE_TOOLS,
  aiChatSecretReadTools,
  aiChatToolSpecs,
  callExposesSecrets
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

  it("recognises the secret-carrying tools (the ones with a redact switch)", () => {
    const secretTools = aiChatSecretReadTools();
    for (const name of ["env.variable_get", "env.variables_list", "git.variable_get", "git.variables_list", "git.job_trace"]) {
      expect(secretTools.has(name), name).toBe(true);
    }
    expect(secretTools.has("task.list")).toBe(false);
  });

  it("flags a call as exposing secrets only when it asks for redact:false", () => {
    const secretTools = aiChatSecretReadTools();
    expect(callExposesSecrets("env.variable_get", { key: "K", redact: false }, secretTools)).toBe(true);
    expect(callExposesSecrets("env.variable_get", { key: "K" }, secretTools)).toBe(false); // masked default
    expect(callExposesSecrets("env.variable_get", { key: "K", redact: true }, secretTools)).toBe(false);
    expect(callExposesSecrets("task.list", { redact: false }, secretTools)).toBe(false); // not a secret tool
    expect(callExposesSecrets("env.variable_get", null, secretTools)).toBe(false);
    expect(callExposesSecrets("env.variable_get", [false], secretTools)).toBe(false);
  });
});
