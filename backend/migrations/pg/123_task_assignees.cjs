exports.up = async function up(knex) {
  await knex.schema.createTable("task_assignees", (t) => {
    t.text("task_id").notNullable().references("id").inTable("tasks").onDelete("CASCADE");
    t.text("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.integer("position").notNullable();
    t.primary(["task_id", "user_id"]);
    t.index(["user_id", "task_id"]);
  });
  await knex("task_assignees").insert(knex("tasks").whereNotNull("assignee_user_id")
    .select("id as task_id", "assignee_user_id as user_id", knex.raw("0 as position")));
};
exports.down = async function down(knex) { await knex.schema.dropTableIfExists("task_assignees"); };
