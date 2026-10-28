exports.up = async function up(knex) {
  await knex.schema.createTable("download_grants", (t) => {
    t.text("token_hash").primary();
    t.text("record_id").notNullable();
    t.text("format").notNullable();
    t.text("user_id");
    t.text("client_id").notNullable();
    t.text("sha256").notNullable();
    t.timestamp("expires_at", { useTz: true }).notNullable().index();
  });
};
exports.down = async function down(knex) { await knex.schema.dropTable("download_grants"); };
