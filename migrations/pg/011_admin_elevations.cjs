// T-MEMORY-041 / D-MEMORY-019: step-up admin elevation grants.
//
// `admin_elevations` holds short-lived, single-use grants minted by
// `POST /auth/elevate` (auth.ts's `requestElevation`) once a caller proves,
// live, that they know the current TOTP code (or the password, re-checked
// at the same moment) for a specific `role=admin`, `totp_enabled=true`
// user. Redeeming a grant (auth.ts's `consumeElevation`) is what lets an
// otherwise-forever-capped OAuth read+write credential (D-MEMORY-017,
// decision 2) get through exactly one admin-tier gateway call — see
// D-MEMORY-019 for why this is not the same thing as loosening that cap.
//
// Same "never store the raw secret" principle as `sessions.token_hash` /
// `tokens.token_hash`: only the sha256 hash of the opaque grant token is
// ever persisted. `used_at` (set by one atomic
// `UPDATE ... WHERE used_at IS NULL RETURNING` in `consumeElevation`) is
// the single-use enforcement; `expires_at` (60s TTL from mint time) is the
// narrow-window backstop for a grant that's minted but never redeemed.
exports.up = async function up(knex) {
  await knex.schema.createTable("admin_elevations", (table) => {
    table.text("id").primary();
    table.text("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.text("token_hash").notNullable().unique();
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("expires_at", { useTz: true }).notNullable();
    table.timestamp("used_at", { useTz: true });
    table.text("user_agent");
    table.text("ip");
  });

  await knex.schema.raw("create index idx_admin_elevations_user_id on admin_elevations(user_id)");
  await knex.schema.raw("create index idx_admin_elevations_expires_at on admin_elevations(expires_at)");
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("admin_elevations");
};
