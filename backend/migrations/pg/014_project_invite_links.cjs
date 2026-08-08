// Project sharing: a reusable, per-project invite link (owner-approved
// design: any current project member can invite others, and the link is
// stable/reusable like a Slack workspace invite link -- not single-use).
//
// One row per project (unique on project_id), get-or-create semantics --
// the first request for a project's invite link lazily creates this row,
// same "lazy generation on first visit" precedent as personal_tokens
// (T-MEMORY-047, see regeneratePersonalToken in src/gateway/auth.ts).
// Regenerate replaces `code` in place (delete+reinsert-in-spirit, but here
// a plain UPDATE since there is exactly one row per project to keep, unlike
// personal_tokens' delete+insert of a fresh row) -- the old code stops
// resolving the moment this happens.
//
// Deliberately PLAINTEXT `code`, unlike personal_tokens.token_hash /
// git_credentials.token_enc: this is not a broad bearer credential proving
// identity across the whole gateway, it only ever does one narrow thing
// (join this one project's membership) and is meant to be redisplayed to
// any current project member on demand -- closer to a GitHub/Slack invite
// link than a secret worth hashing or encrypting at rest.
exports.up = async function up(knex) {
  await knex.schema.createTable("project_invite_links", (table) => {
    table.text("id").primary();
    table
      .text("project_id")
      .notNullable()
      .unique()
      .references("id")
      .inTable("projects")
      .onDelete("CASCADE");
    table.text("code").notNullable().unique();
    table.text("created_by").references("id").inTable("users").onDelete("SET NULL");
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable();
  });

  await knex.schema.raw("create index idx_project_invite_links_code on project_invite_links(code)");
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("project_invite_links");
};
