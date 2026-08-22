// New "Kanban" tab on the Tasks page, next to List/Flowchart -- same shape
// as 020_translations_seed_rest.cjs's "tasks" namespace entries.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "tasks", key: "kanban", value: "Kanban", updated_at: now },
    { locale: "ru", namespace: "tasks", key: "kanban", value: "Канбан", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "tasks", key: "kanban" }).delete();
};
