// GitHub OAuth sign-in/link: option (2) from the owner -- a GitHub-only
// signup still goes through the exact same pending_registrations ->
// TOTP-confirm -> pending_approval gate as a password signup, just without
// a password. An existing account only ever gets logged in via GitHub
// after it's been explicitly linked (github_identities) -- a bare email
// match on login is deliberately NOT enough (avoids silent takeover of an
// account by whoever controls a GitHub account with the same address).
exports.up = async function up(knex) {
  await knex.schema.alterTable("pending_registrations", (table) => {
    table.text("password_hash").nullable().alter();
    table.text("provider").notNullable().defaultTo("password");
    table.text("github_id");
    table.text("github_login");
  });

  await knex.schema.createTable("github_identities", (table) => {
    table.text("id").primary();
    table.text("user_id").notNullable().unique().references("id").inTable("users").onDelete("CASCADE");
    table.text("github_id").notNullable().unique();
    table.text("github_login").notNullable();
    table.timestamp("created_at", { useTz: true }).notNullable();
  });

  // Short-lived CSRF state for the GitHub redirect round-trip. user_id is set
  // only for intent="link" (the already-authenticated account requesting the
  // link); null for intent="login".
  await knex.schema.createTable("oauth_login_states", (table) => {
    table.text("id").primary();
    table.text("token_hash").notNullable().unique();
    table.text("intent").notNullable();
    table.text("user_id").references("id").inTable("users").onDelete("CASCADE");
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("expires_at", { useTz: true }).notNullable();
    table.check("intent in ('login', 'link')");
  });

  await knex.schema.raw("create index idx_oauth_login_states_expires_at on oauth_login_states(expires_at)");
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("oauth_login_states");
  await knex.schema.dropTableIfExists("github_identities");
  await knex.schema.alterTable("pending_registrations", (table) => {
    table.dropColumn("github_login");
    table.dropColumn("github_id");
    table.dropColumn("provider");
  });
  await knex("pending_registrations").whereNull("password_hash").del();
  await knex.schema.alterTable("pending_registrations", (table) => {
    table.text("password_hash").notNullable().alter();
  });
};
