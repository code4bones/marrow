// T-context (2026-09-02, T-MEMORY-152): agent-to-agent request/reply
// visibility follow-up -- "projects" namespace needs a "requests" stat/kind
// label (GlobalSearchBox.tsx kindLabel, same slot as "faults"/"skills" from
// 089), "common" needs an "agent" field label for MemoryBody's new
// from->to agent Field, and "events" needs the same for the Timeline
// table's new Agent column.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "projects", key: "requests", value: "Requests", updated_at: now },
    { locale: "ru", namespace: "projects", key: "requests", value: "Запросы", updated_at: now },
    { locale: "en", namespace: "common", key: "agent", value: "Agent", updated_at: now },
    { locale: "ru", namespace: "common", key: "agent", value: "Агент", updated_at: now },
    { locale: "en", namespace: "events", key: "agent", value: "Agent", updated_at: now },
    { locale: "ru", namespace: "events", key: "agent", value: "Агент", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "projects", key: "requests" }).delete();
  await knex("translations").where({ namespace: "common", key: "agent" }).delete();
  await knex("translations").where({ namespace: "events", key: "agent" }).delete();
};
