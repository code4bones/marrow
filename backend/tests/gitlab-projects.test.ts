import { describe, expect, it, vi } from "vitest";
import { fetchGitlabUser, parseGitlabRepositoryUrl, searchGitlabUsers } from "../src/gateway/gitlab-projects.js";
import { gatewayToolSpecs } from "../src/gateway/tool-definitions.js";

describe("GitLab project settings", () => {
  it("normalizes clone URLs and preserves nested namespaces and ports", () => {
    expect(parseGitlabRepositoryUrl("https://GitLab.example.com:8443/team/group/backend.git/")).toEqual({ host: "gitlab.example.com:8443", path: "team/group/backend" });
  });

  it.each([
    "https://user:password@gitlab.example.com/group/repo", "http://gitlab.example.com/group/repo",
    "https://gitlab.example.com/group/repo?private_token=secret", "https://gitlab.example.com/group/repo#x",
    "https://gitlab.example.com/group/repo/-/issues", "https://gitlab.example.com/group", "not a URL",
    "https://gitlab.example.com/group/repo%ZZ", "https://gitlab.example.com/group%2F..%2Frepo",
  ])("rejects non-repository URL %s", (value) => {
    expect(() => parseGitlabRepositoryUrl(value)).toThrow();
  });

  it("encodes search input and returns only user identity fields", async () => {
    const httpFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([
      { id: 318, username: "ivan-dev", name: "Ivan", email: "hidden@example.com", extra: "private" },
    ])));
    expect(await searchGitlabUsers("gitlab.example.com", "Ivan & team", "stored-token", httpFetch)).toEqual([
      { gitlabUserId: "318", username: "ivan-dev", name: "Ivan" },
    ]);
    const [url, init] = httpFetch.mock.calls[0];
    expect(new URL(String(url)).searchParams.get("search")).toBe("Ivan & team");
    expect(init).toMatchObject({ redirect: "manual", headers: { "PRIVATE-TOKEN": "stored-token" } });
  });

  it("does not follow a GitLab redirect with the stored token", async () => {
    const httpFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://other.example.com/" } }));
    await expect(fetchGitlabUser("gitlab.example.com", "318", "stored-token", httpFetch)).rejects.toMatchObject({ code: "GATEWAY_ERROR" });
    expect(httpFetch).toHaveBeenCalledTimes(1);
  });

  it("enforces a bounded search and numeric user IDs at the tool boundary", () => {
    const search = gatewayToolSpecs.find((spec) => spec.name === "project.gitlab_users_search")!;
    expect(search.schema.safeParse({ project: "marrow", host: "gitlab.example.com", query: "a" }).success).toBe(false);
    expect(search.schema.safeParse({ project: "marrow", host: "gitlab.example.com", query: "iv" }).success).toBe(true);
    const set = gatewayToolSpecs.find((spec) => spec.name === "project.member_gitlab_set")!;
    expect(set.schema.safeParse({ project: "marrow", host: "gitlab.example.com", userId: "u", gitlabUserId: "../user" }).success).toBe(false);
  });
});
