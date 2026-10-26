const entries = {
  botManualTaskTitle: { en: "Create task manually", ru: "Создать задачу вручную" },
  botManualTaskName: { en: "Task title", ru: "Название задачи" },
  botManualTaskAssignees: { en: "Choose assignees", ru: "Выберите исполнителей" },
  botManualTaskCreate: { en: "Create task", ru: "Создать задачу" },
  botManualTaskQueued: { en: "Message queued for task creation", ru: "Сообщение отправлено на создание задачи" },
  botManualConfirmation: { en: "Manual confirmation", ru: "Ручное подтверждение" },
  botMessageReason_manual_task_created: { en: "Manually confirmed task created", ru: "Создана задача по ручному подтверждению" }
};
exports.up = async function up(knex) {
  const updated_at = new Date().toISOString();
  const rows = Object.entries(entries).flatMap(([key, locales]) => Object.entries(locales).map(([locale, value]) => ({ locale, namespace: "projects", key, value, updated_at })));
  await knex("translations").insert(rows).onConflict(["locale", "namespace", "key"]).merge(["value", "updated_at"]);
};
exports.down = async function down(knex) { await knex("translations").where({ namespace: "projects" }).whereIn("key", Object.keys(entries)).del(); };
