// T-context (2026-09-02, owner's ask): "agent-executor" -- distinct from
// owner (created_by) and assignee (assignee_user_id, a real project
// member) -- is a third, self-declared identity tied to whoever is
// *currently working* a task, i.e. task_claims, not the task itself. Reuses
// the generic `agent` param every tool schema already carries
// (tool-definitions.ts's baseGatewayToolSpecs.map). Indexed so
// task.list({ claimedByAgent }) (another agent finding what a given agent
// currently has claimed) doesn't scan.
exports.up = async function up(knex) {
  await knex.schema.alterTable("task_claims", (table) => {
    table.text("agent_name").nullable();
  });
  await knex.schema.raw("create index idx_task_claims_agent_name on task_claims(agent_name)");
};

exports.down = async function down(knex) {
  await knex.schema.raw("drop index if exists idx_task_claims_agent_name");
  await knex.schema.alterTable("task_claims", (table) => {
    table.dropColumn("agent_name");
  });
};
