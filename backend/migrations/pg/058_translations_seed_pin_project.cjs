// T-MEMORY-086: pin/unpin tooltip labels for the project sidebar list's new
// pin toggle button.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "projects", key: "pin", value: "Pin to top", updated_at: now },
    { locale: "ru", namespace: "projects", key: "pin", value: "Закрепить наверху", updated_at: now },
    { locale: "en", namespace: "projects", key: "unpin", value: "Unpin", updated_at: now },
    { locale: "ru", namespace: "projects", key: "unpin", value: "Открепить", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations")
    .where({ namespace: "projects" })
    .whereIn("key", ["pin", "unpin"])
    .delete();
};
