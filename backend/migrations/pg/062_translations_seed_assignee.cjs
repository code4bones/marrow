// T-MEMORY-091: i18n strings for the task/decision assignee UI (picker
// field, DetailDrawer reassign control, Notifications "assigned to you"
// highlight) -- same flat-array insert shape as 058_translations_seed_pin_project.cjs.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "common", key: "assignee", value: "Assignee", updated_at: now },
    { locale: "ru", namespace: "common", key: "assignee", value: "Исполнитель", updated_at: now },

    { locale: "en", namespace: "tasks", key: "assignee", value: "Assignee", updated_at: now },
    { locale: "ru", namespace: "tasks", key: "assignee", value: "Исполнитель", updated_at: now },
    { locale: "en", namespace: "tasks", key: "unassigned", value: "Unassigned (= owner)", updated_at: now },
    { locale: "ru", namespace: "tasks", key: "unassigned", value: "Не назначено (= владелец)", updated_at: now },
    { locale: "en", namespace: "tasks", key: "assigneeUpdated", value: "Assignee updated", updated_at: now },
    { locale: "ru", namespace: "tasks", key: "assigneeUpdated", value: "Исполнитель обновлён", updated_at: now },

    { locale: "en", namespace: "decisions", key: "assignee", value: "Assignee", updated_at: now },
    { locale: "ru", namespace: "decisions", key: "assignee", value: "Исполнитель", updated_at: now },
    { locale: "en", namespace: "decisions", key: "unassigned", value: "Unassigned (= owner)", updated_at: now },
    { locale: "ru", namespace: "decisions", key: "unassigned", value: "Не назначено (= владелец)", updated_at: now },
    { locale: "en", namespace: "decisions", key: "assigneeUpdated", value: "Assignee updated", updated_at: now },
    { locale: "ru", namespace: "decisions", key: "assigneeUpdated", value: "Исполнитель обновлён", updated_at: now },

    { locale: "en", namespace: "notifications", key: "assignedToYou", value: "Assigned to you", updated_at: now },
    { locale: "ru", namespace: "notifications", key: "assignedToYou", value: "Назначено вам", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations")
    .where({ namespace: "common" })
    .whereIn("key", ["assignee"])
    .delete();
  await knex("translations")
    .whereIn("namespace", ["tasks", "decisions"])
    .whereIn("key", ["assignee", "unassigned", "assigneeUpdated"])
    .delete();
  await knex("translations")
    .where({ namespace: "notifications" })
    .whereIn("key", ["assignedToYou"])
    .delete();
};
