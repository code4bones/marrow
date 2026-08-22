// T-MEMORY-093 follow-up: owner's call -- when a task/decision has a
// different owner (created_by) and assignee, a lifecycle event (status
// change, completion) should notify BOTH, not just whichever one the old
// single target_user_id column could hold. Same jsonb-array-of-strings
// storage convention as tasks.allowed_files/depends_on etc. (see
// formatters/common.ts's jsonStringArray/stringArray). The old
// target_user_id column is left in place, unused going forward -- dropping
// it is a separate, later cleanup, not worth the risk right after a prod
// outage tonight.
exports.up = async function up(knex) {
  await knex.schema.alterTable("events", (table) => {
    table.jsonb("target_user_ids").notNullable().defaultTo("[]");
  });
  await knex.raw(
    "update events set target_user_ids = jsonb_build_array(target_user_id) where target_user_id is not null"
  );
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("events", (table) => {
    table.dropColumn("target_user_ids");
  });
};
