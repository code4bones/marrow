import { randomUUID } from "node:crypto";
import type { Knex } from "knex";
import { AppError } from "../shared/errors.js";
import type { GitlabOidcUser } from "./gitlab-oidc.js";

type Meta = { userAgent?: string; ip?: string };

export function createGitlabIdentities(db: Knex, issueSession: (userId: string, meta: Meta) => Promise<string>) {
  return {
    async loginViaGitlab(identity: GitlabOidcUser, meta: Meta, currentUserId?: string) {
      const linked = await db("gitlab_identities").where({ issuer: identity.issuer, subject: identity.subject }).first();
      if (!linked) return { status: "not_linked" as const };
      const user = await db("users").where({ id: linked.user_id }).first();
      if (!user) return { status: "not_linked" as const };
      if (user.status !== "active") throw new AppError("UNAUTHORIZED", "This Marrow account is not active.");
      if (currentUserId && currentUserId !== user.id) throw new AppError("UNAUTHORIZED", "The current Marrow account differs from the linked account.");
      // Same trusted external-provider session policy as GitHub/Telegram.
      // No signup/email matching, no change to password/TOTP authentication.
      const token = await issueSession(user.id, meta);
      return { status: "session" as const, token, user: { id: String(user.id), email: String(user.email), role: String(user.role) } };
    },
    async linkGitlabIdentity(userId: string, identity: GitlabOidcUser): Promise<void> {
      await db.transaction(async trx => {
        const user = await trx("users").where({ id: userId }).forUpdate().first();
        if (user?.status !== "active") throw new AppError("UNAUTHORIZED", "An active Marrow account is required.");
        const existing = await trx("gitlab_identities").where({ issuer: identity.issuer, subject: identity.subject }).first();
        if (existing) {
          if (existing.user_id !== userId) throw new AppError("VALIDATION_ERROR", "This GitLab identity is linked to another Marrow account.");
          await trx("gitlab_identities").where({ id: existing.id }).update({ username: identity.username });
          return;
        }
        const own = await trx("gitlab_identities").where({ user_id: userId, issuer: identity.issuer }).first();
        if (own) throw new AppError("VALIDATION_ERROR", "Disconnect your current GitLab identity before linking another.");
        await trx("gitlab_identities").insert({ id: randomUUID(), user_id: userId, issuer: identity.issuer,
          subject: identity.subject, username: identity.username, created_at: new Date() });
      });
    },
    async unlinkGitlabIdentity(userId: string, issuer: string): Promise<void> {
      await db.transaction(async trx => {
        const user = await trx("users").where({ id: userId }).forUpdate().first();
        if (user?.status !== "active") throw new AppError("UNAUTHORIZED", "An active Marrow account is required.");
        if (!user.password_hash) {
          const [github, telegram] = await Promise.all([
            trx("github_identities").where({ user_id: userId }).first(),
            trx("telegram_identities").where({ user_id: userId }).first()
          ]);
          if (!github && !telegram) throw new AppError("VALIDATION_ERROR", "Connect another sign-in method before disconnecting GitLab.");
        }
        await trx("gitlab_identities").where({ user_id: userId, issuer }).del();
      });
    },
    async gitlabLinkStatus(userId: string, issuer: string) {
      const row = await db("gitlab_identities").where({ user_id: userId, issuer }).first();
      return { linked: Boolean(row), username: row?.username ? String(row.username) : null, issuer };
    }
  };
}
