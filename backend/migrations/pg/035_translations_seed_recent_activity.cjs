// Project Overview's stat-row badges (StatTitle in
// widgets/project-overview/index.tsx) count recent activity events, not
// the stat's own value -- e.g. "Open tasks: 0" next to a "20" badge looked
// like conflicting counts. A tooltip now spells out what the badge means.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const entries = {
    projects: {
      recentActivityCount_one: { en: "{{count}} update since you last checked", ru: "{{count}} обновление с последнего просмотра" },
      recentActivityCount_other: { en: "{{count}} updates since you last checked", ru: "{{count}} обновлений с последнего просмотра" },
    },
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
    .whereIn("key", ["recentActivityCount_one", "recentActivityCount_other"])
    .delete();
};
