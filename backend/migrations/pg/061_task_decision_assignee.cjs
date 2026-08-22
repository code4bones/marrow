// T-MEMORY-090: explicit "who this work is for" distinct from created_by
// (the raw clientId of whoever wrote the record, which is often an agent
// session, not a person). assignee_user_id is a real FK into users -- only
// a registered project member can be picked (enforced at the application
// layer in gateway/assignees.ts, not by this column alone). Nullable/
// "on delete set null" so a deleted user account doesn't take the task/
// decision down with it; the row just reverts to "unassigned" (= owner).
//
// events.target_user_id is the matching piece for notifications: task.
// assigned/decision.assigned events set it to the new assignee so the
// existing Notifications feed (events + notifications_seen_at) can
// highlight "assigned to you" rows for that one user, without a separate
// notifications table.
exports.up = async function up(knex) {
  await knex.schema.alterTable("tasks", (table) => {
    table.text("assignee_user_id").references("id").inTable("users").onDelete("SET NULL");
  });
  await knex.schema.alterTable("decisions", (table) => {
    table.text("assignee_user_id").references("id").inTable("users").onDelete("SET NULL");
  });
  await knex.schema.alterTable("events", (table) => {
    table.text("target_user_id").references("id").inTable("users").onDelete("SET NULL");
  });
  await knex.schema.raw("create index idx_tasks_assignee_user_id on tasks(assignee_user_id)");
  await knex.schema.raw("create index idx_decisions_assignee_user_id on decisions(assignee_user_id)");
  await knex.schema.raw("create index idx_events_target_user_id on events(target_user_id)");
};

exports.down = async function down(knex) {
  await knex.schema.raw("drop index if exists idx_tasks_assignee_user_id");
  await knex.schema.raw("drop index if exists idx_decisions_assignee_user_id");
  await knex.schema.raw("drop index if exists idx_events_target_user_id");
  await knex.schema.alterTable("tasks", (table) => {
    table.dropColumn("assignee_user_id");
  });
  await knex.schema.alterTable("decisions", (table) => {
    table.dropColumn("assignee_user_id");
  });
  await knex.schema.alterTable("events", (table) => {
    table.dropColumn("target_user_id");
  });
};
