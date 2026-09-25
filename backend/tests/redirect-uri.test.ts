import { describe, expect, it } from "vitest";
import { redirectUriProblem } from "../src/gateway/redirect-uri.js";

// T-MEMORY-165: the consent page navigates to a connector's redirect_uri, so
// anything but https (or loopback http) is script execution on our origin.
describe("redirectUriProblem", () => {
  it.each([
    "https://claude.ai/api/mcp/auth_callback",
    "https://chatgpt.com/connector/oauth/abc",
    "http://localhost:8080/cb",
    "http://127.0.0.1/cb",
    "http://[::1]:3000/cb"
  ])("accepts %s", (value) => {
    expect(redirectUriProblem(value)).toBeNull();
  });

  it.each([
    "javascript:fetch('/api/auth/profile/personal-tokens')//",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:x",
    "file:///etc/passwd",
    "http://evil.example/cb",
    "https://user:pw@example.com/cb",
    "https://example.com/cb#fragment",
    "/relative/path",
    ""
  ])("rejects %s", (value) => {
    expect(redirectUriProblem(value)).not.toBeNull();
  });
});
