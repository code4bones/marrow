// T-MEMORY-115: widen tasks_status_check to allow the two new review-workflow
// statuses (review, changes_requested) -- same drop/re-add pattern as
// 025_items_status_open_answered.cjs.
exports.up = async function up(knex) {
  await knex.schema.raw("alter table tasks drop constraint if exists tasks_status_check");
  await knex.schema.raw(
    "alter table tasks add constraint tasks_status_check check (status in ('todo', 'doing', 'blocked', 'review', 'changes_requested', 'done', 'cancelled'))"
  );
};

exports.down = async function down(knex) {
  await knex("tasks").where({ status: "review" }).update({ status: "doing" });
  await knex("tasks").where({ status: "changes_requested" }).update({ status: "done" });
  await knex.schema.raw("alter table tasks drop constraint if exists tasks_status_check");
  await knex.schema.raw(
    "alter table tasks add constraint tasks_status_check check (status in ('todo', 'doing', 'blocked', 'done', 'cancelled'))"
  );
};
