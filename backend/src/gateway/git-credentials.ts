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
  id: number;
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

export interface GitJobTraceResult {
  jobId: number;
  jobName: string;
  jobStatus: string;
  trace: string;
  truncated: boolean;
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
  id: number;
  name: string;
  status: string;
}

function gitlabBaseUrl(host: string): string {
  return `https://${host}/api/v4`;
}

async function fetchLatestGitlabPipeline(
  host: string,
  project: string,
  ref: string | undefined,
  token: string,
  httpFetch: GitHttpFetch
): Promise<GitlabPipeline> {
  const projectPath = encodeURIComponent(project);
  const pipelinesUrl = new URL(`${gitlabBaseUrl(host)}/projects/${projectPath}/pipelines`);
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
  return latest;
}

async function fetchGitlabPipelineJobs(
  host: string,
  project: string,
  pipelineId: number,
  token: string,
  httpFetch: GitHttpFetch
): Promise<GitlabJob[]> {
  const projectPath = encodeURIComponent(project);
  const jobsUrl = new URL(`${gitlabBaseUrl(host)}/projects/${projectPath}/pipelines/${pipelineId}/jobs`);
  jobsUrl.searchParams.set("per_page", "100");
  return gitlabGet<GitlabJob[]>(jobsUrl, token, httpFetch, host);
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
  const latest = await fetchLatestGitlabPipeline(host, project, ref, token, httpFetch);
  const jobs = await fetchGitlabPipelineJobs(host, project, latest.id, token, httpFetch);

  return {
    status: latest.status,
    ref: latest.ref,
    sha: latest.sha,
    webUrl: latest.web_url,
    jobs: jobs.map((job) => ({ id: job.id, name: job.name, status: job.status }))
  };
}

const DEFAULT_TRACE_TAIL_LINES = 200;
const MAX_TRACE_TAIL_LINES = 2000;

// Best-effort secondary redaction pass. GitLab already masks any CI/CD
// variable actually flagged `masked` in its own trace output server-side --
// this is defense in depth for secrets that leak into a job's plain stdout
// unmasked (a printed env var, a tool's own verbose/debug output), not a
// substitute for marking real secrets as masked variables in GitLab itself.
// Necessarily imperfect (can't catch what it doesn't recognize the shape
// of) -- on by default because the failure mode of over-redacting a build
// log is annoying, the failure mode of leaking a token in a shared gateway
// response is not.
const SECRET_LINE_PATTERNS: RegExp[] = [
  /((?:token|password|passwd|secret|api[_-]?key|access[_-]?key)\s*[:=]\s*)\S+/gi,
  /\b(Authorization:\s*Bearer\s+)\S+/gi,
  /\b(glpat-|gho_|ghp_|ghs_|github_pat_)\S+/gi,
  /\bAKIA[0-9A-Z]{16}\b/g
];

function redactTrace(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_LINE_PATTERNS) {
    redacted = redacted.replace(pattern, (match, prefix?: string) =>
      prefix ? `${prefix}[REDACTED]` : "[REDACTED]"
    );
  }
  return redacted;
}

function tailLines(text: string, maxLines: number): { text: string; truncated: boolean } {
  const lines = text.split("\n");
  if (lines.length <= maxLines) {
    return { text, truncated: false };
  }
  return { text: lines.slice(lines.length - maxLines).join("\n"), truncated: true };
}

/**
 * Resolves a job's raw log via GitLab's job trace endpoint (plain text, not
 * JSON -- see gitlabGetText below) and returns just its tail, optionally
 * redacted. `jobId` takes priority when given; otherwise resolves the
 * latest pipeline for `ref` and finds a job matching `jobName` within it,
 * so a caller that already has a job id from git.pipeline_status can skip
 * straight to it, and one that only knows "which job failed by name" still
 * doesn't have to make two separate tool calls.
 */
export async function fetchGitlabJobTrace(input: {
  host: string;
  project: string;
  jobId?: number;
  ref?: string;
  jobName?: string;
  tailLines?: number;
  redact?: boolean;
  token: string;
  httpFetch: GitHttpFetch;
}): Promise<GitJobTraceResult> {
  const { host, project, token, httpFetch } = input;
  const maxLines = Math.min(Math.max(input.tailLines ?? DEFAULT_TRACE_TAIL_LINES, 1), MAX_TRACE_TAIL_LINES);
  const shouldRedact = input.redact !== false;

  let job: GitlabJob;
  if (typeof input.jobId === "number") {
    const projectPath = encodeURIComponent(project);
    const jobUrl = new URL(`${gitlabBaseUrl(host)}/projects/${projectPath}/jobs/${input.jobId}`);
    job = await gitlabGet<GitlabJob>(jobUrl, token, httpFetch, host);
  } else if (input.jobName) {
    const latest = await fetchLatestGitlabPipeline(host, project, input.ref, token, httpFetch);
    const jobs = await fetchGitlabPipelineJobs(host, project, latest.id, token, httpFetch);
    const match = jobs.find((j) => j.name === input.jobName);
    if (!match) {
      throw new AppError(
        "NOT_FOUND",
        `No job named "${input.jobName}" found in the latest pipeline for ${project} on ${host}${input.ref ? ` (ref ${input.ref})` : ""}.`,
        { host, project, ref: input.ref ?? null, jobName: input.jobName, availableJobs: jobs.map((j) => j.name) }
      );
    }
    job = match;
  } else {
    throw new AppError("VALIDATION_ERROR", "git.job_trace requires either jobId or jobName.");
  }

  const projectPath = encodeURIComponent(project);
  const traceUrl = new URL(`${gitlabBaseUrl(host)}/projects/${projectPath}/jobs/${job.id}/trace`);
  const rawTrace = await gitlabGetText(traceUrl, token, httpFetch, host);
  const { text: tailed, truncated } = tailLines(rawTrace, maxLines);

  return {
    jobId: job.id,
    jobName: job.name,
    jobStatus: job.status,
    trace: shouldRedact ? redactTrace(tailed) : tailed,
    truncated
  };
}

async function gitlabRequest(url: URL, token: string, httpFetch: GitHttpFetch, host: string): Promise<Response> {
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
  if (response.status === 404) {
    throw new AppError(
      "NOT_FOUND",
      `GitLab returned 404 for ${url.pathname} on ${host}.`,
      { host, status: response.status, url: url.pathname }
    );
  }
  if (!response.ok) {
    throw new AppError(
      "GATEWAY_ERROR",
      `GitLab API request to ${host} failed (HTTP ${response.status}).`,
      { host, status: response.status, url: url.pathname }
    );
  }
  return response;
}

async function gitlabGet<T>(url: URL, token: string, httpFetch: GitHttpFetch, host: string): Promise<T> {
  const response = await gitlabRequest(url, token, httpFetch, host);
  return (await response.json()) as T;
}

// GitLab's job trace endpoint (GET .../jobs/:id/trace) returns plain text,
// not JSON -- everything else this file talks to does.
async function gitlabGetText(url: URL, token: string, httpFetch: GitHttpFetch, host: string): Promise<string> {
  const response = await gitlabRequest(url, token, httpFetch, host);
  return response.text();
}
