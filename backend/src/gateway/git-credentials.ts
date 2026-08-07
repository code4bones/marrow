// T-MEMORY-044: git host credentials (GitLab personal access tokens today —
// see the task record for why this is scoped to GitLab only in this pass)
// plus the server-side proxy that uses them to answer pipeline-status
// questions without the raw token ever leaving the gateway.
//
// Encryption reuses totp.ts's AES-256-GCM cipher/format (via crypto.ts's
// extracted aesGcmEncrypt/aesGcmDecrypt) but under its OWN key,
// GIT_CREDENTIAL_ENC_KEY, not TOTP_ENC_KEY. A git host PAT and a TOTP seed
// are different secret classes with different blast radii if the key
// leaks (a git PAT can touch a repo/CI system outside this application
// entirely) — giving them independently rotatable keys is worth the one
// extra env var, and matches the task record's own note that this was an
// implementation decision to make, not settled by the spec.
import { AppError } from "../shared/errors.js";
import { aesGcmDecrypt, aesGcmEncrypt, loadAesGcmKey } from "./crypto.js";

function gitCredentialEncryptionKey(): Buffer {
  try {
    return loadAesGcmKey("GIT_CREDENTIAL_ENC_KEY");
  } catch {
    throw new AppError(
      "VALIDATION_ERROR",
      "GIT_CREDENTIAL_ENC_KEY must be set to a 32-byte base64 value to store git host tokens."
    );
  }
}

export function encryptGitToken(token: string): string {
  return aesGcmEncrypt(gitCredentialEncryptionKey(), token);
}

export function decryptGitToken(enc: string): string {
  return aesGcmDecrypt(gitCredentialEncryptionKey(), enc, "Stored git credential token is malformed.");
}

/** Last 4 characters only, for UI/list-view recognition. Never enough to reconstruct or brute-force the token from. */
export function tokenHint(token: string): string {
  return token.length <= 4 ? token : token.slice(-4);
}

export interface GitPipelineJob {
  name: string;
  status: string;
}

export interface GitPipelineStatusResult {
  status: string;
  ref: string;
  sha: string;
  webUrl: string;
  jobs: GitPipelineJob[];
}

/**
 * Minimal fetch-shaped seam so callers (and smoke tests, T-MEMORY-044's
 * acceptance criteria explicitly asks for this to be substitutable rather
 * than hitting a real GitLab instance) can inject a fake HTTP client instead
 * of the real `fetch`. Intentionally just `typeof fetch` — no bespoke
 * wrapper type — so a real `fetch` satisfies it with zero adaptation and a
 * fake only needs to match the same call signature/return shape.
 */
export type GitHttpFetch = typeof fetch;

interface GitlabPipeline {
  id: number;
  status: string;
  ref: string;
  sha: string;
  web_url: string;
}

interface GitlabJob {
  name: string;
  status: string;
}

/**
 * Calls a GitLab instance's REST API (read-only: list pipelines for a
 * project/ref, then the latest pipeline's jobs) using the caller's stored
 * PAT. The token is used here, server-side, and never returned to the
 * caller — see git.pipeline_status in pg-tool-service.ts, which is the only
 * caller of this function and never puts `token` into its own response.
 */
export async function fetchGitlabPipelineStatus(input: {
  host: string;
  project: string;
  ref?: string;
  token: string;
  httpFetch: GitHttpFetch;
}): Promise<GitPipelineStatusResult> {
  const { host, project, ref, token, httpFetch } = input;
  const baseUrl = `https://${host}/api/v4`;
  const projectPath = encodeURIComponent(project);
  const pipelinesUrl = new URL(`${baseUrl}/projects/${projectPath}/pipelines`);
  if (ref) {
    pipelinesUrl.searchParams.set("ref", ref);
  }
  pipelinesUrl.searchParams.set("per_page", "1");

  const pipelines = await gitlabGet<GitlabPipeline[]>(pipelinesUrl, token, httpFetch, host);
  const latest = pipelines[0];
  if (!latest) {
    throw new AppError(
      "NOT_FOUND",
      ref
        ? `No pipelines found for project ${project} on ${host} (ref ${ref}).`
        : `No pipelines found for project ${project} on ${host}.`,
      { host, project, ref: ref ?? null }
    );
  }

  const jobsUrl = new URL(`${baseUrl}/projects/${projectPath}/pipelines/${latest.id}/jobs`);
  jobsUrl.searchParams.set("per_page", "100");
  const jobs = await gitlabGet<GitlabJob[]>(jobsUrl, token, httpFetch, host);

  return {
    status: latest.status,
    ref: latest.ref,
    sha: latest.sha,
    webUrl: latest.web_url,
    jobs: jobs.map((job) => ({ name: job.name, status: job.status }))
  };
}

async function gitlabGet<T>(url: URL, token: string, httpFetch: GitHttpFetch, host: string): Promise<T> {
  let response: Response;
  try {
    response = await httpFetch(url.toString(), {
      method: "GET",
      headers: { "PRIVATE-TOKEN": token }
    });
  } catch (error) {
    throw new AppError(
      "GATEWAY_ERROR",
      `Could not reach GitLab host ${host}: ${error instanceof Error ? error.message : String(error)}`,
      { host }
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new AppError(
      "UNAUTHORIZED",
      `GitLab rejected the stored token for ${host} (HTTP ${response.status}). The token may be expired or revoked — add a fresh one in your profile.`,
      { host, status: response.status }
    );
  }
  if (!response.ok) {
    throw new AppError(
      "GATEWAY_ERROR",
      `GitLab API request to ${host} failed (HTTP ${response.status}).`,
      { host, status: response.status, url: url.pathname }
    );
  }
  return (await response.json()) as T;
}
