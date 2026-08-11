// Grouping tasks/decisions by work process (e.g. "Refactoring"): tasks
// already had this column (see 001_init.cjs), decisions did not. Bringing
// decisions up to parity with the same nullable free-text field.
exports.up = async function up(knex) {
  await knex.schema.alterTable("decisions", (table) => {
    table.text("milestone");
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("decisions", (table) => {
    table.dropColumn("milestone");
  });
};
