// Per-user OAuth connector credentials: replaces the single, static,
// shared PROJECT_MEMORY_OAUTH_CLIENT_ID/_SECRET pair (env-configured, one
// per whole deployment) with one self-generated client_id/client_secret
// pair per approved user, mirroring T-MEMORY-047's personal_tokens exactly
// -- same "one live credential row per user" (owner_user_id UNIQUE), same
// hash-only secret storage, same last-4-chars plaintext hint for UI
// recognition, same "replace, don't mutate" regenerate convention (delete +
// insert in one transaction, see regenerateOAuthClient in auth.ts).
//
// client_id is NOT secret -- unlike client_secret_hash, it's safe to read
// back and display persistently (not shown-once), since knowing it alone
// grants nothing without also completing the real per-user login step
// /oauth/authorize still requires (D-MEMORY-027, unchanged by this task).
// It gets its own UNIQUE constraint (independent of owner_user_id) because
// it's looked up directly by value at /oauth/authorize and /oauth/token,
// the same way personal_tokens.token_hash is looked up by value rather
// than by owner_user_id.
//
// No redirect-URI column: PROJECT_MEMORY_ALLOWED_REDIRECT_URIS stays a
// static, deployment-wide env allowlist, confirmed independent of
// client_id in isAllowedRedirectUri() (oauth.ts) -- this table only needs
// to answer "does this client_id/secret pair exist and match".
exports.up = async function up(knex) {
  await knex.schema.createTable("oauth_clients", (table) => {
    table.text("id").primary();
    table
      .text("owner_user_id")
      .notNullable()
      .unique()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.text("client_id").notNullable().unique();
    table.text("client_secret_hash").notNullable();
    table.text("client_secret_hint").notNullable();
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("last_used_at", { useTz: true });
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("oauth_clients");
};
