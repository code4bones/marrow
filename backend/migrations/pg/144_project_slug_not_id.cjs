const previousPattern = {
  en: "lowercase, digits, hyphens only",
  ru: "только строчные буквы, цифры, дефисы"
};
const entries = {
  slugPattern: {
    en: "Use 1–63 lowercase letters, digits or hyphens, starting with a letter or digit; the P- prefix is reserved for project IDs.",
    ru: "От 1 до 63 строчных букв, цифр или дефисов, первый символ — буква или цифра; префикс P- зарезервирован для ID проектов."
  },
  slugHelp: {
    en: "For example, frappe-cicd. The project ID is generated automatically; do not enter P-FRAPPE-CICD here.",
    ru: "Например, frappe-cicd. ID проекта создаётся автоматически; не вводите сюда P-FRAPPE-CICD."
  }
};

exports.up = async function up(knex) {
  await knex.raw("ALTER TABLE projects ADD CONSTRAINT projects_slug_not_project_id CHECK (slug !~* '^P-')");
  const updated_at = new Date().toISOString();
  const rows = Object.entries(entries).flatMap(([key, locales]) =>
    Object.entries(locales).map(([locale, value]) => ({ locale, namespace: "projects", key, value, updated_at }))
  );
  await knex("translations").insert(rows).onConflict(["locale", "namespace", "key"]).merge(["value", "updated_at"]);
};

exports.down = async function down(knex) {
  await knex.raw("ALTER TABLE projects DROP CONSTRAINT projects_slug_not_project_id");
  await knex("translations").where({ namespace: "projects", key: "slugHelp" }).del();
  for (const [locale, value] of Object.entries(previousPattern)) {
    await knex("translations").where({ namespace: "projects", key: "slugPattern", locale }).update({ value, updated_at: new Date().toISOString() });
  }
};
