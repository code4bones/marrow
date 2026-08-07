// T-MEMORY-047: personal PMem API tokens -- a third bearer-auth source
// alongside the shared static MCP_TOKEN and OAuth connector tokens, scoped
// to exactly one user, so a newly admin-approved user can connect Claude
// Code / Codex without separately asking an admin for the shared
// MCP_TOKEN (D-MEMORY-007's "individual credentials localize revocation").
//
// Hash-only, same "never store the raw secret" pattern as sessions.token_hash
// / tokens.token_hash / admin_elevations.token_hash -- this token only ever
// needs to be *verified* on each request (identifyPersonalToken() in
// src/gateway/auth.ts), never redisplayed, so there is nothing to decrypt
// and therefore no encryption-at-rest key to manage for it (unlike
// totp_secret / git_credentials.token_enc, which genuinely need to be
// recovered in plaintext server-side to do their job).
//
// token_hint is a deliberate, small exception to "never store anything
// derived from the secret in the clear": the last 4 characters only, for
// UI recognition -- the same low-risk hint git_credentials already exposes
// (tokenHint in git-credentials.ts), computed there from the decryptable
// ciphertext at read time; computed here at write time instead and
// persisted directly, since personal_tokens has no decryptable form to
// recompute it from later.
//
// owner_user_id is UNIQUE: one live personal token per user, not a list
// like git_credentials (which deliberately allows multiple rows per host
// for overlap during rotation). Regenerating replaces the row outright
// (delete + insert in one transaction, see regeneratePersonalToken in
// auth.ts) -- "replace, don't mutate, a secret row", the same convention
// this codebase already uses for recovery codes and git credentials.
exports.up = async function up(knex) {
  await knex.schema.createTable("personal_tokens", (table) => {
    table.text("id").primary();
    table
      .text("owner_user_id")
      .notNullable()
      .unique()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.text("token_hash").notNullable().unique();
    table.text("token_hint").notNullable();
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("last_used_at", { useTz: true });
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("personal_tokens");
};
