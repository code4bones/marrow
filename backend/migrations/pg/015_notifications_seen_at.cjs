// T-MEMORY-051: notifications badge -- per-account unread state that
// survives across devices (a session-cookie/browser-local flag would not),
// same "server-side, per-user account state" precedent as personal_tokens
// and totp_enabled on this same `users` table. Nullable, with `null` meaning
// "never viewed" so every existing event counts as unread the first time a
// user opens the notifications page -- no backfill needed, additive column
// on an existing table, same pattern as 008_summary_field.cjs.
exports.up = async function up(knex) {
  await knex.schema.alterTable("users", (table) => {
    table.timestamp("notifications_seen_at", { useTz: true });
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("users", (table) => {
    table.dropColumn("notifications_seen_at");
  });
};
