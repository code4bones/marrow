import { randomBytes, randomUUID } from "node:crypto";
import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import { fetchGitlabProject, fetchGitlabUser, parseGitlabRepositoryUrl, searchGitlabUsers } from "../../gitlab-projects.js";
import type { Constructor } from "../base.js";
import type { Tier1Instance } from "../core/links-core.mixin.js";
import type { NormalizedGatewayRequestContext, Row } from "../types.js";
import type { GitCredentialsInstance } from "./git-credentials.mixin.js";
import { decryptGitToken, encryptGitToken } from "../../git-credentials.js";
import { connectGitlabHook, disconnectGitlabHook, gitlabWebhookAuthMode } from "../../gitlab-webhooks/remote.js";
import { gitlabWebhookStatus } from "../../gitlab-webhooks/receiver.js";

function repositoryOut(row: Row) {
  return { id: row.id, projectId: row.project_id, host: row.host, gitlabProjectId: row.gitlab_project_id,
    path: row.path, name: row.name, webUrl: row.web_url, leadUserId: row.lead_user_id ?? null,
    leadEmail: row.lead_email ?? null, createdAt: row.created_at };
}

function mappingOut(row: Row) {
  return { userId: row.user_id, host: row.host, gitlabUserId: row.gitlab_user_id, username: row.username, name: row.name };
}

