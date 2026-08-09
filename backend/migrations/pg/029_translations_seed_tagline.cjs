// I-MEMORY-058: the backronym itself (MARROW Ain't RAM -- Recall Outlives
// Workers) is a name, not translated/localized on any surface -- one Latin
// line for every language. Only the subtitle beneath it is locale-aware,
// and it's a semantic counterpart to the joke, not a literal translation
// (machine-translating the EN line produces garbage -- "recall" read as a
// product recall, "workers" as employees).
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const entries = {
    auth: {
      tagline: {
        en: "Institutional memory for coding agents",
        ru: "Процессы умирают, память остаётся"
      }
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
  await knex("translations").where({ namespace: "auth", key: "tagline" }).delete();
};
