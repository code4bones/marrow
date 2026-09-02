// T-context (2026-09-02, owner's ask: "как и нужно, помимо владельца,
// добавили агента" -- generalized past request/reply only): any write call
// can now self-identify its agent via a top-level `agent` param, captured
// once in service.ts's call() dispatcher and threaded through
// recordEventForProject (base.ts) onto every event, not just request/reply's
// own from-agent:/to-agent: tags. Nullable -- most calls won't pass it, and
// existing rows have no value to backfill.
exports.up = async function up(knex) {
  await knex.schema.alterTable("events", (table) => {
    table.text("agent_name").nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("events", (table) => {
    table.dropColumn("agent_name");
  });
};
