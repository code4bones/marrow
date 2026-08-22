// T-MEMORY-115: Kanban review workflow -- two new task statuses (review,
// changes_requested) plus the reason-prompt shown when a reviewer rejects a
// task (feeds task.update_status's note, which becomes the follow-up
// task's scope).
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "tasks", key: "statusReview", value: "Review", updated_at: now },
    { locale: "ru", namespace: "tasks", key: "statusReview", value: "На проверке", updated_at: now },
    { locale: "en", namespace: "tasks", key: "statusChangesRequested", value: "Changes Requested", updated_at: now },
    { locale: "ru", namespace: "tasks", key: "statusChangesRequested", value: "Требуются исправления", updated_at: now },
    { locale: "en", namespace: "tasks", key: "requestChangesTitle", value: "What needs to change?", updated_at: now },
    { locale: "ru", namespace: "tasks", key: "requestChangesTitle", value: "Что нужно исправить?", updated_at: now },
    { locale: "en", namespace: "tasks", key: "requestChangesPlaceholder", value: "Explain what needs to change -- this becomes the new follow-up task's description", updated_at: now },
    { locale: "ru", namespace: "tasks", key: "requestChangesPlaceholder", value: "Опишите, что нужно исправить -- это станет описанием нового таска-доработки", updated_at: now },
    { locale: "en", namespace: "tasks", key: "requestChangesRequired", value: "Explain what needs to change before requesting changes.", updated_at: now },
    { locale: "ru", namespace: "tasks", key: "requestChangesRequired", value: "Опишите, что нужно исправить, прежде чем запросить исправления.", updated_at: now },
    { locale: "en", namespace: "tasks", key: "requestChanges", value: "Request changes", updated_at: now },
    { locale: "ru", namespace: "tasks", key: "requestChanges", value: "Запросить исправления", updated_at: now },
    { locale: "en", namespace: "tasks", key: "followUpTaskCreated", value: "Follow-up task created", updated_at: now },
    { locale: "ru", namespace: "tasks", key: "followUpTaskCreated", value: "Создан таск-доработка", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations")
    .where({ namespace: "tasks" })
    .whereIn("key", [
      "statusReview", "statusChangesRequested", "requestChangesTitle",
      "requestChangesPlaceholder", "requestChangesRequired", "requestChanges", "followUpTaskCreated"
    ])
    .delete();
};
