// Artifacts page's new "Upload files" button (bulk binary file drop, one
// artifact per file via POST /artifacts/upload) -- companion to the
// dropFileHint/couldNotReadFile keys the text-artifact drawer already had.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "artifacts", key: "uploadFiles", value: "Upload files", updated_at: now },
    { locale: "ru", namespace: "artifacts", key: "uploadFiles", value: "Загрузить файлы", updated_at: now },
    { locale: "en", namespace: "artifacts", key: "dropFilesHint", value: "Drop files here or click to browse — any file type, multiple files at once", updated_at: now },
    { locale: "ru", namespace: "artifacts", key: "dropFilesHint", value: "Перетащите файлы сюда или нажмите, чтобы выбрать — любые типы, можно несколько сразу", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations")
    .where({ namespace: "artifacts" })
    .whereIn("key", ["uploadFiles", "dropFilesHint"])
    .delete();
};
