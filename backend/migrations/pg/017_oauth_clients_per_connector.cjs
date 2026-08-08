// Moves oauth_clients from "one live credential per user" to "one credential
// per named connector", fixing two problems surfaced by live testing (see
// T-MEMORY session notes): (1) regenerating a credential for a new connector
// (e.g. ChatGPT) used to invalidate every other connector's already-working
// credential (e.g. Claude.ai), since there was only ever one row per user;
// (2) the redirect_uri a connector will actually call back to is now
// captured and stored on the credential itself at creation time, instead of
// requiring an admin to hand-edit the deployment-wide
// PROJECT_MEMORY_ALLOWED_REDIRECT_URIS env var for every new one-off
// ChatGPT/Codex connector callback URL.
//
// owner_user_id's UNIQUE constraint is dropped -- a user may now have many
// oauth_clients rows. client_id keeps its own independent UNIQUE (still
// looked up directly by value at /oauth/authorize and /oauth/token).
//
// label/redirect_uri are both nullable so the existing raw-seeded smoke rows
// (smoke-oauth.ts, smoke-gateway-elevation.ts,
// smoke-gateway-git-credentials.ts) and any already-live credential (e.g.
// the owner's working Claude.ai one) need no backfill and keep working
// unchanged -- validateAuthorizeParams (oauth.ts) still falls back to the
// static PROJECT_MEMORY_ALLOWED_REDIRECT_URIS allowlist when redirect_uri
// is null on a row.
exports.up = async function up(knex) {
  await knex.schema.alterTable("oauth_clients", (table) => {
    table.dropUnique(["owner_user_id"]);
    table.text("label");
    table.text("redirect_uri");
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("oauth_clients", (table) => {
    table.dropColumn("redirect_uri");
    table.dropColumn("label");
  });
  await knex.schema.alterTable("oauth_clients", (table) => {
    table.unique(["owner_user_id"]);
  });
};
