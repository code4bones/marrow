// Owner's ask: clicking the project title in the Overview header opens the
// project's own detail Drawer (previously only reachable via the
// ?record=P-XXX deep link, with no way to open it from the UI itself).
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const entries = {
    projects: {
      openProjectDetails: { en: "Open project details", ru: "Открыть детали проекта" }
    }
  };

  const rows = [];
  for (const [namespace, keys] of Object.entries(entries)) {
    for (const [key, byLocale] of Object.entries(keys)) {
      for (const [locale, value] of Object.entries(byLocale)) {
        rows.push({ locale, namespace, key, value, updated_at: now });
      }
    }
  }

  await knex("translations").insert(rows);
};

exports.down = async function down(knex) {
  await knex("translations")
    .where({ namespace: "projects" })
    .whereIn("key", ["openProjectDetails"])
    .delete();
};
