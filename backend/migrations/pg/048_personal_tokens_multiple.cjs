// Moves personal_tokens from "one live token per user" to "one token per
// named connection", mirroring 017_oauth_clients_per_connector.cjs's exact
// same fix for the exact same problem, hit live: generating a token for a
// second agent (e.g. Codex, after Claude Code was already connected) used
// to invalidate the first agent's already-working token, since there was
// only ever one row per user. owner_user_id's UNIQUE constraint is dropped
// -- a user may now have many personal_tokens rows, each independently
// creatable/regeneratable/deletable. token_hash keeps its own independent
// UNIQUE (still looked up directly by value in identifyPersonalToken).
//
// label is nullable so the one already-live row per user (if any) needs no
// backfill and keeps working unchanged -- same reasoning as oauth_clients.label.
exports.up = async function up(knex) {
  await knex.schema.alterTable("personal_tokens", (table) => {
    table.dropUnique(["owner_user_id"]);
    table.text("label");
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("personal_tokens", (table) => {
    table.dropColumn("label");
  });
  await knex.schema.alterTable("personal_tokens", (table) => {
    table.unique(["owner_user_id"]);
  });
};
