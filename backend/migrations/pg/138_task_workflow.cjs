const { randomUUID } = require("node:crypto");

exports.up = async function up(knex) {
  await knex.schema.createTable("task_performers", (t) => {
    t.text("task_id").notNullable().references("id").inTable("tasks").onDelete("CASCADE");
    t.text("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.integer("position").notNullable();
    t.primary(["task_id", "user_id"]);
    t.index(["user_id", "task_id"]);
  });
  await knex.schema.createTable("task_workflow_steps", (t) => {
    t.uuid("id").primary();
    t.text("task_id").notNullable().references("id").inTable("tasks").onDelete("CASCADE");
    t.text("project_id").notNullable().references("id").inTable("projects").onDelete("CASCADE");
    t.integer("task_version").notNullable();
    t.text("kind").notNullable().checkIn(["baseline", "created", "handoff", "status"]);
    // Historical identities are snapshots, deliberately survive member/account removal.
    t.text("actor_user_id");
    t.text("actor_client_id").notNullable();
    t.text("actor_label").notNullable();
    t.jsonb("from_participants").notNullable();
    t.jsonb("to_participants").notNullable();
    t.text("status").notNullable();
    t.text("note");
    t.timestamp("created_at", { useTz: true }).notNullable();
    t.unique(["task_id", "task_version"]);
    t.index(["project_id", "task_id"]);
  });
  await knex("task_performers").insert(knex("task_assignees").select("task_id", "user_id", "position"));
  const labels = new Map((await knex("users").select("id", "email")).map((u) => [u.id, u.email]));
  const now = new Date().toISOString();
  let after = "";
  for (;;) {
    const tasks = await knex("tasks").where("id", ">", after).orderBy("id").limit(250);
    if (!tasks.length) break;
    const people = await knex("task_performers").whereIn("task_id", tasks.map((t) => t.id)).orderBy("position");
    await knex("task_workflow_steps").insert(tasks.map((task) => ({
      id: randomUUID(), task_id: task.id, project_id: task.project_id, task_version: task.version || 1,
      kind: "baseline", actor_user_id: null, actor_client_id: "migration:138", actor_label: "Marrow",
      from_participants: "[]", to_participants: JSON.stringify(people.filter((p) => p.task_id === task.id).map((p) => ({ userId: p.user_id, label: labels.get(p.user_id) || p.user_id }))),
      status: task.status, note: null, created_at: now
    })));
    after = tasks[tasks.length - 1].id;
  }
};
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("task_workflow_steps");
  await knex.schema.dropTableIfExists("task_performers");
};
