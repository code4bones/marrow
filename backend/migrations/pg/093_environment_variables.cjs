// Marrow-native "Environment Variables" domain (owner's request,
// 2026-09-14): a .env-style key/value store an agent can read through
// env.variables_list/env.variable_get, scoped either to the caller's own
// profile ("user" scope -- a personal .env visible to them in every
// project, alongside their existing Git hosts on the profile page) or to
// one project ("project" scope -- a shared .env visible to every project
// member, under Project/Settings' new "Project Vars" tab). NOT the same
// thing as git_credentials/git.variable_* (those proxy a real GitLab
// project's own CI/CD variables over the GitLab REST API) -- this table is
// Marrow's own storage for arbitrary config (API keys, base URLs, feature
// flags, ...) an agent needs without a human pasting it into chat.
//
// `value_enc` is AES-256-GCM ciphertext (src/gateway/environment-variables.ts,
// same cipher/format as git_credentials.token_enc and users.totp_secret)
// under its own key, ENV_VAR_ENC_KEY -- independently rotatable from those,
// same "different secret class, different blast radius" reasoning as
// GIT_CREDENTIAL_ENC_KEY vs TOTP_ENC_KEY (see 012_git_credentials.cjs).
// Every value is encrypted regardless of `secret`; `secret` only controls
// whether a read masks the value by default (env.variable_get/list's
// `redact` param), same default-true/opt-out shape as git.variable_get.
//
// One table with a discriminator column rather than two separate tables:
// `scope` plus a CHECK constraint pins exactly one of owner_user_id/
// project_id to match it, and two partial unique indexes enforce
// one-row-per-key within each scope (a project's own keys and a user's own
// keys are independent namespaces -- collisions are resolved at *read*
// time in the mixin, project winning over the caller's common vars, not
// prevented at the DB level).
exports.up = async function up(knex) {
  await knex.schema.createTable("environment_variables", (table) => {
    table.text("id").primary();
    table.text("scope").notNullable();
    table.text("owner_user_id").references("id").inTable("users").onDelete("CASCADE");
    table.text("project_id").references("id").inTable("projects").onDelete("CASCADE");
    table.text("key").notNullable();
    table.text("value_enc").notNullable();
    table.boolean("secret").notNullable().defaultTo(false);
    table.text("description");
    table.text("created_by");
    table.text("updated_by");
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable();
  });

  await knex.schema.raw(`
    alter table environment_variables
    add constraint environment_variables_scope_check
    check (scope in ('user', 'project'))
  `);
  await knex.schema.raw(`
    alter table environment_variables
    add constraint environment_variables_scope_owner_check
    check (
      (scope = 'user' and owner_user_id is not null and project_id is null) or
      (scope = 'project' and project_id is not null and owner_user_id is null)
    )
  `);
  await knex.schema.raw(`
    alter table environment_variables
    add constraint environment_variables_key_format_check
    check (key ~ '^[A-Za-z0-9_]+$')
  `);

  await knex.schema.raw(
    "create unique index idx_env_vars_user_key on environment_variables(owner_user_id, key) where scope = 'user'"
  );
  await knex.schema.raw(
    "create unique index idx_env_vars_project_key on environment_variables(project_id, key) where scope = 'project'"
  );
  await knex.schema.raw("create index idx_env_vars_project_id on environment_variables(project_id)");
  await knex.schema.raw("create index idx_env_vars_owner_user_id on environment_variables(owner_user_id)");
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("environment_variables");
};
