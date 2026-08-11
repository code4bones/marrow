// Milestone grouping for Tasks and Decisions: decisions gains a "milestone"
// column/column-header label (mirroring tasks' existing one, same Russian
// value "Веха" for consistency), plus a group-by toggle and its
// no-milestone bucket label, shared by both namespaces.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "decisions", key: "milestone", value: "Milestone", updated_at: now },
    { locale: "ru", namespace: "decisions", key: "milestone", value: "Веха", updated_at: now },
    { locale: "en", namespace: "decisions", key: "groupByMilestone", value: "Group by milestone", updated_at: now },
    { locale: "ru", namespace: "decisions", key: "groupByMilestone", value: "Группировать по вехам", updated_at: now },
    { locale: "en", namespace: "decisions", key: "noMilestone", value: "No milestone", updated_at: now },
    { locale: "ru", namespace: "decisions", key: "noMilestone", value: "Без вехи", updated_at: now },
    { locale: "en", namespace: "tasks", key: "groupByMilestone", value: "Group by milestone", updated_at: now },
    { locale: "ru", namespace: "tasks", key: "groupByMilestone", value: "Группировать по вехам", updated_at: now },
    { locale: "en", namespace: "tasks", key: "noMilestone", value: "No milestone", updated_at: now },
    { locale: "ru", namespace: "tasks", key: "noMilestone", value: "Без вехи", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations")
    .where({ namespace: "decisions" })
    .whereIn("key", ["milestone", "groupByMilestone", "noMilestone"])
    .delete();
  await knex("translations")
    .where({ namespace: "tasks" })
    .whereIn("key", ["groupByMilestone", "noMilestone"])
    .delete();
};
