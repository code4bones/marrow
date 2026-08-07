exports.up = async function up(knex) {
  await knex.schema.createTable("artifacts", (table) => {
    table.text("id").primary();
    table.text("project_id").references("id").inTable("projects").onDelete("CASCADE");
    table.text("path").notNullable();
    table.text("title").notNullable();
    table.text("description");
    table.text("content_type").notNullable();
    table.bigInteger("size_bytes").notNullable();
    table.text("sha256").notNullable();
    table.text("storage_path").notNullable();
    table.jsonb("tags").notNullable().defaultTo("[]");
    table.text("created_by");
    table.text("updated_by");
    table.text("source_instance_id");
    table.integer("version").notNullable().defaultTo(1);
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable();
    table.specificType(
      "search_vector",
      "tsvector generated always as (to_tsvector('simple', coalesce(path,'') || ' ' || coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(tags::text,''))) stored"
    );
  });

  await knex.schema.raw("create unique index idx_artifacts_scope_path on artifacts (coalesce(project_id, '__common__'), path)");
  await knex.schema.raw("create index idx_artifacts_project_id on artifacts(project_id)");
  await knex.schema.raw("create index idx_artifacts_search_vector on artifacts using gin(search_vector)");
  await knex.schema.raw("create index idx_artifacts_tags on artifacts using gin(tags)");
  await knex.schema.raw("create index idx_artifacts_created_at on artifacts(created_at)");
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("artifacts");
};
