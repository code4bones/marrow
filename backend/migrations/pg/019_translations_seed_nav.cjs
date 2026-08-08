// Seed data for the "nav" namespace i18n pilot (English + Russian) -- see
// 018_translations.cjs for why this ships as per-key rows via a migration
// rather than a runtime script, consistent with how every other schema+data
// change in this codebase ships.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const entries = {
    overview: { en: "Overview", ru: "Обзор" },
    tasks: { en: "Tasks", ru: "Задачи" },
    decisions: { en: "Decisions", ru: "Решения" },
    faults: { en: "Faults", ru: "Дефекты" },
    artifacts: { en: "Artifacts", ru: "Артефакты" },
    events: { en: "Events", ru: "События" },
    memory: { en: "Memory", ru: "Память" },
    links: { en: "Links", ru: "Связи" },
    settings: { en: "Settings", ru: "Настройки" },
    common: { en: "Common", ru: "Общее" },
    profile: { en: "Profile", ru: "Профиль" },
    notifications: { en: "Notifications", ru: "Уведомления" },
    approvals: { en: "Approvals", ru: "Одобрения" },
    users: { en: "Users", ru: "Пользователи" },
    logout: { en: "Logout", ru: "Выйти" },
    projects: { en: "Projects", ru: "Проекты" }
  };

  const rows = [];
  for (const [key, byLocale] of Object.entries(entries)) {
    for (const [locale, value] of Object.entries(byLocale)) {
      rows.push({ locale, namespace: "nav", key, value, updated_at: now });
    }
  }

  await knex("translations").insert(rows);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "nav" }).delete();
};
