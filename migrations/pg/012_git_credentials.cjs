// T-MEMORY-044: per-user, per-host git credentials (GitLab personal access
// tokens today; the schema is host-per-row so other git hosts can be added
// later without a migration, per the task's explicit non-goal for this
// pass). Motivating problem: the owner previously monitored CI/CD only via
// SSH + `journalctl` grep on the production host -- fragile, and required
// root every time. Putting a PAT in `.env` was rejected (see D-MEMORY-017's
// credential model, and the task record itself): a secret like this must be
// entered by the user through the UI and live in the database, not in a
// `.env` file only the operator can read.
//
// `token_enc` is AES-256-GCM ciphertext, same cipher/format as
// `users.totp_secret` (`src/gateway/totp.ts`'s `encryptSecret`/
// `decryptSecret`), but keyed by a *separate* env var (`GIT_CREDENTIAL_ENC_KEY`,
// see `src/gateway/git-credentials.ts`) rather than reusing `TOTP_ENC_KEY` --
// two different secret classes (a 2FA seed vs. a third-party API token) with
// different blast radii on compromise get independently rotatable keys,
// which a shared key would not allow.
//
// One user can have multiple credentials for the same host (e.g. mid-
// rotation, briefly holding both the old and new token) -- deliberately no
// uniqueness constraint on (owner_user_id, host). `git.pipeline_status`'s
// credential resolution picks the most recently created row for that
// (owner_user_id, host) pair when more than one exists. Rotation is
// delete-old + create-new, never update-in-place, same "don't mutate a
// secret row, replace it" pattern this codebase already uses for recovery
// codes (`update` on `git_credentials` only ever touches `label`, never
// `token_enc` -- see git.credential_create/delete in pg-tool-service.ts,
// there is no git.credential_update at all in this pass).
exports.up = async function up(knex) {
  await knex.schema.createTable("git_credentials", (table) => {
    table.text("id").primary();
    table.text("owner_user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.text("host").notNullable();
    table.text("label").notNullable();
    table.text("token_enc").notNullable();
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable();
    table.timestamp("last_used_at", { useTz: true });
  });

  await knex.schema.raw("create index idx_git_credentials_owner_user_id on git_credentials(owner_user_id)");
  await knex.schema.raw("create index idx_git_credentials_owner_host on git_credentials(owner_user_id, host)");
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("git_credentials");
};
