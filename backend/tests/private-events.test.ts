import { describe, expect, it } from "vitest";
import { isAllowedWsOrigin, isCommonEventVisibleTo, isPrivateCommonEventType } from "../src/gateway/private-events.js";

// T-MEMORY-175: common-scope events reach every member; private ones must not.
describe("private common events", () => {
  it.each([
    "git_credential.created", "git_credential.deleted", "git_variable.set", "git_pipeline.triggered",
    "environment_variable.created", "environment_variable.deleted", "ai_provider_credential.created",
    "user.registration_pending", "user.role_changed", "user.deleted", "project.deleted"
  ])("%s is private", (type) => {
    expect(isPrivateCommonEventType(type)).toBe(true);
  });
  it.each(["item.created", "decision.recorded", "task.created", "artifact.created", "skill.recorded", "link.created", "project.created"])(
    "%s is not private",
    (type) => {
      expect(isPrivateCommonEventType(type)).toBe(false);
    }
  );

  const member = { role: "member", userId: "u1" };
  it("shows a private event to admins and to its author only", () => {
    const event = { type: "git_credential.created", credentialId: "user:u2" };
    expect(isCommonEventVisibleTo({ role: "admin", userId: "a" }, event)).toBe(true);
    expect(isCommonEventVisibleTo(member, event)).toBe(false);
    expect(isCommonEventVisibleTo(member, { ...event, credentialId: "user:u1" })).toBe(true);
    expect(isCommonEventVisibleTo(member, { ...event, credentialId: null })).toBe(false);
    expect(isCommonEventVisibleTo(member, { ...event, credentialId: "claude-code" })).toBe(false);
  });
  it("leaves ordinary common events broadcast", () => {
    expect(isCommonEventVisibleTo(member, { type: "item.created", credentialId: "user:u2" })).toBe(true);
  });
});

describe("isAllowedWsOrigin", () => {
  it("allows non-browser clients (no Origin) and the site's own origin", () => {
    expect(isAllowedWsOrigin(undefined, "marrow.undoo.ru")).toBe(true);
    expect(isAllowedWsOrigin("https://marrow.undoo.ru", "marrow.undoo.ru")).toBe(true);
    expect(isAllowedWsOrigin("http://localhost:7000", "localhost:7000")).toBe(true);
  });
  it("refuses a foreign or malformed browser Origin", () => {
    expect(isAllowedWsOrigin("https://evil.example", "marrow.undoo.ru")).toBe(false);
    expect(isAllowedWsOrigin("https://marrow.undoo.ru.evil.example", "marrow.undoo.ru")).toBe(false);
    expect(isAllowedWsOrigin("null", "marrow.undoo.ru")).toBe(false);
    expect(isAllowedWsOrigin("https://marrow.undoo.ru", undefined)).toBe(false);
  });
  it("honours explicitly configured origins", () => {
    expect(isAllowedWsOrigin("http://localhost:5173", "localhost:7000", ["http://localhost:5173"])).toBe(true);
    expect(isAllowedWsOrigin("http://localhost:5174", "localhost:7000", ["http://localhost:5173"])).toBe(false);
  });
});
