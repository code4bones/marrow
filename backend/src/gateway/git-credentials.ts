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

export interface GitRunner {
  id: number;
  description: string;
  ipAddress: string | null;
  online: boolean;
  status: string;
  isSharedRunner: boolean;
  runnerType: string;
}

interface GitlabRunner {
  id: number;
  description: string;
  ip_address: string | null;
  online: boolean;
  status: string;
  is_shared: boolean;
  runner_type: string;
}

/**
 * Lists the runners available to a project (its own specific runners plus
 * any shared/group runners assigned to it) via GitLab's project-scoped
 * runners endpoint -- deliberately GET /projects/:id/runners, not the
 * instance-wide GET /runners/all, since the latter requires the token's
 * owner to be a GitLab instance admin, while this one only needs the same
 * project-level read access git.pipeline_status/git.job_trace already rely
 * on. `online`/`status` reflect GitLab's own heartbeat-based connectivity
 * classification (online/offline/stale/never_contacted) -- there is no
 * separate "currently running a job" flag in this endpoint's response.
 */
export async function fetchGitlabRunnersStatus(input: {
  host: string;
  project: string;
  token: string;
  httpFetch: GitHttpFetch;
}): Promise<GitRunner[]> {
  const { host, project, token, httpFetch } = input;
  const projectPath = encodeURIComponent(project);
  const runnersUrl = new URL(`${gitlabBaseUrl(host)}/projects/${projectPath}/runners`);
  runnersUrl.searchParams.set("per_page", "100");
  const runners = await gitlabGet<GitlabRunner[]>(runnersUrl, token, httpFetch, host);
  return runners.map((runner) => ({
    id: runner.id,
    description: runner.description,
    ipAddress: runner.ip_address,
    online: runner.online,
    status: runner.status,
    isSharedRunner: runner.is_shared,
    runnerType: runner.runner_type
  }));
}

