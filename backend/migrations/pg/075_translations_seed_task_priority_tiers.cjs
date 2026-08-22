// T-MEMORY-110: priority tiers (DRAFT/LOW/HIGH/CRIT) replace the raw numeric
// priority everywhere it was shown/edited in the UI, and a new full
// task-editing drawer (title/milestone/priority/scope/acceptance/notes) is
// now reachable from the task detail panel.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "tasks", key: "priorityCrit", value: "Crit", updated_at: now },
    { locale: "ru", namespace: "tasks", key: "priorityCrit", value: "Критично", updated_at: now },
    { locale: "en", namespace: "tasks", key: "priorityHigh", value: "High", updated_at: now },
    { locale: "ru", namespace: "tasks", key: "priorityHigh", value: "Высокий", updated_at: now },
    { locale: "en", namespace: "tasks", key: "priorityLow", value: "Low", updated_at: now },
    { locale: "ru", namespace: "tasks", key: "priorityLow", value: "Низкий", updated_at: now },
    { locale: "en", namespace: "tasks", key: "priorityDraft", value: "Draft", updated_at: now },
    { locale: "ru", namespace: "tasks", key: "priorityDraft", value: "Черновик", updated_at: now },
    { locale: "en", namespace: "tasks", key: "editTask", value: "Edit task", updated_at: now },
    { locale: "ru", namespace: "tasks", key: "editTask", value: "Редактировать задачу", updated_at: now },
    { locale: "en", namespace: "tasks", key: "taskUpdated", value: "Task updated", updated_at: now },
    { locale: "ru", namespace: "tasks", key: "taskUpdated", value: "Задача обновлена", updated_at: now },
    { locale: "en", namespace: "tasks", key: "save", value: "Save", updated_at: now },
    { locale: "ru", namespace: "tasks", key: "save", value: "Сохранить", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations")
    .where({ namespace: "tasks" })
    .whereIn("key", ["priorityCrit", "priorityHigh", "priorityLow", "priorityDraft", "editTask", "taskUpdated", "save"])
    .delete();
};
