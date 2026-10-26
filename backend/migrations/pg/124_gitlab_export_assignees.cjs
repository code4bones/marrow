exports.up = async function up(knex) {
  await knex.schema.alterTable("gitlab_issue_exports", (t) => {
    t.jsonb("recipient_user_ids");
    t.jsonb("gitlab_user_ids");
  });
  const build = knex.client.config.client === "pg" ? "jsonb_build_array" : "json_array";
  await knex("gitlab_issue_exports").whereNotNull("recipient_user_id").update({ recipient_user_ids: knex.raw(`${build}(recipient_user_id)`) });
  await knex("gitlab_issue_exports").whereNotNull("gitlab_user_id").update({ gitlab_user_ids: knex.raw(`${build}(gitlab_user_id)`) });
};
exports.down = async function down(knex) {
  await knex.schema.alterTable("gitlab_issue_exports", (t) => { t.dropColumn("recipient_user_ids"); t.dropColumn("gitlab_user_ids"); });
};