async function gitlabRequest(
  url: URL,
  token: string,
  httpFetch: GitHttpFetch,
  host: string,
  init?: { method: string; body?: unknown }
): Promise<Response> {
  let response: Response;
  try {
    response = await httpFetch(url.toString(), {
      method: init?.method ?? "GET",
      headers: {
        "PRIVATE-TOKEN": token,
        ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {})
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined
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

async function gitlabPost<T>(url: URL, token: string, httpFetch: GitHttpFetch, host: string, body: unknown): Promise<T> {
  const response = await gitlabRequest(url, token, httpFetch, host, { method: "POST", body });
  return (await response.json()) as T;
}

async function gitlabPut<T>(url: URL, token: string, httpFetch: GitHttpFetch, host: string, body: unknown): Promise<T> {
  const response = await gitlabRequest(url, token, httpFetch, host, { method: "PUT", body });
  return (await response.json()) as T;
}

async function gitlabDelete(url: URL, token: string, httpFetch: GitHttpFetch, host: string): Promise<void> {
  await gitlabRequest(url, token, httpFetch, host, { method: "DELETE" });
}

// GitLab's job trace endpoint (GET .../jobs/:id/trace) returns plain text,
// not JSON -- everything else this file talks to does.
async function gitlabGetText(url: URL, token: string, httpFetch: GitHttpFetch, host: string): Promise<string> {
  const response = await gitlabRequest(url, token, httpFetch, host);
  return response.text();
}

export interface GitVariable {
  key: string;
  value: string;
  variableType: string;
  protected: boolean;
  masked: boolean;
  raw: boolean;
  environmentScope: string;
  description: string | null;
}

interface GitlabVariable {
  variable_type: string;
  key: string;
  value: string;
  protected: boolean;
  masked: boolean;
  raw: boolean;
  environment_scope: string;
  description: string | null;
}

// Owner's explicit call (2026-09-13): mask a variable's `value` ONLY when
// GitLab itself flags that specific variable `masked: true` (a real secret,
// per GitLab's own CI/CD UI checkbox) -- never a blanket "hide everything"
// pass. `redact` defaults to true (same convention as git.job_trace's own
// redact param) so a routine "what variables exist" listing doesn't dump
// secrets into an agent's context/logs by default, but an agent that
// genuinely needs a masked variable's real value (e.g. to reuse it in a
// script) can still get it by passing redact:false explicitly -- the same
// escape hatch job_trace already offers for its own redaction.
function toGitVariable(v: GitlabVariable, redact: boolean): GitVariable {
  return {
    key: v.key,
    value: redact && v.masked ? "[MASKED]" : v.value,
    variableType: v.variable_type,
    protected: v.protected,
    masked: v.masked,
    raw: v.raw,
    environmentScope: v.environment_scope,
    description: v.description
  };
}

/** Lists a project's CI/CD variables (GET /projects/:id/variables). GitLab caps this at 100/page; a project with more than 100 variables would need real pagination, not attempted here since none of this instance's known projects are anywhere close. */
export async function fetchGitlabVariablesList(input: {
  host: string;
  project: string;
  redact?: boolean;
  token: string;
  httpFetch: GitHttpFetch;
}): Promise<GitVariable[]> {
  const { host, project, token, httpFetch } = input;
  const redact = input.redact !== false;
  const projectPath = encodeURIComponent(project);
  const url = new URL(`${gitlabBaseUrl(host)}/projects/${projectPath}/variables`);
  url.searchParams.set("per_page", "100");
  const variables = await gitlabGet<GitlabVariable[]>(url, token, httpFetch, host);
  return variables.map((v) => toGitVariable(v, redact));
}

/**
 * Gets one CI/CD variable by key (GET /projects/:id/variables/:key).
 * `environmentScope` disambiguates when the same key exists more than once
 * with different scopes (GitLab's own `filter[environment_scope]` query
 * param) -- omitted, GitLab resolves to the `*` (all environments) entry.
 */
export async function fetchGitlabVariableGet(input: {
  host: string;
  project: string;
  key: string;
  environmentScope?: string;
  redact?: boolean;
  token: string;
  httpFetch: GitHttpFetch;
}): Promise<GitVariable> {
  const { host, project, key, token, httpFetch } = input;
  const redact = input.redact !== false;
  const projectPath = encodeURIComponent(project);
  const url = new URL(`${gitlabBaseUrl(host)}/projects/${projectPath}/variables/${encodeURIComponent(key)}`);
  if (input.environmentScope) {
    url.searchParams.set("filter[environment_scope]", input.environmentScope);
  }
  const variable = await gitlabGet<GitlabVariable>(url, token, httpFetch, host);
  return toGitVariable(variable, redact);
}

/**
 * Upsert: tries PUT (update) first since an agent adjusting a variable's
 * value is the more common case than minting a brand new one; falls back to
 * POST (create) only on a 404, rather than doing a separate existence-check
 * GET first (one round trip instead of two in the common "already exists"
 * path). Never redacts its own response -- the caller just supplied this
 * exact value themselves, redacting it back to them would be pointless.
 */
export async function fetchGitlabVariableSet(input: {
  host: string;
  project: string;
  key: string;
  value: string;
  protected?: boolean;
  masked?: boolean;
  raw?: boolean;
  variableType?: string;
  environmentScope?: string;
  description?: string;
  token: string;
  httpFetch: GitHttpFetch;
}): Promise<GitVariable> {
  const { host, project, key, token, httpFetch } = input;
  const projectPath = encodeURIComponent(project);
  const body: Record<string, unknown> = { value: input.value };
  if (input.protected !== undefined) body.protected = input.protected;
  if (input.masked !== undefined) body.masked = input.masked;
  if (input.raw !== undefined) body.raw = input.raw;
  if (input.variableType !== undefined) body.variable_type = input.variableType;
  if (input.environmentScope !== undefined) body.environment_scope = input.environmentScope;
  if (input.description !== undefined) body.description = input.description;

  const updateUrl = new URL(`${gitlabBaseUrl(host)}/projects/${projectPath}/variables/${encodeURIComponent(key)}`);
  if (input.environmentScope) {
    updateUrl.searchParams.set("filter[environment_scope]", input.environmentScope);
  }
  try {
    const updated = await gitlabPut<GitlabVariable>(updateUrl, token, httpFetch, host, body);
    return toGitVariable(updated, false);
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "NOT_FOUND") {
      throw error;
    }
  }
  const createUrl = new URL(`${gitlabBaseUrl(host)}/projects/${projectPath}/variables`);
  const created = await gitlabPost<GitlabVariable>(createUrl, token, httpFetch, host, { key, ...body });
  return toGitVariable(created, false);
}

/** Deletes one CI/CD variable by key (DELETE /projects/:id/variables/:key). `environmentScope` disambiguates the same way fetchGitlabVariableGet's does. */
export async function fetchGitlabVariableDelete(input: {
  host: string;
  project: string;
  key: string;
  environmentScope?: string;
  token: string;
  httpFetch: GitHttpFetch;
}): Promise<void> {
  const { host, project, key, token, httpFetch } = input;
  const projectPath = encodeURIComponent(project);
  const url = new URL(`${gitlabBaseUrl(host)}/projects/${projectPath}/variables/${encodeURIComponent(key)}`);
  if (input.environmentScope) {
    url.searchParams.set("filter[environment_scope]", input.environmentScope);
  }
  await gitlabDelete(url, token, httpFetch, host);
}

export interface GitPipelineTriggerResult {
  id: number;
  status: string;
  ref: string;
  sha: string;
  webUrl: string;
}

interface GitlabPipelineCreateResponse {
  id: number;
  status: string;
  ref: string;
  sha: string;
  web_url: string;
}

/**
 * Starts a new pipeline run (POST /projects/:id/pipeline -- GitLab's "create
 * a new pipeline" endpoint, not a trigger-token webhook, since this already
 * authenticates via the caller's own stored PAT). `variables` become
 * pipeline-run-scoped CI/CD variables layered on top of the project's
 * stored ones for this one run only, exactly like GitLab's own "Run
 * pipeline" UI form's variable rows.
 */
export async function fetchGitlabPipelineTrigger(input: {
  host: string;
  project: string;
  ref: string;
  variables?: Record<string, string>;
  token: string;
  httpFetch: GitHttpFetch;
}): Promise<GitPipelineTriggerResult> {
  const { host, project, ref, token, httpFetch } = input;
  const projectPath = encodeURIComponent(project);
  const url = new URL(`${gitlabBaseUrl(host)}/projects/${projectPath}/pipeline`);
  const body: Record<string, unknown> = { ref };
  if (input.variables && Object.keys(input.variables).length > 0) {
    body.variables = Object.entries(input.variables).map(([key, value]) => ({ key, value }));
  }
  const created = await gitlabPost<GitlabPipelineCreateResponse>(url, token, httpFetch, host, body);
  return {
    id: created.id,
    status: created.status,
    ref: created.ref,
    sha: created.sha,
    webUrl: created.web_url
  };
}
