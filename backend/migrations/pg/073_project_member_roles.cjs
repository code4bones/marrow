// T-MEMORY-110: per-project roles (pm/developer/tester) + an approval gate
// on joining -- until now project_members was a bare membership row (no
// role, instant-active on invite-link claim). Owner: a "full" kanban needs
// more than one visible board -- other humans need to be able to put work
// on it too, but the owner still has to approve who joins and what they
// can do.
//
// Existing rows predate any role concept and were fully-privileged members
// under the old all-or-nothing model -- backfilled to role='pm' so nobody
// currently trusted loses capability the moment this ships. Only NEW joins
// (via claimProjectInviteLink, from here on) land as status='pending_approval'
// with no role until the owner approves them.
exports.up = async function up(knex) {
  await knex.schema.alterTable("project_members", (table) => {
    table.text("role");
    table.text("status").notNullable().defaultTo("active");
  });
  await knex("project_members").update({ role: "pm", status: "active" });
  await knex.schema.raw(
    "alter table project_members add constraint project_members_role_check check (role is null or role in ('pm','developer','tester'))"
  );
  await knex.schema.raw(
    "alter table project_members add constraint project_members_status_check check (status in ('pending_approval','active'))"
  );
};

exports.down = async function down(knex) {
  await knex.schema.raw("alter table project_members drop constraint if exists project_members_role_check");
  await knex.schema.raw("alter table project_members drop constraint if exists project_members_status_check");
  await knex.schema.alterTable("project_members", (table) => {
    table.dropColumn("role");
    table.dropColumn("status");
  });
};
