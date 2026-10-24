import { AppError } from "../../shared/errors.js";
import { gitlabGet, gitlabRequest, type GitHttpFetch } from "../git-credentials.js";

interface GitlabHook { id: number; url: string }

export async function gitlabWebhookAuthMode(host: string, token: string, httpFetch: GitHttpFetch): Promise<"hmac" | "token"> {
  const version = await gitlabGet<{ version: string }>(new URL(`https://${host}/api/v4/version`), token, httpFetch, host);
  if (!/^\d+\./.test(version.version)) throw new AppError("GATEWAY_ERROR", "Could not determine GitLab webhook capabilities.");
  return Number(version.version.split(".")[0]) >= 19 ? "hmac" : "token";
}

export async function connectGitlabHook(input: { host: string; projectId: string; url: string; mode: string; secret: string; token: string; httpFetch: GitHttpFetch }): Promise<string> {
  const base = `https://${input.host}/api/v4/projects/${encodeURIComponent(input.projectId)}/hooks`;
  let existing: GitlabHook | undefined;
  for (let page = 1; page <= 10; page += 1) {
    const hooks = await gitlabGet<GitlabHook[]>(new URL(`${base}?per_page=100&page=${page}`), input.token, input.httpFetch, input.host);
    if (!Array.isArray(hooks)) throw new AppError("GATEWAY_ERROR", "Invalid GitLab webhook list.");
    existing = hooks.find((hook) => hook.url === input.url);
    if (existing || hooks.length < 100) break;
    if (page === 10) throw new AppError("GATEWAY_ERROR", "Too many repository webhooks to resolve the Marrow hook.");
  }
  const body = { url: input.url, name: "Marrow issues", issues_events: true, confidential_issues_events: false,
    push_events: false, note_events: false, merge_requests_events: false, enable_ssl_verification: true,
    ...(input.mode === "hmac" ? { signing_token: input.secret } : { token: input.secret }) };
  const response = await gitlabRequest(new URL(existing ? `${base}/${existing.id}` : base), input.token, input.httpFetch, input.host,
    { method: existing ? "PUT" : "POST", body });
  const hook = await response.json() as GitlabHook;
  if (!Number.isSafeInteger(hook.id) || hook.id < 1) throw new AppError("GATEWAY_ERROR", "Invalid GitLab webhook response.");
  return String(hook.id);
}

export async function disconnectGitlabHook(host: string, projectId: string, hookId: string, token: string, httpFetch: GitHttpFetch): Promise<void> {
  try {
    await gitlabRequest(new URL(`https://${host}/api/v4/projects/${encodeURIComponent(projectId)}/hooks/${encodeURIComponent(hookId)}`), token, httpFetch, host, { method: "DELETE" });
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "NOT_FOUND") throw error;
  }
}
