import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertAuthConfigured } from "../src/gateway/http-server.js";

describe("assertAuthConfigured (T-MEMORY-062)", () => {
  const originalOverride = process.env.PROJECT_MEMORY_ALLOW_NO_AUTH;

  beforeEach(() => {
    delete process.env.PROJECT_MEMORY_ALLOW_NO_AUTH;
  });

  afterEach(() => {
    if (originalOverride === undefined) {
      delete process.env.PROJECT_MEMORY_ALLOW_NO_AUTH;
    } else {
      process.env.PROJECT_MEMORY_ALLOW_NO_AUTH = originalOverride;
    }
  });

  it("refuses to start with neither a static token nor OAuth configured", () => {
    expect(() => assertAuthConfigured({ host: "127.0.0.1", port: 0 })).toThrow(/no auth source configured/i);
  });

  it("allows starting with only a static token", () => {
    expect(() => assertAuthConfigured({ host: "127.0.0.1", port: 0, token: "smoke-token" })).not.toThrow();
  });

  it("allows starting with only OAuth configured", () => {
    expect(() =>
      assertAuthConfigured({ host: "127.0.0.1", port: 0, oauth: {} as never })
    ).not.toThrow();
  });

  it("still refuses when PROJECT_MEMORY_ALLOW_NO_AUTH is explicitly falsy", () => {
    process.env.PROJECT_MEMORY_ALLOW_NO_AUTH = "0";
    expect(() => assertAuthConfigured({ host: "127.0.0.1", port: 0 })).toThrow(/no auth source configured/i);
  });

  it("allows the no-auth path when PROJECT_MEMORY_ALLOW_NO_AUTH opts in", () => {
    process.env.PROJECT_MEMORY_ALLOW_NO_AUTH = "1";
    expect(() => assertAuthConfigured({ host: "127.0.0.1", port: 0 })).not.toThrow();
  });
});
