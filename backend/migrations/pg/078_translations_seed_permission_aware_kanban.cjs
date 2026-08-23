// T-context (owner's ask, 2026-08-23): permission-aware Kanban/detail-panel
// UI -- a client-side permission check (before even attempting a drag/drop
// mutation) needs its own toast copy distinct from a backend-rejected error.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "tasks", key: "actionNotAllowed", value: "You don't have permission to do that.", updated_at: now },
    { locale: "ru", namespace: "tasks", key: "actionNotAllowed", value: "У вас нет прав на это действие.", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "tasks", key: "actionNotAllowed" }).delete();
};