export function ProjectGitlabMixin<TBase extends Constructor<Tier1Instance & GitCredentialsInstance>>(Base: TBase) {
  return class extends Base {
    protected async projectRepositories(input: Row, context: NormalizedGatewayRequestContext) {
      const project = await this.resolveProject(input.project, context);
      const rows = await this.db("project_repositories").leftJoin("users as lead", "lead.id", "project_repositories.lead_user_id")
        .where({ "project_repositories.project_id": project.id }).select("project_repositories.*", "lead.email as lead_email").orderBy("host").orderBy("path");
      return { repositories: await Promise.all(rows.map(async (row) => ({ ...repositoryOut(row), webhook: await gitlabWebhookStatus(this.db, String(row.id)) }))) };
    }

    protected async setProjectRepositoryLead(input: Row, context: NormalizedGatewayRequestContext) {
      const project = await this.resolveProject(input.project, context);
      await this.assertProjectOwnerOrAdmin(project, context);
      const userId = input.userId === null ? null : String(input.userId);
      await this.db.transaction(async (trx) => {
        const repo = await trx("project_repositories").where({ id: input.id, project_id: project.id }).forUpdate().first();
        if (!repo) throw new AppError("NOT_FOUND", "Repository not found in this project.");
        if (userId) {
          const user = await trx("users").where({ id: userId, status: "active" }).first();
          const member = await trx("project_members").where({ project_id: project.id, user_id: userId, status: "active" }).forShare().first();
          if (!user || (!member && project.ownerUserId !== userId)) throw new AppError("VALIDATION_ERROR", "Select an active member of this project as lead developer.");
        }
        await trx("project_repositories").where({ id: repo.id }).update({ lead_user_id: userId });
      });
      await this.recordEventForProject(project.id, {
        type: "project.repository_lead_updated", title: userId ? "Repository lead developer updated" : "Repository lead developer cleared", related_id: project.id
      }, context);
      const row = await this.db("project_repositories").leftJoin("users as lead", "lead.id", "project_repositories.lead_user_id")
        .where({ "project_repositories.id": input.id }).select("project_repositories.*", "lead.email as lead_email").first();
      return repositoryOut(row);
    }

    protected async addProjectRepository(input: Row, context: NormalizedGatewayRequestContext) {
      const project = await this.resolveProject(input.project, context);
      await this.assertProjectOwnerOrAdmin(project, context);
      const { host, path } = parseGitlabRepositoryUrl(String(input.url));
      const credential = await this.resolveGitCredentialToken(host, context);
      const remote = await fetchGitlabProject(host, path, credential.token, this.gitHttpFetch);
      if (!Number.isSafeInteger(remote.id) || remote.id < 1 || !remote.name || !remote.path_with_namespace || !remote.web_url) {
        throw new AppError("GATEWAY_ERROR", "GitLab returned an invalid repository.");
      }
      const canonical = parseGitlabRepositoryUrl(remote.web_url);
      if (canonical.host !== host || canonical.path !== remote.path_with_namespace) {
        throw new AppError("GATEWAY_ERROR", "GitLab returned a repository on a different host or path.");
      }
      const row = { id: randomUUID(), project_id: project.id, host, gitlab_project_id: String(remote.id),
        path: canonical.path, name: remote.name, web_url: `https://${host}/${canonical.path}`,
        created_by: context.clientId, created_at: nowIso() };
      const inserted = await this.db("project_repositories").insert(row)
        .onConflict(["project_id", "host", "gitlab_project_id"]).ignore().returning("*");
      await this.db("git_credentials").where({ id: credential.id }).update({ last_used_at: nowIso() });
      if (inserted.length) await this.recordEventForProject(project.id, {
        type: "project.repository_added", title: `Repository added: ${host}/${canonical.path}`, related_id: project.id
      }, context);
      const stored = inserted[0] ?? await this.db("project_repositories").where({ project_id: project.id, host, gitlab_project_id: String(remote.id) }).first();
      return repositoryOut(stored);
    }

    protected async removeProjectRepository(input: Row, context: NormalizedGatewayRequestContext) {
      const project = await this.resolveProject(input.project, context);
      await this.assertProjectOwnerOrAdmin(project, context);
      await this.disconnectProjectWebhook(input, context);
      const rows = await this.db("project_repositories").where({ id: input.id, project_id: project.id }).del().returning("*");
      if (!rows.length) throw new AppError("NOT_FOUND", "Repository not found in this project.");
      await this.recordEventForProject(project.id, {
        type: "project.repository_removed", title: `Repository removed: ${rows[0].host}/${rows[0].path}`, related_id: project.id
      }, context);
      return { removed: true };
    }

    protected async connectProjectWebhook(input: Row, context: NormalizedGatewayRequestContext) {
      const project = await this.resolveProject(input.project, context);
      await this.assertProjectOwnerOrAdmin(project, context);
      const repo = await this.db("project_repositories").where({ id: input.id, project_id: project.id }).first();
      if (!repo) throw new AppError("NOT_FOUND", "Repository not found in this project.");
      const publicUrl = process.env.PROJECT_MEMORY_PUBLIC_URL?.trim().replace(/\/+$/, "");
      if (!publicUrl || !publicUrl.startsWith("https://")) throw new AppError("VALIDATION_ERROR", "Configure the public HTTPS gateway URL before enabling webhooks.");
      const url = `${publicUrl}/integrations/gitlab/webhooks/${repo.id}`;
      const credential = await this.resolveGitCredentialToken(String(repo.host), context);
      await this.db.transaction(async (trx) => {
        await trx("project_repositories").where({ id: repo.id }).forUpdate().first();
        let config = await trx("gitlab_webhooks").where({ repository_id: repo.id }).first();
        if (!config) {
          const mode = await gitlabWebhookAuthMode(String(repo.host), credential.token, this.gitHttpFetch);
          const secret = mode === "hmac" ? `whsec_${randomBytes(32).toString("base64")}` : randomBytes(32).toString("hex");
          config = { repository_id: repo.id, hook_id: null, auth_mode: mode, secret_enc: encryptGitToken(secret), enabled: false, updated_at: nowIso() };
          await trx("gitlab_webhooks").insert(config);
        }
        const hookId = await connectGitlabHook({ host: String(repo.host), projectId: String(repo.gitlab_project_id), url,
          mode: String(config.auth_mode), secret: decryptGitToken(String(config.secret_enc)), token: credential.token, httpFetch: this.gitHttpFetch });
        await trx("gitlab_webhooks").where({ repository_id: repo.id }).update({ hook_id: hookId, enabled: true, last_error: null, updated_at: nowIso() });
      });
      await this.db("git_credentials").where({ id: credential.id }).update({ last_used_at: nowIso() });
      await this.recordEventForProject(project.id, { type: "project.gitlab_webhook_connected", title: `GitLab issue import enabled: ${repo.path}`, related_id: project.id }, context);
      return gitlabWebhookStatus(this.db, String(repo.id));
    }

    protected async disconnectProjectWebhook(input: Row, context: NormalizedGatewayRequestContext) {
      const project = await this.resolveProject(input.project, context);
      await this.assertProjectOwnerOrAdmin(project, context);
      const repo = await this.db("project_repositories").where({ id: input.id, project_id: project.id }).first();
      if (!repo) throw new AppError("NOT_FOUND", "Repository not found in this project.");
      const config = await this.db("gitlab_webhooks").where({ repository_id: repo.id }).first();
      if (!config) return gitlabWebhookStatus(this.db, String(repo.id));
      // Disable receiving even when the GitLab credential was revoked.
      await this.db("gitlab_webhooks").where({ repository_id: repo.id }).update({ enabled: false, updated_at: nowIso() });
      let lastError: string | null = null;
      try {
        if (config.hook_id) {
          const credential = await this.resolveGitCredentialToken(String(repo.host), context);
          await disconnectGitlabHook(String(repo.host), String(repo.gitlab_project_id), String(config.hook_id), credential.token, this.gitHttpFetch);
        }
      } catch { lastError = "Remote webhook cleanup failed; receiving is disabled."; }
      await this.db("gitlab_webhooks").where({ repository_id: repo.id }).update({ last_error: lastError, ...(lastError ? {} : { hook_id: null }) });
      await this.recordEventForProject(project.id, { type: "project.gitlab_webhook_disconnected", title: `GitLab issue import disabled: ${repo.path}`, related_id: project.id }, context);
      return gitlabWebhookStatus(this.db, String(repo.id));
    }

    protected async retryProjectWebhookImports(input: Row, context: NormalizedGatewayRequestContext) {
      const project = await this.resolveProject(input.project, context);
      await this.assertProjectOwnerOrAdmin(project, context);
      const repo = await this.db("project_repositories").where({ id: input.id, project_id: project.id }).first();
      if (!repo) throw new AppError("NOT_FOUND", "Repository not found in this project.");
      const retried = await this.db("gitlab_issue_inbox").where({ repository_id: repo.id, status: "failed" }).update({
        status: "pending", attempts: 0, available_at: nowIso(), locked_until: null, last_error: null
      });
      return { retried };
    }

    protected async projectGitlabMappings(input: Row, context: NormalizedGatewayRequestContext) {
      const project = await this.resolveProject(input.project, context);
      await this.assertProjectOwnerOrAdmin(project, context);
      const rows = await this.db("project_gitlab_members").where({ project_id: project.id }).orderBy("host");
      return { mappings: rows.map(mappingOut) };
    }

    protected async requireProjectGitlabHost(projectId: string, host: string): Promise<void> {
      if (!await this.db("project_repositories").where({ project_id: projectId, host }).first()) {
        throw new AppError("VALIDATION_ERROR", "Add a repository on this GitLab host to the project first.");
      }
    }

    protected async projectGitlabUsersSearch(input: Row, context: NormalizedGatewayRequestContext) {
      const project = await this.resolveProject(input.project, context);
      await this.assertProjectOwnerOrAdmin(project, context);
      const host = String(input.host).toLowerCase();
      await this.requireProjectGitlabHost(project.id, host);
      const credential = await this.resolveGitCredentialToken(host, context);
      const users = await searchGitlabUsers(host, String(input.query), credential.token, this.gitHttpFetch);
      await this.db("git_credentials").where({ id: credential.id }).update({ last_used_at: nowIso() });
      return { users };
    }

    protected async setProjectMemberGitlab(input: Row, context: NormalizedGatewayRequestContext) {
      const project = await this.resolveProject(input.project, context);
      await this.assertProjectOwnerOrAdmin(project, context);
      const host = String(input.host).toLowerCase();
      const userId = String(input.userId);
      await this.requireProjectGitlabHost(project.id, host);
      const credential = await this.resolveGitCredentialToken(host, context);
      // Resolve the selected numeric ID again: names supplied by a browser are not identity evidence.
      const remote = await fetchGitlabUser(host, String(input.gitlabUserId), credential.token, this.gitHttpFetch);
      if (remote.gitlabUserId !== String(input.gitlabUserId)) throw new AppError("GATEWAY_ERROR", "GitLab returned a different user.");
      const row = { project_id: project.id, user_id: userId, host, gitlab_user_id: remote.gitlabUserId,
        username: remote.username, name: remote.name, updated_at: nowIso() };
      try {
        await this.db.transaction(async (trx) => {
          const member = await trx("project_members").where({ project_id: project.id, user_id: userId, status: "active" }).forUpdate().first();
          if (!member && project.ownerUserId !== userId) throw new AppError("VALIDATION_ERROR", "Choose an active project member.");
          await trx("project_gitlab_members").insert(row).onConflict(["project_id", "user_id", "host"])
            .merge(["gitlab_user_id", "username", "name", "updated_at"]);
        });
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw new AppError("VALIDATION_ERROR", "This GitLab user is already linked to another member of this project.");
        throw error;
      }
      await this.db("git_credentials").where({ id: credential.id }).update({ last_used_at: nowIso() });
      await this.recordEventForProject(project.id, {
        type: "project.member_gitlab_updated", title: `GitLab mapping updated: ${host}/@${remote.username}`, related_id: project.id
      }, context);
      return mappingOut(row);
    }

    protected async removeProjectMemberGitlab(input: Row, context: NormalizedGatewayRequestContext) {
      const project = await this.resolveProject(input.project, context);
      await this.assertProjectOwnerOrAdmin(project, context);
      const removed = await this.db("project_gitlab_members").where({ project_id: project.id, user_id: input.userId, host: String(input.host).toLowerCase() }).del();
      if (removed) await this.recordEventForProject(project.id, {
        type: "project.member_gitlab_removed", title: `GitLab mapping removed: ${input.host}`, related_id: project.id
      }, context);
      return { removed: removed > 0 };
    }
  };
}
