// Generic admin-controlled global settings store (D-MEMORY-037 follow-up):
// a small key/value table so features like the credits economy can ship a
// single global on/off switch without a bespoke table per flag. Seeded with
// credits_enabled=true so the already-live credits feature keeps working
// until an admin explicitly turns it off.
exports.up = async function up(knex) {
  await knex.schema.createTable("system_settings", (table) => {
    table.text("key").primary();
    table.jsonb("value").notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable();
    table.text("updated_by").references("id").inTable("users").onDelete("SET NULL");
  });

  await knex("system_settings").insert({
    key: "credits_enabled",
    value: JSON.stringify(true),
    updated_at: knex.fn.now()
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("system_settings");
};
