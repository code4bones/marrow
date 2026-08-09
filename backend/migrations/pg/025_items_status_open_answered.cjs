// Cross-project Q&A (request.create/reply.create) stores requests as
// type="request" memory items with status open/answered -- "closed" reuses
// the existing "archived" value (memory.archive already works generically
// on any item, no new tool needed) rather than adding a third new status.
exports.up = async function up(knex) {
  await knex.schema.raw("alter table items drop constraint if exists items_status_check");
  await knex.schema.raw(
    "alter table items add constraint items_status_check check (status in ('active', 'draft', 'archived', 'superseded', 'rejected', 'open', 'answered'))"
  );
};

exports.down = async function down(knex) {
  await knex("items").where({ status: "open" }).update({ status: "active" });
  await knex("items").where({ status: "answered" }).update({ status: "active" });
  await knex.schema.raw("alter table items drop constraint if exists items_status_check");
  await knex.schema.raw(
    "alter table items add constraint items_status_check check (status in ('active', 'draft', 'archived', 'superseded', 'rejected'))"
  );
};
