// 071 seeded "kanban" only in the "tasks" namespace (the Tasks page's own
// List/Kanban/Flowchart tabs). Project Overview's Timeline/Kanban/Summary
// row (T-MEMORY-103) uses the "projects" namespace instead -- same key,
// separate namespace, so a second small migration rather than editing 071
// (already deployed).
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "projects", key: "kanban", value: "Kanban", updated_at: now },
    { locale: "ru", namespace: "projects", key: "kanban", value: "Канбан", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "projects", key: "kanban" }).delete();
};
