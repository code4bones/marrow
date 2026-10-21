// A CIMD public client has no user-owned oauth_clients row to display in the
// Profile → Connections UI. Keep a small, non-secret audit row per Marrow
// user and known OpenAI connector instead. It is written only after a real
// authorization-code exchange, never from a caller-supplied label/header.
const CONNECTORS = ["chatgpt", "codex"];

exports.up = async function up(knex) {
  await knex.schema.createTable("oauth_cimd_connections", (table) => {
    table.text("owner_user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.text("connector").notNullable();
    table.text("client_id").notNullable();
    table.timestamp("connected_at", { useTz: true }).notNullable();
    table.timestamp("last_authenticated_at", { useTz: true }).notNullable();
    table.timestamp("last_seen_at", { useTz: true });
    table.primary(["owner_user_id", "connector"]);
  });
  await knex.schema.raw(
    `alter table oauth_cimd_connections add constraint oauth_cimd_connections_connector_check check (connector in (${CONNECTORS.map((value) => `'${value}'`).join(", ")}))`
  );
  await knex.schema.raw("create index idx_oauth_cimd_connections_owner_user_id on oauth_cimd_connections(owner_user_id)");
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("oauth_cimd_connections");
};
