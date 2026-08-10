// Companion to PutTextArtifactDrawer's file-drop handler moving from a raw
// FileReader.readAsText to the server-side /api/extract-text round trip
// (043's import-from-file work) -- now genuinely async, so the dropzone
// needs a "reading..." label instead of the instant former behavior.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "artifacts", key: "readingFile", value: "Reading file…", updated_at: now },
    { locale: "ru", namespace: "artifacts", key: "readingFile", value: "Читаю файл…", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "artifacts", key: "readingFile" }).delete();
};
