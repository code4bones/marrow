// T-MEMORY-086: per-user server-side preferences (deliberately NOT
// localStorage, per the owner's explicit request). Two tables:
//   - project_pins: a set (user_id, project_id) -- pin/unpin membership,
//     kept relational (not a JSON array in user_settings) so the projects
//     list query can LEFT JOIN it directly to sort pinned-first without
//     parsing a blob.
//   - user_settings: a generic per-user key/value store, same shape as
//     migration 055's global `system_settings` but scoped to a user --
//     covers scalar prefs (projects list sort order) and, via a composite
//     key like "timelineRootKind:<projectId>", a per-(user,project) pref
//     (the Timeline tab's root-kind dropdown) without a third table.
exports.up = async function up(knex) {
  await knex.schema.createTable("project_pins", (table) => {
    table.text("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.text("project_id").notNullable().references("id").inTable("projects").onDelete("CASCADE");
    table.timestamp("pinned_at", { useTz: true }).notNullable();
    table.primary(["user_id", "project_id"]);
  });

  await knex.schema.createTable("user_settings", (table) => {
    table.text("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.text("key").notNullable();
    table.jsonb("value").notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable();
    table.primary(["user_id", "key"]);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("user_settings");
  await knex.schema.dropTableIfExists("project_pins");
};
