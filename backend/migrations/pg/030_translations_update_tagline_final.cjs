// I-MEMORY-059 / I-MEMORY-060: canonical tagline revised. The ru line seeded
// in 029 ("Процессы умирают, память остаётся") reads as a memory-leak
// confession for a data-storage product and is retired -- do not reuse it.
// The en value is intentionally emptied on this surface: the login/register
// card already shows the EN backronym line directly above this subtitle, so
// an EN sentence here would just repeat the same joke twice in a row. A
// separate brand.tagline.standalone key (not seeded here) is reserved for
// EN-only surfaces where the backronym isn't shown at all.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations")
    .where({ namespace: "auth", key: "tagline", locale: "ru" })
    .update({ value: "Уходят люди, остаётся знание", updated_at: now });
  await knex("translations")
    .where({ namespace: "auth", key: "tagline", locale: "en" })
    .update({ value: "", updated_at: now });
};

exports.down = async function down(knex) {
  const now = new Date().toISOString();
  await knex("translations")
    .where({ namespace: "auth", key: "tagline", locale: "ru" })
    .update({ value: "Процессы умирают, память остаётся", updated_at: now });
  await knex("translations")
    .where({ namespace: "auth", key: "tagline", locale: "en" })
    .update({ value: "Institutional memory for coding agents", updated_at: now });
};
