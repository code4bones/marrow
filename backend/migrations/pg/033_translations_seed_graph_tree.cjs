// T-MEMORY-056: Project Overview's Timeline/Tree toggle and the tree's
// own empty state.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const entries = {
    projects: {
      tree: { en: "Tree", ru: "Дерево" },
      treeEmptyHint: { en: "The tree fills in as project records are linked to each other", ru: "Дерево заполнится, как только записи проекта будут связаны друг с другом" }
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
    .whereIn("key", ["tree", "treeEmptyHint"])
    .delete();
};
