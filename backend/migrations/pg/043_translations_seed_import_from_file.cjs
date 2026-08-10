// Seed data for the new "import description from file" upload control in
// CreateTaskDrawer (fills scope) and CreateMemoryDrawer (fills body) --
// same shape as 020_translations_seed_rest.cjs. Each feature namespace
// carries its own copy of these strings, matching how "create"/"cancel"/
// etc. are already duplicated per-namespace rather than shared.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const entries = {
    tasks: {
      importFromFile: { en: "Import from file", ru: "Импорт из файла" },
      importFromFileHint: { en: ".docx, .md, or .txt — replaces the Scope field below", ru: ".docx, .md или .txt — заменит содержимое поля «Область» ниже" },
      couldNotReadFile: { en: "Could not read {{name}}.", ru: "Не удалось прочитать {{name}}." }
    },
    memory: {
      importFromFile: { en: "Import from file", ru: "Импорт из файла" },
      importFromFileHint: { en: ".docx, .md, or .txt — replaces the Body field below", ru: ".docx, .md или .txt — заменит содержимое поля «Содержимое» ниже" },
      couldNotReadFile: { en: "Could not read {{name}}.", ru: "Не удалось прочитать {{name}}." }
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
    .whereIn("namespace", ["tasks", "memory"])
    .whereIn("key", ["importFromFile", "importFromFileHint", "couldNotReadFile"])
    .delete();
};
