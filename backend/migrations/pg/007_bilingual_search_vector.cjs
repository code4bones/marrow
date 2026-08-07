// I-MEMORY-022 step 4: the mixed Russian/English corpus was invisible to a
// single 'simple' tsvector config across languages ("модель доступа" never
// matches "authorization model" — zero lexical overlap, no stemming at all).
// Generated columns can't have their expression altered in place, so each
// column is dropped and re-added; Postgres recomputes it for all existing
// rows as part of the ADD COLUMN. Query-side matches this with
// plainto_tsquery('simple'|'english'|'russian', ?) OR'd together (see
// pg-tool-service.ts) so exact tokens (IDs, tags, commit hashes) still match
// via 'simple' while stemmed English/Russian words also match.
const itemsExpression =
  "tsvector generated always as (" +
  "to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(body,'') || ' ' || coalesce(tags::text,'')) || " +
  "to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,'')) || " +
  "to_tsvector('russian', coalesce(title,'') || ' ' || coalesce(body,''))" +
  ") stored";

const itemsExpressionDown =
  "tsvector generated always as (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(body,'') || ' ' || coalesce(tags::text,''))) stored";

const artifactsExpression =
  "tsvector generated always as (" +
  "to_tsvector('simple', coalesce(path,'') || ' ' || coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(tags::text,'')) || " +
  "to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'')) || " +
  "to_tsvector('russian', coalesce(title,'') || ' ' || coalesce(description,''))" +
  ") stored";

const artifactsExpressionDown =
  "tsvector generated always as (to_tsvector('simple', coalesce(path,'') || ' ' || coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(tags::text,''))) stored";

exports.up = async function up(knex) {
  await knex.schema.raw("drop index if exists idx_items_search_vector");
  await knex.schema.raw("alter table items drop column search_vector");
  await knex.schema.raw(`alter table items add column search_vector ${itemsExpression}`);
  await knex.schema.raw("create index idx_items_search_vector on items using gin(search_vector)");

  await knex.schema.raw("drop index if exists idx_artifacts_search_vector");
  await knex.schema.raw("alter table artifacts drop column search_vector");
  await knex.schema.raw(`alter table artifacts add column search_vector ${artifactsExpression}`);
  await knex.schema.raw("create index idx_artifacts_search_vector on artifacts using gin(search_vector)");
};

exports.down = async function down(knex) {
  await knex.schema.raw("drop index if exists idx_items_search_vector");
  await knex.schema.raw("alter table items drop column search_vector");
  await knex.schema.raw(`alter table items add column search_vector ${itemsExpressionDown}`);
  await knex.schema.raw("create index idx_items_search_vector on items using gin(search_vector)");

  await knex.schema.raw("drop index if exists idx_artifacts_search_vector");
  await knex.schema.raw("alter table artifacts drop column search_vector");
  await knex.schema.raw(`alter table artifacts add column search_vector ${artifactsExpressionDown}`);
  await knex.schema.raw("create index idx_artifacts_search_vector on artifacts using gin(search_vector)");
};
