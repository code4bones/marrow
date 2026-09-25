import { describe, expect, it } from "vitest";
import { isSensitiveKey, redactUrlForLog } from "../src/gateway/http-server.js";

// T-MEMORY-174: secrets must not reach the request log.
describe("log redaction", () => {
  it.each(["value", "Value", "variables", "token", "githubToken", "password", "authorization", "clientSecret", "code_verifier"])(
    "%s is a sensitive key",
    (key) => {
      expect(isSensitiveKey(key)).toBe(true);
    }
  );
  it.each(["key", "title", "project", "host", "valueType", "values", "body"])("%s is not", (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });

  it("drops one-time token values from logged URLs but keeps path and names", () => {
    expect(redactUrlForLog("/auth/claim?token=abc123")).toBe("/auth/claim?token=%5BREDACTED%5D");
    expect(redactUrlForLog("/auth/register/pending?token=t&x=1")).toContain("token=%5BREDACTED%5D");
    expect(redactUrlForLog("/auth/register/pending?token=t&x=1")).toContain("x=1");
    const oauth = redactUrlForLog("/api/auth/oauth/github/callback?code=abc&state=xyz")!;
    expect(oauth).not.toContain("abc");
    expect(oauth).not.toContain("xyz");
    expect(oauth.startsWith("/api/auth/oauth/github/callback?")).toBe(true);
  });

  it("leaves URLs without a query string untouched", () => {
    expect(redactUrlForLog("/graphql")).toBe("/graphql");
    expect(redactUrlForLog(undefined)).toBeUndefined();
  });
});
