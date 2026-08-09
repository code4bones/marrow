// The GitHub-login button was missing from the /oauth-authorize consent
// screen (used when an MCP connector like Claude.ai needs the user to sign
// in first) because there was no way to get back to that page -- with its
// client_id/redirect_uri/code_challenge/state query params intact -- after
// the GitHub round trip. return_to captures that original path across the
// state token so the callback can redirect straight back to it instead of
// always landing on /projects.
exports.up = async function up(knex) {
  await knex.schema.alterTable("oauth_login_states", (table) => {
    table.text("return_to");
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("oauth_login_states", (table) => {
    table.dropColumn("return_to");
  });
};
