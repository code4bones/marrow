// "Upload files" drawer's new Group field (owner: 10 dropped files landing
// flat in uploads/ with nothing to tell one batch from another wasn't
// useful -- needs a name shared across a batch, picked from existing
// groups or typed as a new one). Also the Projects sidebar's new sort
// picker (owner: it was always alphabetical by slug with no alternative).
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "artifacts", key: "uploadGroupLabel", value: "Group", updated_at: now },
    { locale: "ru", namespace: "artifacts", key: "uploadGroupLabel", value: "Группа", updated_at: now },
    { locale: "en", namespace: "artifacts", key: "uploadGroupPlaceholder", value: "Pick an existing group or type a new one", updated_at: now },
    { locale: "ru", namespace: "artifacts", key: "uploadGroupPlaceholder", value: "Выберите существующую группу или введите новую", updated_at: now },
    { locale: "en", namespace: "artifacts", key: "uploadGroupHint", value: "Files in this upload will share this group as a folder and a tag, so they're easy to find and download together later.", updated_at: now },
    { locale: "ru", namespace: "artifacts", key: "uploadGroupHint", value: "Файлы этой загрузки получат общую группу как папку и тег — их будет легко найти и скачать вместе.", updated_at: now },

    { locale: "en", namespace: "projects", key: "sortAlphabetical", value: "Alphabetical", updated_at: now },
    { locale: "ru", namespace: "projects", key: "sortAlphabetical", value: "По алфавиту", updated_at: now },
    { locale: "en", namespace: "projects", key: "sortNewestFirst", value: "Newest first", updated_at: now },
    { locale: "ru", namespace: "projects", key: "sortNewestFirst", value: "Сначала новые", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations")
    .where({ namespace: "artifacts" })
    .whereIn("key", ["uploadGroupLabel", "uploadGroupPlaceholder", "uploadGroupHint"])
    .delete();
  await knex("translations")
    .where({ namespace: "projects" })
    .whereIn("key", ["sortAlphabetical", "sortNewestFirst"])
    .delete();
};
