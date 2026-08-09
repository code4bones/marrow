// Thorough i18n audit follow-up (per-file review, not just a grep pass):
// found genuinely un-translated English still visible in the Russian UI in
// widgets/graph-view/rootKind.ts (ROOT_KIND_LABEL/ROOT_KIND_OPTIONS/
// ROOT_KIND_EMPTY_HINT were plain hardcoded English constants feeding the
// "Root:" <Select> options, DecisionTimeline's baseline-column header, and
// its empty-state copy -- so e.g. the Russian noKindRecordedYet template
// "Пока нет записанных: {{kind}}" rendered with an English word spliced in,
// "Пока нет записанных: decisions") and widgets/navigation-rail/index.tsx
// (a hardcoded "Project" label above the selected project's slug).
//
// rootKindEmptyHint* are new keys (decisions namespace, the sole consumer).
// The plural kind words themselves (Decisions/Tasks/Memory/Artifacts) reuse
// the nav namespace's own tasks/decisions/memory/artifacts keys already
// seeded in 019_translations_seed_nav.cjs -- no new rows needed for those.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const entries = {
    nav: {
      project: { en: "Project", ru: "Проект" },
    },
    decisions: {
      rootKindEmptyHintDecision: {
        en: "The timeline fills in as decision.record / decision.supersede are used",
        ru: "Лента заполнится, как только будут использованы decision.record / decision.supersede",
      },
      rootKindEmptyHintTask: {
        en: "The timeline fills in as task.create is used",
        ru: "Лента заполнится, как только будет использован task.create",
      },
      rootKindEmptyHintMemory: {
        en: "The timeline fills in as memory.create / memory.upsert are used",
        ru: "Лента заполнится, как только будут использованы memory.create / memory.upsert",
      },
      rootKindEmptyHintArtifact: {
        en: "The timeline fills in as artifact.put is used",
        ru: "Лента заполнится, как только будет использован artifact.put",
      },
    },
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
  await knex("translations").where({ namespace: "nav" }).whereIn("key", ["project"]).delete();
  await knex("translations")
    .where({ namespace: "decisions" })
    .whereIn("key", [
      "rootKindEmptyHintDecision",
      "rootKindEmptyHintTask",
      "rootKindEmptyHintMemory",
      "rootKindEmptyHintArtifact",
    ])
    .delete();
};
