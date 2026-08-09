// Owner request: shorten the Project Overview stat-row labels ("Open
// tasks"/"All tasks" -> "Open"/"Tasks") and make the cards clickable
// (front-only change, no new keys needed for the click behavior).
// openTasksStat is a new key distinct from the existing openTasks key --
// that one is also used as the section header above the open-tasks table
// further down the page, where the fuller "Open tasks" phrasing still
// reads correctly.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").where({ namespace: "projects", key: "allTasks", locale: "en" }).update({ value: "Tasks", updated_at: now });
  await knex("translations").where({ namespace: "projects", key: "allTasks", locale: "ru" }).update({ value: "Задачи", updated_at: now });

  await knex("translations").insert([
    { locale: "en", namespace: "projects", key: "openTasksStat", value: "Open", updated_at: now },
    { locale: "ru", namespace: "projects", key: "openTasksStat", value: "Открытые", updated_at: now },
  ]);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "projects", key: "allTasks", locale: "en" }).update({ value: "All Tasks" });
  await knex("translations").where({ namespace: "projects", key: "allTasks", locale: "ru" }).update({ value: "Все задачи" });
  await knex("translations").where({ namespace: "projects", key: "openTasksStat" }).delete();
};
