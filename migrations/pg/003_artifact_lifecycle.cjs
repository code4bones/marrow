exports.up = async function up(knex) {
  await knex.schema.alterTable("artifacts", (table) => {
    table.text("status").notNullable().defaultTo("active");
    table.timestamp("archived_at", { useTz: true });
    table.text("archived_by");
    table.text("archive_reason");
  });

  await knex.schema.raw("alter table artifacts add constraint artifacts_status_check check (status in ('active', 'archived'))");
  await knex.schema.raw("create index idx_artifacts_status on artifacts(status)");
};

exports.down = async function down(knex) {
  await knex.schema.raw("drop index if exists idx_artifacts_status");
  await knex.schema.raw("alter table artifacts drop constraint if exists artifacts_status_check");
  await knex.schema.alterTable("artifacts", (table) => {
    table.dropColumn("archive_reason");
    table.dropColumn("archived_by");
    table.dropColumn("archived_at");
    table.dropColumn("status");
  });
};
