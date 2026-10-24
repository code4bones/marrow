import { AppError } from "../shared/errors.js";
import { gitHostProblem } from "./git-host-safety.js";
import { gitlabGet, type GitHttpFetch } from "./git-credentials.js";

export function parseGitlabRepositoryUrl(value: string): { host: string; path: string } {
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError("VALIDATION_ERROR", "Enter an HTTPS GitLab repository URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || gitHostProblem(url.host)) {
    throw new AppError("VALIDATION_ERROR", "Enter an HTTPS GitLab repository URL without credentials, query or fragment.");
  }
  let path: string;
  try { path = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, "").replace(/\.git$/, ""); }
  catch { throw new AppError("VALIDATION_ERROR", "Invalid repository path."); }
  const parts = path.split("/");
  if (parts.length < 2 || parts.some((part) => !part || [".", "..", "-"].includes(part) || !/^[\w.-]+$/.test(part))) {
    throw new AppError("VALIDATION_ERROR", "Use the repository URL, for example https://gitlab.example.com/group/repository.");
  }
  return { host: url.host.toLowerCase(), path };
}

export interface GitlabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  web_url: string;
}

export interface GitlabUser {
  id: number;
  username: string;
  name: string;
}

export function gitlabUserOut(user: GitlabUser) {
  if (!Number.isSafeInteger(user.id) || user.id < 1 || !user.username || typeof user.name !== "string") {
    throw new AppError("GATEWAY_ERROR", "GitLab returned an invalid user.");
  }
  return { gitlabUserId: String(user.id), username: user.username, name: user.name };
}

export function fetchGitlabProject(host: string, path: string, token: string, httpFetch: GitHttpFetch) {
  return gitlabGet<GitlabProject>(new URL(`https://${host}/api/v4/projects/${encodeURIComponent(path)}`), token, httpFetch, host);
}

export async function searchGitlabUsers(host: string, query: string, token: string, httpFetch: GitHttpFetch) {
  const url = new URL(`https://${host}/api/v4/users`);
  url.search = new URLSearchParams({ search: query, active: "true", per_page: "20" }).toString();
  const users = await gitlabGet<GitlabUser[]>(url, token, httpFetch, host);
  if (!Array.isArray(users)) throw new AppError("GATEWAY_ERROR", "GitLab returned an invalid user list.");
  return users.map(gitlabUserOut);
}

export async function fetchGitlabUser(host: string, id: string, token: string, httpFetch: GitHttpFetch) {
  return gitlabUserOut(await gitlabGet<GitlabUser>(new URL(`https://${host}/api/v4/users/${encodeURIComponent(id)}`), token, httpFetch, host));
}
