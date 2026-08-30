// T-context (2026-08-30, D-MEMORY-041 follow-up): two gaps found only once
// the Skills stat tile and DetailDrawer's SkillBody were actually wired up
// (088 only seeded the standalone "skills" namespace + one "nav" key):
// (1) "projects" namespace (020_translations_seed_rest.cjs) duplicates a
// small "artifacts"/"faults"/"decisions" stat-tile-title key per domain,
// reused by project-overview/index.tsx and GlobalSearchBox.tsx (both
// useTranslation('projects')) -- needed a "skills" entry too.
// (2) "common" namespace (also 020) is what every DetailDrawer *Body
// component uses (useTranslation('common')) -- SkillBody needs two keys no
// other record kind has (activationCount/lastActivatedAt display).
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "projects", key: "skills", value: "Skills", updated_at: now },
    { locale: "ru", namespace: "projects", key: "skills", value: "Скиллы", updated_at: now },
    { locale: "en", namespace: "common", key: "activations", value: "Activations", updated_at: now },
    { locale: "ru", namespace: "common", key: "activations", value: "Активации", updated_at: now },
    { locale: "en", namespace: "common", key: "lastActivated", value: "Last activated", updated_at: now },
    { locale: "ru", namespace: "common", key: "lastActivated", value: "Последняя активация", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "projects", key: "skills" }).delete();
  await knex("translations").where({ namespace: "common", key: "activations" }).delete();
  await knex("translations").where({ namespace: "common", key: "lastActivated" }).delete();
};
