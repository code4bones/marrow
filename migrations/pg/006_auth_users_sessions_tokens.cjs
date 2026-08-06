const userRoles = ["admin", "member"];
const userStatuses = ["active", "disabled"];
const tokenPurposes = ["invite", "verify_email", "password_reset"];

exports.up = async function up(knex) {
  await knex.schema.createTable("users", (table) => {
    table.text("id").primary();
    table.text("email").notNullable().unique();
    table.text("password_hash");
    table.timestamp("email_verified_at", { useTz: true });
    table.text("totp_secret");
    table.boolean("totp_enabled").notNullable().defaultTo(false);
    table.specificType("totp_recovery_code_hashes", "text[]");
    table.text("role").notNullable().defaultTo("member");
    table.text("invited_by").references("id").inTable("users").onDelete("SET NULL");
    table.text("status").notNullable().defaultTo("active");
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable();
    table.check("role in (" + userRoles.map(() => "?").join(", ") + ")", userRoles);
    table.check("status in (" + userStatuses.map(() => "?").join(", ") + ")", userStatuses);
  });

  await knex.schema.raw("create index idx_users_role on users(role)");

  // Sessions store only a hash of the opaque bearer/cookie secret handed to the
  // browser, matching the tokens table's own token_hash practice below — a DB
  // read (backup, replica, accidental log) never exposes a live, usable session.
  await knex.schema.createTable("sessions", (table) => {
    table.text("id").primary();
    table.text("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.text("token_hash").notNullable().unique();
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("expires_at", { useTz: true }).notNullable();
    table.timestamp("last_seen_at", { useTz: true }).notNullable();
    table.text("user_agent");
    table.text("ip");
    table.timestamp("revoked_at", { useTz: true });
  });

  await knex.schema.raw("create index idx_sessions_user_id on sessions(user_id)");
  await knex.schema.raw("create index idx_sessions_expires_at on sessions(expires_at)");

  // Single-purpose bearer tokens for invite / verify-email / password-reset
  // links. user_id is nullable because an invite token is minted before the
  // invitee's users row exists; email carries the target in that case.
  await knex.schema.createTable("tokens", (table) => {
    table.text("id").primary();
    table.text("user_id").references("id").inTable("users").onDelete("CASCADE");
    table.text("email");
    table.text("purpose").notNullable();
    table.text("token_hash").notNullable().unique();
    table.timestamp("expires_at", { useTz: true }).notNullable();
    table.timestamp("used_at", { useTz: true });
    table.text("created_by").references("id").inTable("users").onDelete("SET NULL");
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.check("purpose in (" + tokenPurposes.map(() => "?").join(", ") + ")", tokenPurposes);
  });

  await knex.schema.raw("create index idx_tokens_user_id on tokens(user_id)");
  await knex.schema.raw("create index idx_tokens_purpose on tokens(purpose)");
  await knex.schema.raw("create index idx_tokens_expires_at on tokens(expires_at)");
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("tokens");
  await knex.schema.dropTableIfExists("sessions");
  await knex.schema.dropTableIfExists("users");
};
