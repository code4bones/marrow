exports.up = async function up(knex) { await knex.schema.alterTable("telegram_message_inbox", (t) => t.jsonb("manual_override")); };
exports.down = async function down(knex) { await knex.schema.alterTable("telegram_message_inbox", (t) => t.dropColumn("manual_override")); };
