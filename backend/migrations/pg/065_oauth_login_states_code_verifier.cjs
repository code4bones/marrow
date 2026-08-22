// T-MEMORY-093 correction: Telegram's login moved from the old HMAC-signed
// widget (now dead -- oauth.telegram.org serves "deprecated" for it) to a
// real OpenID Connect Authorization Code + PKCE flow. code_verifier rides
// across the same round-trip return_to already uses (039), generically on
// this shared oauth_login_states table -- null for every other provider's
// rows (GitHub's flow has no PKCE step).
exports.up = async function up(knex) {
  await knex.schema.alterTable("oauth_login_states", (table) => {
    table.text("code_verifier");
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("oauth_login_states", (table) => {
    table.dropColumn("code_verifier");
  });
};
