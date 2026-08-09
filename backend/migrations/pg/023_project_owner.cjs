// Introduces a per-project "owner" concept, distinct from the system-wide
// role=admin (the instance host, who still always has access to
// everything). An owner gets exclusive control over just their own
// project (delete/rename/invite-link management) without needing full
// admin scope -- previously any current member could rename/manage
// invites, and only a system admin could delete, forcing the admin to
// personally police every shared project.
//
// Backfill derives owner_user_id from the existing created_by column
// (projects.created_by = context.clientId, which is "user:<id>" for a
// project created by a real logged-in session -- see writeActorFields()).
// Joining against users rather than blindly substringing means a
// malformed or dangling created_by (e.g. a project created via the
// static token, or whose creator account was later deleted) just leaves
// owner_user_id NULL -- identical to today's "no owner, admin-only"
// behavior for those rows, not a guess.
exports.up = async function up(knex) {
  await knex.schema.alterTable("projects", (table) => {
    table.text("owner_user_id").references("id").inTable("users").onDelete("SET NULL");
  });
  await knex.schema.raw("create index idx_projects_owner_user_id on projects(owner_user_id)");
  await knex.schema.raw(`
    update projects p set owner_user_id = u.id
    from users u
    where p.created_by = 'user:' || u.id
  `);
};

exports.down = async function down(knex) {
  await knex.schema.raw("drop index if exists idx_projects_owner_user_id");
  await knex.schema.alterTable("projects", (table) => {
    table.dropColumn("owner_user_id");
  });
};
