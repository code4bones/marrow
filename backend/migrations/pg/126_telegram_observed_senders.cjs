exports.up = async function up(knex) {
  await knex.schema.alterTable("telegram_chat_mentions", (t) => {
    t.text("username");
    t.text("source_type").notNullable().defaultTo("mention");
    t.index(["bot_id", "chat_id", "username"]);
  });
};
exports.down = async function down(knex) {
  await knex.schema.alterTable("telegram_chat_mentions", (t) => {
    t.dropIndex(["bot_id", "chat_id", "username"]);
    t.dropColumn("username"); t.dropColumn("source_type");
  });
};
