// Owner's ask (2026-10-15): a lightweight, purely-logical grouping of
// related projects (e.g. "marrow" <-> "marrow-telly-mcp") -- no separate
// visual entity (not a folder), just enough data for the Projects list to
// cluster co-visible group members together with a connector. `key` is a
// free-text group label the caller picks (not a generated id); a project
// can belong to more than one group, so the PK is the pair, not `key` alone.
exports.up = async function up(knex) {
  await knex.schema.createTable("project_group", (table) => {
    table.text("key").notNullable();
    table.text("project_id").notNullable().references("id").inTable("projects").onDelete("CASCADE");
    table.text("created_by");
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.primary(["key", "project_id"]);
  });
  await knex.schema.raw("create index idx_project_group_project_id on project_group(project_id)");
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("project_group");
};
