exports.up = async function up(knex) {
  await knex.schema.alterTable("telegram_chat_mentions", (t) => { t.jsonb("assignment_tags").notNullable().defaultTo("[]"); });
};
exports.down = async function down(knex) { await knex.schema.alterTable("telegram_chat_mentions", (t) => t.dropColumn("assignment_tags")); };
