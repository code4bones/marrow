// T-MEMORY-088: full-text search for the Projects list -- same generated
// tsvector + GIN index pattern as items/artifacts (migration 007):
// 'simple' (exact tokens, matches slugs/ids literally) OR'd with 'english'
// and 'russian' (stemmed) over title+slug+description. A generated column
// can only reference columns of its own row, so this covers title/slug/
// description only -- matching by project OWNER (also requested) is done
// at query time instead, via a join to users and an ILIKE on their email,
// combined with this tsvector match in the WHERE clause (see
// projects-core.mixin.ts).
const projectsExpression =
  "tsvector generated always as (" +
  "to_tsvector('simple', coalesce(slug,'') || ' ' || coalesce(title,'') || ' ' || coalesce(description,'')) || " +
  "to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'')) || " +
  "to_tsvector('russian', coalesce(title,'') || ' ' || coalesce(description,''))" +
  ") stored";

exports.up = async function up(knex) {
  await knex.schema.raw(`alter table projects add column search_vector ${projectsExpression}`);
  await knex.schema.raw("create index idx_projects_search_vector on projects using gin(search_vector)");
};

exports.down = async function down(knex) {
  await knex.schema.raw("drop index if exists idx_projects_search_vector");
  await knex.schema.raw("alter table projects drop column search_vector");
};
