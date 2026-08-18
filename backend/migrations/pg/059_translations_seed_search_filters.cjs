// T-MEMORY-087: the Projects sidebar gets a new filter-as-you-type search
// box, and the Timeline tab's existing "Find any record... (opens as new
// root)" search is replaced by a plain in-place filter of the baseline
// list -- so findAnyRecordPlaceholder's wording (which describes the old
// jump-to-root behavior) no longer applies to that spot; left orphaned
// rather than deleted since nothing else references it and old rows are
// harmless.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "projects", key: "searchProjectsPlaceholder", value: "Filter projects…", updated_at: now },
    { locale: "ru", namespace: "projects", key: "searchProjectsPlaceholder", value: "Фильтр проектов…", updated_at: now },
    { locale: "en", namespace: "decisions", key: "filterTimelinePlaceholder", value: "Filter by title or id…", updated_at: now },
    { locale: "ru", namespace: "decisions", key: "filterTimelinePlaceholder", value: "Фильтр по названию или id…", updated_at: now },
    { locale: "en", namespace: "decisions", key: "noMatchesForFilter", value: "No matches for this filter", updated_at: now },
    { locale: "ru", namespace: "decisions", key: "noMatchesForFilter", value: "Нет совпадений по фильтру", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations")
    .where({ namespace: "projects" })
    .whereIn("key", ["searchProjectsPlaceholder"])
    .delete();
  await knex("translations")
    .where({ namespace: "decisions" })
    .whereIn("key", ["filterTimelinePlaceholder", "noMatchesForFilter"])
    .delete();
};
