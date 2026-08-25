// T-context (2026-08-25, global quick-search): tasks/decisions had zero
// full-text search capability -- only exact-field filters (status/milestone)
// -- unlike items/artifacts/projects (migrations 001/002, then rebuilt
// bilingual in 007, extended to projects in 060). Same generated tsvector +
// GIN index pattern: 'simple' (exact tokens) OR'd with 'english' and
// 'russian' (stemmed) over each table's own free-text columns. tasks:
// title+milestone+scope+acceptance+notes. decisions: title+context+decision+
// rationale+consequences+tags (jsonb cast to text like items' own tags
// handling in migration 007).
const tasksExpression =
  "tsvector generated always as (" +
  "to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(milestone,'') || ' ' || coalesce(scope,'') || ' ' || coalesce(acceptance,'') || ' ' || coalesce(notes,'')) || " +
  "to_tsvector('english', coalesce(title,'') || ' ' || coalesce(scope,'') || ' ' || coalesce(acceptance,'') || ' ' || coalesce(notes,'')) || " +
  "to_tsvector('russian', coalesce(title,'') || ' ' || coalesce(scope,'') || ' ' || coalesce(acceptance,'') || ' ' || coalesce(notes,''))" +
  ") stored";

const decisionsExpression =
  "tsvector generated always as (" +
  "to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(context,'') || ' ' || coalesce(decision,'') || ' ' || coalesce(rationale,'') || ' ' || coalesce(consequences,'') || ' ' || tags::text) || " +
  "to_tsvector('english', coalesce(title,'') || ' ' || coalesce(context,'') || ' ' || coalesce(decision,'') || ' ' || coalesce(rationale,'') || ' ' || coalesce(consequences,'')) || " +
  "to_tsvector('russian', coalesce(title,'') || ' ' || coalesce(context,'') || ' ' || coalesce(decision,'') || ' ' || coalesce(rationale,'') || ' ' || coalesce(consequences,''))" +
  ") stored";

exports.up = async function up(knex) {
  await knex.schema.raw(`alter table tasks add column search_vector ${tasksExpression}`);
  await knex.schema.raw("create index idx_tasks_search_vector on tasks using gin(search_vector)");
  await knex.schema.raw(`alter table decisions add column search_vector ${decisionsExpression}`);
  await knex.schema.raw("create index idx_decisions_search_vector on decisions using gin(search_vector)");
};

exports.down = async function down(knex) {
  await knex.schema.raw("drop index if exists idx_decisions_search_vector");
  await knex.schema.raw("alter table decisions drop column search_vector");
  await knex.schema.raw("drop index if exists idx_tasks_search_vector");
  await knex.schema.raw("alter table tasks drop column search_vector");
};
