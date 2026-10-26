const entries = {
  workflowTitle: { en: "Task path", ru: "Путь задачи" },
  workflowCurrent: { en: "Current performers", ru: "Сейчас выполняют" },
  workflowTeam: { en: "Responsible team", ru: "Команда ответственных" },
  workflowHandoff: { en: "Pass task", ru: "Передать задачу" },
  workflowTo: { en: "Next performers", ru: "Кому передать" },
  workflowStatus: { en: "Assigned status", ru: "Статус при передаче" },
  workflowNote: { en: "Work completed / context / next steps", ru: "Что сделано / контекст / следующий шаг" },
  workflowTransferred: { en: "Task passed", ru: "Задача передана" },
  workflowOlder: { en: "Earlier steps", ru: "Предыдущие шаги" },
  workflowHistory: { en: "History", ru: "История" },
  workflowEmpty: { en: "No performers", ru: "Исполнители не указаны" },
  workflowRetry: { en: "Retry", ru: "Повторить" },
  workflow_created: { en: "Created", ru: "Создана" },
  workflow_baseline: { en: "State at workflow launch", ru: "Состояние при запуске истории" },
  workflow_handoff: { en: "Passed", ru: "Передана" },
  workflow_status: { en: "Status changed", ru: "Смена статуса" }
};
exports.up = async function up(knex) {
  const updated_at = new Date().toISOString();
  const rows = Object.entries(entries).flatMap(([key, locales]) => Object.entries(locales).map(([locale, value]) => ({ locale, namespace: "tasks", key, value, updated_at })));
  await knex("translations").insert(rows).onConflict(["locale", "namespace", "key"]).merge(["value", "updated_at"]);
};
exports.down = async function down(knex) { await knex("translations").where({ namespace: "tasks" }).whereIn("key", Object.keys(entries)).del(); };
