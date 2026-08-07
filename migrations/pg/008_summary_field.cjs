// I-MEMORY-022 step 5: search results return the first ~200 chars of body as
// an excerpt, which is the record's introduction, not why it matched. A
// curated summary (optional, additive — no backfill required for existing
// rows) lets a record carry its own TL;DR that search prefers over both the
// raw truncation and the KWIC-highlighted fallback.
exports.up = async function up(knex) {
  await knex.schema.alterTable("items", (table) => {
    table.text("summary");
  });
  await knex.schema.alterTable("decisions", (table) => {
    table.text("summary");
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("items", (table) => {
    table.dropColumn("summary");
  });
  await knex.schema.alterTable("decisions", (table) => {
    table.dropColumn("summary");
  });
};
