// T-MEMORY-101: fallback linking path for users whose country blocks
// oauth.telegram.org outright -- a short-lived code requested from the
// profile page, then sent as a plain message to the bot. Single-use
// (consumed_at), short TTL (expires_at, ~10 minutes, enforced in auth.ts).
exports.up = async function up(knex) {
  await knex.schema.createTable("telegram_link_codes", (table) => {
    table.text("id").primary();
    table.text("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.text("code").notNullable().unique();
    table.timestamp("expires_at", { useTz: true }).notNullable();
    table.timestamp("consumed_at", { useTz: true });
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.index(["user_id"]);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("telegram_link_codes");
};
