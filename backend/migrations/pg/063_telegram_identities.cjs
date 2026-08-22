// T-MEMORY-093: mirrors github_identities (migration 026) -- link-only,
// no registerViaTelegram (Telegram gives no email, and users.email is
// notNullable().unique(), so there's no way to create a brand-new account
// from a bare Telegram identity). chat_started_at is the extra state GitHub
// never needed: Telegram forbids a bot from messaging someone who has never
// opened a chat with it, so Login-Widget linking alone (telegram_id known)
// is not enough to actually deliver a notification -- the user also has to
// press Start on the bot at least once, which is what sets this column.
exports.up = async function up(knex) {
  await knex.schema.createTable("telegram_identities", (table) => {
    table.text("id").primary();
    table.text("user_id").notNullable().unique().references("id").inTable("users").onDelete("CASCADE");
    table.text("telegram_id").notNullable().unique();
    table.text("telegram_username");
    table.text("telegram_first_name");
    table.timestamp("chat_started_at", { useTz: true });
    table.timestamp("created_at", { useTz: true }).notNullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("telegram_identities");
};
