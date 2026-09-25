import { describe, expect, it } from "vitest";
import { assertPublicGitHost, gitHostProblem, isNonPublicAddress } from "../src/gateway/git-host-safety.js";

// T-MEMORY-170: the git host string ends up in an outbound request.
describe("gitHostProblem", () => {
  it.each(["gitlab.codup.pro", "gitlab.undoo.ru", "git.example.com:8443", "gitlab", "203.0.113.5"])(
    "accepts %s",
    (host) => {
      expect(gitHostProblem(host)).toBeNull();
    }
  );

  it.each([
    "10.0.0.5:8443/internal/x#", "host/path", "host?x=1", "host#frag", "user:pw@host", "user@host", "https://host",
    "host:0", "host:65536", "host:", "", " host", "ho st", "[::1]", "-bad.example.com", "bad-.example.com",
    "a..b", "host\n", "host\\evil"
  ])("rejects %j", (host) => {
    expect(gitHostProblem(host)).not.toBeNull();
  });
});

describe("isNonPublicAddress", () => {
  it.each([
    "127.0.0.1", "127.9.9.9", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254",
    "::ffff:7f00:1", "2001:db8::1", "not-an-ip"
  ])("%s is non-public", (address) => {
    expect(isNonPublicAddress(address)).toBe(true);
  });

  it.each(["157.22.230.217", "95.165.150.249", "8.8.8.8", "172.32.0.1", "172.15.255.255", "2606:4700:4700::1111"])(
    "%s is public",
    (address) => {
      expect(isNonPublicAddress(address)).toBe(false);
    }
  );
});

describe("assertPublicGitHost", () => {
  it("rejects hosts that resolve to loopback", async () => {
    await expect(assertPublicGitHost("localhost")).rejects.toThrow(/non-public/);
    await expect(assertPublicGitHost("127.0.0.1:8080")).rejects.toThrow(/non-public/);
    await expect(assertPublicGitHost("169.254.169.254")).rejects.toThrow(/non-public/);
  });

  it("can be relaxed for a private-network GitLab via GIT_ALLOW_PRIVATE_HOSTS", async () => {
    process.env.GIT_ALLOW_PRIVATE_HOSTS = "1";
    try {
      await expect(assertPublicGitHost("127.0.0.1")).resolves.toBeUndefined();
    } finally {
      delete process.env.GIT_ALLOW_PRIVATE_HOSTS;
    }
  });
});
