// T-context (2026-08-25, owner's ask: omni search across task/decisions/
// mem/faults/artifacts): the new Overview quick-search box's placeholder and
// empty-results copy. Group headers in the results dropdown reuse the
// already-seeded tasks/decisions/artifacts/memory/faults keys (projects
// namespace) -- no new keys needed for those.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "projects", key: "quickSearchPlaceholder", value: "Search this project...", updated_at: now },
    { locale: "ru", namespace: "projects", key: "quickSearchPlaceholder", value: "Поиск по проекту...", updated_at: now },
    { locale: "en", namespace: "projects", key: "noSearchResults", value: "No results", updated_at: now },
    { locale: "ru", namespace: "projects", key: "noSearchResults", value: "Ничего не найдено", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "projects", key: "quickSearchPlaceholder" }).delete();
  await knex("translations").where({ namespace: "projects", key: "noSearchResults" }).delete();
};
