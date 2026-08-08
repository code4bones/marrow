// Additional "decisions" namespace keys for the new one-click Supersede
// action (RecordDecisionDrawer's supersedesId prop, front/src/pages/
// decisions/index.tsx) and the Decisions status filter's missing
// "archived" option -- a separate migration rather than editing
// 020_translations_seed_rest.cjs in place, since that one already ran on
// dev/prod (Postgres migrations are append-only here, see every prior
// *_seed_*.cjs for the same convention).
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const entries = {
    supersede: { en: "Supersede", ru: "Заменить" },
    decisionSuperseded: { en: "Decision superseded.", ru: "Решение заменено." },
    supersedeDecisionTitle: { en: "Supersede {{id}}", ru: "Заменить {{id}}" },
    statusArchived: { en: "Archived", ru: "В архиве" }
  };

  const rows = [];
  for (const [key, byLocale] of Object.entries(entries)) {
    for (const [locale, value] of Object.entries(byLocale)) {
      rows.push({ locale, namespace: "decisions", key, value, updated_at: now });
    }
  }

  await knex("translations").insert(rows);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "decisions" }).whereIn("key", [
    "supersede",
    "decisionSuperseded",
    "supersedeDecisionTitle",
    "statusArchived"
  ]).delete();
};
