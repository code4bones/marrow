const decisionStatuses = ["draft", "active", "superseded", "rejected"];
const itemStatuses = ["active", "draft", "archived", "superseded", "rejected"];
const projectStatuses = ["active", "paused", "archived"];
const taskStatuses = ["todo", "doing", "blocked", "done", "cancelled"];

exports.up = async function up(knex) {
  await knex.schema.createTable("projects", (table) => {
    table.text("id").primary();
    table.text("slug").notNullable().unique();
    table.text("title").notNullable();
    table.text("description");
    table.text("status").notNullable().defaultTo("active");
    table.text("root_path");
    table.text("created_by");
    table.text("updated_by");
    table.text("source_instance_id");
    table.integer("version").notNullable().defaultTo(1);
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable();
    table.check("status in (" + projectStatuses.map(() => "?").join(", ") + ")", projectStatuses);
  });

  await knex.schema.createTable("items", (table) => {
    table.text("id").primary();
    table.text("project_id").references("id").inTable("projects").onDelete("CASCADE");
    table.text("type").notNullable();
    table.text("title").notNullable();
    table.text("body").notNullable();
    table.text("status").notNullable().defaultTo("active");
    table.jsonb("tags").notNullable().defaultTo("[]");
    table.text("created_by");
    table.text("updated_by");
    table.text("source_instance_id");
    table.integer("version").notNullable().defaultTo(1);
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable();
    table.specificType(
      "search_vector",
      "tsvector generated always as (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(body,'') || ' ' || coalesce(tags::text,''))) stored"
    );
    table.check("status in (" + itemStatuses.map(() => "?").join(", ") + ")", itemStatuses);
  });

  await knex.schema.createTable("tasks", (table) => {
    table.text("id").primary();
    table.text("project_id").notNullable().references("id").inTable("projects").onDelete("CASCADE");
    table.text("title").notNullable();
    table.text("status").notNullable().defaultTo("todo");
    table.text("milestone");
    table.integer("priority").notNullable().defaultTo(100);
    table.text("scope");
    table.text("acceptance");
    table.jsonb("allowed_files").notNullable().defaultTo("[]");
    table.jsonb("forbidden_files").notNullable().defaultTo("[]");
    table.jsonb("depends_on").notNullable().defaultTo("[]");
    table.text("notes");
    table.text("created_by");
    table.text("updated_by");
    table.text("source_instance_id");
    table.integer("version").notNullable().defaultTo(1);
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable();
    table.check("status in (" + taskStatuses.map(() => "?").join(", ") + ")", taskStatuses);
  });

  await knex.schema.createTable("decisions", (table) => {
    table.text("id").primary();
    table.text("project_id").references("id").inTable("projects").onDelete("CASCADE");
    table.text("title").notNullable();
    table.text("status").notNullable().defaultTo("active");
    table.text("context");
    table.text("decision").notNullable();
    table.text("rationale");
    table.text("consequences");
    table.jsonb("tags").notNullable().defaultTo("[]");
    table.text("supersedes_id").references("id").inTable("decisions");
    table.text("created_by");
    table.text("updated_by");
    table.text("source_instance_id");
    table.integer("version").notNullable().defaultTo(1);
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable();
    table.check("status in (" + decisionStatuses.map(() => "?").join(", ") + ")", decisionStatuses);
  });

  await knex.schema.createTable("links", (table) => {
    table.text("id").primary();
    table.text("project_id").references("id").inTable("projects").onDelete("CASCADE");
    table.text("from_id").notNullable();
    table.text("to_id").notNullable();
    table.text("relation").notNullable();
    table.text("created_by");
    table.text("source_instance_id");
    table.integer("version").notNullable().defaultTo(1);
    table.timestamp("created_at", { useTz: true }).notNullable();
  });

  await knex.schema.createTable("events", (table) => {
    table.text("id").primary();
    table.text("project_id").references("id").inTable("projects").onDelete("CASCADE");
    table.text("type").notNullable();
    table.text("title");
    table.text("body");
    table.text("related_id");
    table.text("created_by");
    table.text("source_instance_id");
    table.integer("version").notNullable().defaultTo(1);
    table.timestamp("created_at", { useTz: true }).notNullable();
  });

  await knex.schema.createTable("kv", (table) => {
    table.text("key").primary();
    table.text("value").notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable();
  });

  await knex.schema.createTable("gateway_clients", (table) => {
    table.text("id").primary();
    table.text("label");
    table.text("last_seen_at");
    table.jsonb("metadata").notNullable().defaultTo("{}");
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable();
  });

  await knex.schema.createTable("sync_conflicts", (table) => {
    table.text("id").primary();
    table.text("record_table").notNullable();
    table.text("record_id").notNullable();
    table.text("reason").notNullable();
    table.jsonb("local_record");
    table.jsonb("incoming_record");
    table.text("status").notNullable().defaultTo("open");
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("resolved_at", { useTz: true });
  });

  await knex.schema.raw("create index idx_projects_slug on projects(slug)");
  await knex.schema.raw("create index idx_items_project_id on items(project_id)");
  await knex.schema.raw("create index idx_items_type on items(type)");
  await knex.schema.raw("create index idx_items_status on items(status)");
  await knex.schema.raw("create index idx_items_search_vector on items using gin(search_vector)");
  await knex.schema.raw("create index idx_items_tags on items using gin(tags)");
  await knex.schema.raw("create index idx_tasks_project_id on tasks(project_id)");
  await knex.schema.raw("create index idx_tasks_status on tasks(status)");
  await knex.schema.raw("create index idx_tasks_priority on tasks(priority)");
  await knex.schema.raw("create index idx_decisions_project_id on decisions(project_id)");
  await knex.schema.raw("create index idx_decisions_status on decisions(status)");
  await knex.schema.raw("create index idx_events_project_id on events(project_id)");
  await knex.schema.raw("create index idx_events_related_id on events(related_id)");
  await knex.schema.raw("create index idx_events_created_at on events(created_at)");
  await knex.schema.raw("create index idx_links_from_id on links(from_id)");
  await knex.schema.raw("create index idx_links_to_id on links(to_id)");
  await knex.schema.raw("create index idx_sync_conflicts_status on sync_conflicts(status)");
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("sync_conflicts");
  await knex.schema.dropTableIfExists("gateway_clients");
  await knex.schema.dropTableIfExists("kv");
  await knex.schema.dropTableIfExists("events");
  await knex.schema.dropTableIfExists("links");
  await knex.schema.dropTableIfExists("decisions");
  await knex.schema.dropTableIfExists("tasks");
  await knex.schema.dropTableIfExists("items");
  await knex.schema.dropTableIfExists("projects");
};
