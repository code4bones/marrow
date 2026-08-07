// D-MEMORY-016 / T-MEMORY-038: open self-registration (email+password+inline
// TOTP) alongside the existing invite→claim→verify-email path (D-MEMORY-011,
// untouched). Adds a third users.status value for accounts that finished
// TOTP enrollment but are awaiting admin approve/reject, and a staging table
// for registrations that haven't confirmed their TOTP code yet (the users
// row itself is only created on successful confirm — same "don't create the
// row until the flow really completes" pattern the invite/claim path already
// uses for token_hash-gated rows).
const userStatuses = ["active", "disabled", "pending_approval"];
const previousUserStatuses = ["active", "disabled"];

// Postgres does not support bind parameters ($1, $2, ...) inside DDL like
// ALTER TABLE ... ADD CONSTRAINT (it errors: "bind message supplies N
// parameters, but prepared statement requires 0") — so this list, which is
// a small hardcoded literal array with no user input, is inlined as a
// quoted SQL literal instead of passed as knex.raw bindings.
function sqlStringList(values) {
  return values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", ");
}

async function findCheckConstraint(knex, tableName, columnName) {
  const { rows } = await knex.raw(
    `select con.conname as name, pg_get_constraintdef(con.oid) as definition
     from pg_constraint con
     join pg_class rel on rel.oid = con.conrelid
     where rel.relname = ? and con.contype = 'c'`,
    [tableName]
  );
  const match = rows.find((row) => row.definition.includes(columnName));
  if (!match) {
    throw new Error(`Could not find a CHECK constraint on ${tableName}.${columnName} to replace.`);
  }
  return match.name;
}

exports.up = async function up(knex) {
  // knex's table.check(...) (used in 006_auth_users_sessions_tokens.cjs)
  // doesn't take an explicit name, so it auto-generated one — look it up
  // rather than guessing, per T-MEMORY-038's explicit instruction.
  const statusConstraintName = await findCheckConstraint(knex, "users", "status");
  await knex.schema.raw(`alter table users drop constraint "${statusConstraintName}"`);
  await knex.schema.raw(
    `alter table users add constraint "${statusConstraintName}" check (status in (${sqlStringList(userStatuses)}))`
  );

  await knex.schema.createTable("pending_registrations", (table) => {
    table.text("id").primary();
    table.text("email").notNullable().unique();
    table.text("password_hash").notNullable();
    table.text("totp_secret_enc").notNullable();
    table.text("token_hash").notNullable().unique();
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("expires_at", { useTz: true }).notNullable();
  });

  await knex.schema.raw("create index idx_pending_registrations_email on pending_registrations(email)");
  await knex.schema.raw("create index idx_pending_registrations_expires_at on pending_registrations(expires_at)");
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("pending_registrations");

  // Reverting the constraint will fail if any row is currently
  // status='pending_approval' — expected/acceptable for a down migration,
  // same as any other narrowing rollback.
  const statusConstraintName = await findCheckConstraint(knex, "users", "status");
  await knex.schema.raw(`alter table users drop constraint "${statusConstraintName}"`);
  await knex.schema.raw(
    `alter table users add constraint "${statusConstraintName}" check (status in (${sqlStringList(
      previousUserStatuses
    )}))`
  );
};
